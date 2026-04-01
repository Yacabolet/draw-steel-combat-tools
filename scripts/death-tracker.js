import { getSetting } from './helpers.js';

const SKULL_SRC = 'icons/commodities/bones/skull-hollow-worn-blue.webp';

export function registerDeathTrackerHooks() {
  
  Hooks.on('createActiveEffect', async (effect) => {
    if (!getSetting('deathTrackerEnabled')) return;

    // IMPORTANT: Visual cleanup and token deletion is exclusively handled by the GM.
    // This perfectly bypasses the player permission issue natively!
    if (!game.users.activeGM?.isSelf) return;

    const statuses = [...(effect.statuses ?? [])];
    if (!statuses.includes('dead') && !statuses.includes('dying')) return;

    const actor = effect.parent;
    if (!actor || actor.type === 'hero') return;

    // Get the specific token, handling both linked and unlinked actors safely
    const token = actor.isToken ? actor.token.object : canvas.tokens.placeables.find(t => t.actor?.id === actor.id);
    if (!token) return;

    // Remove from combat tracker
    const combatant = game.combat?.combatants.find(c => c.tokenId === token.id);
    if (combatant) await combatant.delete();

    // Flash red then fade out
    const animDuration = getSetting('deathAnimationDuration');
    if (animDuration > 0) {
      await token.document.update({ 'texture.tint': '#ff0000' });
      const steps = 20;
      const stepTime = Math.round(animDuration / steps);
      for (let i = steps - 1; i >= 0; i--) {
        await new Promise(r => setTimeout(r, stepTime));
        if (!canvas.tokens.get(token.id)) break; // Stop if deleted early
        await token.document.update({ alpha: i / steps });
      }
    }

    if (canvas.tokens.get(token.id)) {
      const tileSize = Math.round(token.document.width * canvas.grid.size / 2);
      const tileX    = token.center.x - tileSize / 2;
      const tileY    = token.center.y - tileSize / 2;

      // Place the skull
      const [tile] = await canvas.scene.createEmbeddedDocuments('Tile', [{
        texture: { src: SKULL_SRC, scaleX: 1, scaleY: 1, tint: '#ffffff', anchorX: 0.5, anchorY: 0.5 },
        x: tileX, y: tileY,
        width: tileSize, height: tileSize,
        rotation: 0, alpha: 1, hidden: false, locked: false,
        occlusion: { mode: 0, alpha: 0 },
        restrictions: { light: false, weather: false },
        video: { loop: false, autoplay: false, volume: 0 }
      }]);

      if (getSetting('clearSkullsOnCombatEnd') && tile) {
        const skullIds = game.settings.get('draw-steel-combat-tools', 'deathTrackerSkullIds') ?? [];
        skullIds.push(tile.id);
        await game.settings.set('draw-steel-combat-tools', 'deathTrackerSkullIds', skullIds);
      }

      // Brief delay to allow Censor/Tactician hooks to parse the actor before it vanishes
      await new Promise(r => setTimeout(r, 150));
      await token.document.delete();

      await ChatMessage.create({
        content: `<strong>${actor.name}</strong> has fallen.`
      });
    }
  });

  Hooks.on('updateCombatantGroup', async (group, changes) => {
    if (!getSetting('deathTrackerEnabled') || !game.users.activeGM?.isSelf) return;
    
    if (changes.system?.staminaValue === undefined) return;
    if (changes.system.staminaValue > 0) return;
    if (group.type !== 'squad') return;

    for (const combatant of group.members) {
      const actor = combatant.actor;
      if (!actor || actor.type === 'hero') continue;
      await actor.toggleStatusEffect('dead', { active: true });
    }
  });

  Hooks.on('deleteCombat', async () => {
    if (!getSetting('deathTrackerEnabled') || !getSetting('clearSkullsOnCombatEnd') || !game.users.activeGM?.isSelf) return;

    const skullIds = game.settings.get('draw-steel-combat-tools', 'deathTrackerSkullIds') ?? [];
    for (const id of skullIds) {
      const tile = canvas.scene.tiles.get(id);
      if (tile) await tile.document.delete();
    }
    await game.settings.set('draw-steel-combat-tools', 'deathTrackerSkullIds', []);
  });
}