import { sizeRank } from './helpers.js';
import { runForcedMovement } from './forced-movement.js';

const TIMEOUT_MS = 60_000;

export async function runKnockback() {
  const controlled = canvas.tokens.controlled;
  const targets    = [...game.user.targets];

  if (!controlled.length)   { ui.notifications.warn('Select the attacking token.'); return; }
  if (targets.length !== 1) { ui.notifications.warn('Target exactly one creature.'); return; }

  const attackerToken = controlled[0];
  const targetToken   = targets[0];
  const attackerActor = attackerToken.actor;
  const targetActor   = targetToken.actor;

  const knockbackItem = attackerActor.items.find(i => i.name === 'Knockback');
  if (!knockbackItem) { ui.notifications.warn(`No Knockback item found on ${attackerActor.name}.`); return; }

  const attackerRank = sizeRank(attackerActor.system.combat.size);
  const targetRank   = sizeRank(targetActor.system.combat.size);
  const might        = attackerActor.system.characteristics.might.value ?? 0;
  const sizeLimit    = might >= 2 ? might + 2 : attackerRank;

  if (targetRank > sizeLimit) {
    ui.notifications.warn(`${attackerActor.name} cannot force move ${targetToken.name} (size too large).`);
    return;
  }

  const hDist   = canvas.grid.measurePath([
    { x: attackerToken.center.x, y: attackerToken.center.y },
    { x: targetToken.center.x,   y: targetToken.center.y }
  ]).distance;
  const vDist   = Math.abs((attackerToken.document.elevation ?? 0) - (targetToken.document.elevation ?? 0));
  const adjDist = Math.max(hDist, vDist * canvas.grid.distance);

  if (adjDist > canvas.grid.distance) {
    ui.notifications.warn(`${targetToken.name} is not adjacent.`);
    return;
  }

  const tier = await new Promise((resolve) => {
    let hookId, timeoutId;
    const cleanup = (val) => {
      Hooks.off('createChatMessage', hookId);
      clearTimeout(timeoutId);
      resolve(val);
    };
    hookId = Hooks.on('createChatMessage', async (msg) => {
      const parts = msg.system?.parts?.contents;
      if (!parts) return;
      const ar = parts.find(p => p.type === 'abilityResult');
      if (!ar) return;
      cleanup(`tier${ar.tier}`);
    });
    timeoutId = setTimeout(() => { ui.notifications.warn('Roll not detected.'); cleanup(null); }, TIMEOUT_MS);
    ds.helpers.macros.rollItemMacro(knockbackItem.uuid);
  });

  if (!tier) return;

  const basePush = tier === 'tier1' ? 1 : tier === 'tier2' ? 2 : 3;

  const { createFormGroup, createNumberInput } = foundry.applications.fields;
  const content = document.createElement('div');
  content.appendChild(createFormGroup({
    label: 'Bonus Forced Movement',
    hint:  `Base: ${basePush}`,
    input: createNumberInput({ name: 'bonus', min: 0, value: 0, step: 1 }),
    classes: ['slim']
  }));
  content.appendChild(createFormGroup({
    label: 'Bonus Creature Collision Damage',
    hint:  'e.g. Primordial Strength (Might score)',
    input: createNumberInput({ name: 'bonusCreatureDmg', min: 0, value: 0, step: 1 }),
    classes: ['slim']
  }));
  content.appendChild(createFormGroup({
    label: 'Bonus Object Collision Damage',
    hint:  'e.g. Primordial Strength (Might score)',
    input: createNumberInput({ name: 'bonusObjectDmg', min: 0, value: 0, step: 1 }),
    classes: ['slim']
  }));

  const fd = await ds.applications.api.DSDialog.input({ content, window: { title: 'Knockback Bonuses' } });
  if (!fd) return;

  const bonusPush        = parseInt(fd.bonus)            || 0;
  const bonusCreatureDmg = parseInt(fd.bonusCreatureDmg) || 0;
  const bonusObjectDmg   = parseInt(fd.bonusObjectDmg)   || 0;
  const sizeBonus        = attackerRank > targetRank ? 1 : 0;
  const totalPush        = basePush + sizeBonus + bonusPush;

  const parts = [];
  if (sizeBonus) parts.push('+1 size');
  if (bonusPush) parts.push(`+${bonusPush} bonus`);
  if (parts.length) ui.notifications.info(`Push ${basePush} ${parts.join(' ')} = Push ${totalPush}.`);

  game.user.targets.forEach(t => t.setTarget(false, { releaseOthers: false }));
  targetToken.setTarget(true, { releaseOthers: true });
  await runForcedMovement(['Push', String(totalPush), String(bonusCreatureDmg), String(bonusObjectDmg)]);
  targetToken.setTarget(true, { releaseOthers: true });
}
