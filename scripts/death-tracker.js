import { getSetting, safeTeleport } from './helpers.js';

const SKULL_SRC = 'icons/commodities/bones/skull-hollow-worn-blue.webp';

const getGraveyardPosition = (tokenDoc) => {
  const gs = canvas.grid.size;
  const tokenW = tokenDoc.width ?? 1;
  const tokenH = tokenDoc.height ?? 1;
  const tw = tokenW * gs;
  const th = tokenH * gs;

  if (!window._graveyardReservations) window._graveyardReservations = new Set();

  const isOccupied = (testX, testY) => {
    return canvas.tokens.placeables.some(t => {
      if (t.id === tokenDoc.id) return false;
      const w = (t.document.width ?? 1) * gs;
      const h = (t.document.height ?? 1) * gs;
      return !(testX >= t.x + w || testX + tw <= t.x || testY >= t.y + h || testY + th <= t.y);
    });
  };

  for (let ring = 0; ring < 20; ring++) {
    for (let x = 0; x <= ring; x++) {
      for (let y = 0; y <= ring; y++) {
        if (x === ring || y === ring) {
          const gx = x * gs;
          const gy = y * gs;
          
          let reservationConflict = false;
          for(let rx = 0; rx < tokenW; rx++) {
              for(let ry = 0; ry < tokenH; ry++) {
                  if (window._graveyardReservations.has(`${gx + rx * gs},${gy + ry * gs}`)) {
                      reservationConflict = true;
                  }
              }
          }

          if (!isOccupied(gx, gy) && !reservationConflict) {
            for(let rx = 0; rx < tokenW; rx++) {
                for(let ry = 0; ry < tokenH; ry++) {
                    const rKey = `${gx + rx * gs},${gy + ry * gs}`;
                    window._graveyardReservations.add(rKey);
                    setTimeout(() => window._graveyardReservations.delete(rKey), 5000);
                }
            }
            return { x: gx, y: gy };
          }
        }
      }
    }
  }
  return { x: 0, y: 0 }; 
};

export function registerDeathTrackerHooks() {
  
  Hooks.on('createActiveEffect', async (effect) => {
    if (!getSetting('deathTrackerEnabled')) return;
    if (!game.users.activeGM?.isSelf) return;

    const statuses = [...(effect.statuses ?? [])];
    if (!statuses.includes('dead') && !statuses.includes('dying')) return;

    const actor = effect.parent;
    if (!actor || actor.type === 'hero') return;

    const token = actor.isToken ? actor.token.object : canvas.tokens.placeables.find(t => t.actor?.id === actor.id);
    if (!token) return;

    if (!window._deathTrackerLocks) window._deathTrackerLocks = new Set();
    if (window._deathTrackerLocks.has(token.id)) return;
    window._deathTrackerLocks.add(token.id);
    setTimeout(() => window._deathTrackerLocks.delete(token.id), 2000); 

    if (window._activeGrabs) {
      for (const [gid, grab] of [...window._activeGrabs.entries()]) {
        if (grab.grabbedTokenId === token.id || grab.grabberTokenId === token.id) {
          const api = game.modules.get('draw-steel-combat-tools')?.api;
          if (api) await api.endGrab(gid, { silent: false, customMsg: `${actor.name} fell, ending the grab.` });
        }
      }
    }

    const combatant = game.combat?.combatants.find(c => c.tokenId === token.id);
    if (combatant) await combatant.update({ hidden: true });

    const animDuration = getSetting('deathAnimationDuration');
    if (animDuration > 0) {
      await token.document.update({ 'texture.tint': '#ff0000' });
      const steps = 20;
      const stepTime = Math.round(animDuration / steps);
      for (let i = steps - 1; i >= 0; i--) {
        await new Promise(r => setTimeout(r, stepTime));
        if (!canvas.tokens.get(token.id)) break; 
        await token.document.update({ alpha: i / steps });
      }
    }

    if (canvas.tokens.get(token.id)) {
      const tileSize = Math.round(token.document.width * canvas.grid.size / 2);
      const tileX    = token.center.x - tileSize / 2;
      const tileY    = token.center.y - tileSize / 2;

      const [tile] = await canvas.scene.createEmbeddedDocuments('Tile', [{
        texture: { src: SKULL_SRC, scaleX: 1, scaleY: 1, tint: '#ffffff', anchorX: 0.5, anchorY: 0.5 },
        x: tileX, y: tileY,
        width: tileSize, height: tileSize,
        rotation: 0, alpha: 1, hidden: false, locked: false,
        occlusion: { mode: 0, alpha: 0 },
        restrictions: { light: false, weather: false },
        video: { loop: false, autoplay: false, volume: 0 },
        flags: {
          'draw-steel-combat-tools': { deadTokenId: token.id }
        }
      }]);

      if (getSetting('clearSkullsOnCombatEnd') && tile) {
        const skullIds = game.settings.get('draw-steel-combat-tools', 'deathTrackerSkullIds') ?? [];
        skullIds.push(tile.id);
        await game.settings.set('draw-steel-combat-tools', 'deathTrackerSkullIds', skullIds);
      }

      await new Promise(r => setTimeout(r, 150));

      const gravePos = getGraveyardPosition(token.document);
      await token.document.update({ hidden: true, alpha: 1, 'texture.tint': '#ffffff' });
      await safeTeleport(token.document, gravePos.x, gravePos.y);

      await ChatMessage.create({
        content: `<strong>${actor.name}</strong> has fallen.`,
        flags: { 'draw-steel-combat-tools': { isDeathMessage: true, deadTokenId: token.id } }
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
      if (tile) {
        const deadTokenId = tile.document.flags?.['draw-steel-combat-tools']?.deadTokenId;
        if (deadTokenId) {
          const deadToken = canvas.scene.tokens.get(deadTokenId);
          if (deadToken) await deadToken.delete();
        }
        await tile.document.delete();
      }
    }
    await game.settings.set('draw-steel-combat-tools', 'deathTrackerSkullIds', []);
  });

  Hooks.on('renderChatMessage', (msg, html) => {
    if (!game.user.isGM) return;
    const isDeath = msg.getFlag('draw-steel-combat-tools', 'isDeathMessage');
    if (isDeath) {
      const tokenId = msg.getFlag('draw-steel-combat-tools', 'deadTokenId');
      if (!tokenId) return;
      
      const btn = $(`<button type="button" class="dsct-undo-death" style="margin-top:4px;cursor:pointer;"><i class="fa-solid fa-rotate-left"></i> Undo</button>`);
      btn.on('click', async (e) => {
         e.preventDefault();
         await executeRevival(tokenId);
         if (msg.isOwner || game.user.isGM) await msg.delete();
      });
      html.find('.message-content').append(btn);
    }
  });
}

export const runReviveUI = () => {
  const skulls = canvas.tiles.placeables.filter(t => t.document.flags?.['draw-steel-combat-tools']?.deadTokenId);

  if (!skulls.length) {
    ui.notifications.warn("No valid skulls found for revival.");
    return;
  }

  const hlName = 'dsct-revive-hl';
  if (canvas.grid.highlightLayers[hlName]) canvas.grid.destroyHighlightLayer(hlName);
  const hl = canvas.grid.addHighlightLayer(hlName);

  for (const skull of skulls) {
    const gx = Math.floor(skull.x / canvas.grid.size) * canvas.grid.size;
    const gy = Math.floor(skull.y / canvas.grid.size) * canvas.grid.size;
    canvas.grid.highlightPosition(hlName, { x: gx, y: gy, color: 0x00FF00, border: 0x00AA00 });
  }

  ui.notifications.info("Click on a highlighted skull to revive the creature. Right-click anywhere to cancel.");

  const finish = () => {
    canvas.grid.destroyHighlightLayer(hlName);
    canvas.stage.off('mousedown', onClick);
  };

  const onClick = async (event) => {
    if (event.data.originalEvent.button === 2) {
      finish();
      ui.notifications.info("Revival cancelled.");
      return;
    }
    
    if (event.data.originalEvent.button !== 0) return;
    
    const pos = event.data.getLocalPosition(canvas.app.stage);
    
    const clickedSkulls = skulls.filter(s => {
       return pos.x >= s.x && pos.x <= s.x + s.document.width &&
              pos.y >= s.y && pos.y <= s.y + s.document.height;
    });

    if (!clickedSkulls.length) return; 
    finish();

    if (clickedSkulls.length === 1) {
       const id = clickedSkulls[0].document.flags['draw-steel-combat-tools'].deadTokenId;
       await executeRevival(id, clickedSkulls[0]);
    } else {
       let buttons = {};
       for (const s of clickedSkulls) {
           const id = s.document.flags['draw-steel-combat-tools'].deadTokenId;
           const tok = canvas.scene.tokens.get(id);
           if (!tok) continue;
           buttons[s.id] = {
               label: `${tok.name} (${id})`,
               callback: () => executeRevival(id, s)
           };
       }
       buttons.cancel = { label: "Cancel" };
       
       new Dialog({
           title: "Overlapping Skulls Found",
           content: "<p>Multiple fallen creatures are in this space. Which one do you want to revive?</p>",
           buttons: buttons
       }).render(true);
    }
  };

  canvas.stage.on('mousedown', onClick);
};

const executeRevival = async (tokenId, explicitTile = null) => {
  const tokenDoc = canvas.scene.tokens.get(tokenId);
  
  if (!tokenDoc) {
      ui.notifications.error("The token for this creature no longer exists in the Graveyard.");
      return;
  }

  const tile = explicitTile || canvas.tiles.placeables.find(t => t.document.flags?.['draw-steel-combat-tools']?.deadTokenId === tokenId);

  if (tile) {
      const gx = Math.floor(tile.x / canvas.grid.size) * canvas.grid.size;
      const gy = Math.floor(tile.y / canvas.grid.size) * canvas.grid.size;
      await safeTeleport(tokenDoc, gx, gy);
  }

  const actor = tokenDoc.actor;
  if (actor) {
      await actor.toggleStatusEffect('dead', { active: false });
      
      const currentStamina = actor.system.stamina?.value || 0;
      if (currentStamina <= 0) {
        await actor.update({ 'system.stamina.value': 1 });
      }
      
      await new Promise(r => setTimeout(r, 250));

      if (getSetting('clearEffectsOnRevive')) {
          const validEffectIds = actor.effects
              .filter(e => !e.id.endsWith('0000000000'))
              .map(e => e.id);

          if (validEffectIds.length > 0) {
              try {
                  await actor.deleteEmbeddedDocuments("ActiveEffect", validEffectIds);
              } catch (e) {
                  console.warn("DSCT | Minor error clearing remaining effects: ", e);
              }
          }
      }
  }

  await tokenDoc.update({ hidden: false });
  
  const combatant = game.combat?.combatants.find(c => c.tokenId === tokenId);
  if (combatant) await combatant.update({ hidden: false });

  if (tile) await tile.document.delete();
  ui.notifications.info(`${tokenDoc.name} has been revived!`);
};

export const runPowerWordKillUI = () => {
  if (!game.user.isGM) {
    ui.notifications.warn("POWER WORD: KILL is a GM-only tool.");
    return;
  }

  if (window._pwkActive) return;
  window._pwkActive = true;

  const npcs = canvas.tokens.placeables.filter(t => 
    t.actor && 
    t.actor.type !== 'hero' && 
    !t.document.hidden && 
    (t.actor.system?.stamina?.value > 0)
  );

  if (!npcs.length) {
    ui.notifications.warn("No valid NPCs found on the board.");
    window._pwkActive = false;
    return;
  }

  const hlName = 'dsct-pwk-hl';
  if (canvas.grid.highlightLayers[hlName]) canvas.grid.destroyHighlightLayer(hlName);
  canvas.grid.addHighlightLayer(hlName);
  
  const selectedTokens = new Set();

  const drawHighlights = () => {
    canvas.grid.clearHighlightLayer(hlName);
    for (const npc of npcs) {
      const isSelected = selectedTokens.has(npc.id);
      const color = isSelected ? 0xFF0000 : 0xFF8800; 
      const border = isSelected ? 0xAA0000 : 0xAA4400;

      const w = Math.max(1, Math.round(npc.document.width));
      const h = Math.max(1, Math.round(npc.document.height));

      for (let dx = 0; dx < w; dx++) {
        for (let dy = 0; dy < h; dy++) {
          const gx = Math.floor(npc.x / canvas.grid.size) * canvas.grid.size + (dx * canvas.grid.size);
          const gy = Math.floor(npc.y / canvas.grid.size) * canvas.grid.size + (dy * canvas.grid.size);
          canvas.grid.highlightPosition(hlName, { x: gx, y: gy, color, border });
        }
      }
    }
  };

  drawHighlights();
  ui.notifications.info("POWER WORD: KILL | Click NPCs to select them, press ENTER to execute, or Right-Click/Escape to cancel.");

  const finish = () => {
    window._pwkActive = false;
    canvas.grid.destroyHighlightLayer(hlName);
    canvas.stage.off('mousedown', onClick);
    document.removeEventListener('keydown', onKey);
  };

  const onClick = (event) => {
    if (event.data.originalEvent.button === 2) {
      finish();
      ui.notifications.info("POWER WORD: KILL cancelled.");
      return;
    }
    
    if (event.data.originalEvent.button !== 0) return;
    
    const pos = event.data.getLocalPosition(canvas.app.stage);
    
    const clicked = npcs.filter(t => {
       const w = t.document.width * canvas.grid.size;
       const h = t.document.height * canvas.grid.size;
       return pos.x >= t.x && pos.x <= t.x + w && pos.y >= t.y && pos.y <= t.y + h;
    });

    if (!clicked.length) return; 

    const targetId = clicked[0].id;
    if (selectedTokens.has(targetId)) {
        selectedTokens.delete(targetId);
    } else {
        selectedTokens.add(targetId);
    }
    
    drawHighlights();
  };

  const onKey = async (event) => {
    if (event.key === 'Enter') {
      event.preventDefault(); 
      finish();
      
      // --- NEW: Clear native token selection ---
      canvas.tokens.releaseAll(); 
      
      if (selectedTokens.size === 0) {
        ui.notifications.warn("No targets selected for POWER WORD: KILL.");
        return;
      }

      // --- UPDATED: Batch Execute 'dead' ONLY. No Stamina modification! ---
      const deadUpdates = [];
      for (const id of selectedTokens) {
        const t = canvas.tokens.get(id);
        if (t && t.actor) {
           deadUpdates.push(t.actor.toggleStatusEffect('dead', { active: true }));
        }
      }
      await Promise.allSettled(deadUpdates);
      
      ui.notifications.warn(selectedTokens.size > 1 ? 'MASS POWER WORD: KILL' : 'POWER WORD: KILL');
      
    } else if (event.key === 'Escape') {
      finish();
      ui.notifications.info("POWER WORD: KILL cancelled.");
    }
  };

  canvas.stage.on('mousedown', onClick);
  document.addEventListener('keydown', onKey);
};