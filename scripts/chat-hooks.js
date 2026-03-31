import { runForcedMovement } from './forced-movement.js';
import { canForcedMoveTarget, getItemRange, getItemDsid } from './helpers.js';

console.log('DSCT | chat-hooks.js module loaded');

const getForcedEffects = (item, tier) => {
  const effectsCollection = item.system?.power?.effects;
  const effects = effectsCollection?.contents ?? Object.values(effectsCollection ?? {});
  const results = [];
  for (const effect of effects) {
    if (effect.type !== 'forced') continue;
    const tierData = effect.forced?.[`tier${tier}`];
    if (!tierData) continue;
    const distance = parseInt(tierData.distance);
    if (isNaN(distance) || distance <= 0) continue;
    const propertiesRaw = tierData.properties;
    const properties = Array.isArray(propertiesRaw) ? propertiesRaw
                     : propertiesRaw instanceof Set  ? [...propertiesRaw]
                     : (propertiesRaw?.contents ?? Object.values(propertiesRaw ?? {}));
    const vertical        = properties.includes('vertical');
    const ignoreStability = properties.includes('ignoresImmunity');
    for (const movement of (tierData.movement ?? [])) {
      results.push({ movement, distance, vertical, ignoreStability, name: effect.name ?? movement });
    }
  }
  console.log(`DSCT | getForcedEffects tier=${tier} found ${results.length} effect(s):`, results);
  return results;
};

const injectButtons = (msg, el) => {
  console.log(`DSCT | injectButtons called for msg ${msg.id}`);

  const data = msg.getFlag('draw-steel-combat-tools', 'forcedMovement');
  if (!data) { console.log('DSCT | injectButtons: no flag, skipping'); return; }

  if (el.querySelector('.dsct-forced-buttons')) { console.log('DSCT | injectButtons: buttons already present, skipping'); return; }

  const footer  = el.querySelector('.message-part-buttons');
  const content = el.querySelector('.message-content');
  const target  = footer ?? content ?? el;
  console.log(`DSCT | injectButtons: footer=${!!footer} content=${!!content} target.tagName=${target?.tagName}`);
  if (!target) { console.log('DSCT | injectButtons: no target element, skipping'); return; }

  console.log(`DSCT | injectButtons: effects=${data.effects?.length} dsid=${data.dsid} range=${data.range}`);

  const container = document.createElement('div');
  container.className = 'dsct-forced-buttons';
  container.style.cssText = 'display:contents;';

  for (const effect of data.effects) {
    console.log(`DSCT | injectButtons: building button for effect`, effect);
    const label = [
      effect.vertical ? 'Vertical' : '',
      `${effect.movement.charAt(0).toUpperCase() + effect.movement.slice(1)} ${effect.distance}`,
    ].filter(Boolean).join(' ');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.innerHTML = `<i class="fa-solid fa-person-walking-arrow-right"></i> ${label}`;
    btn.style.cssText = 'cursor:pointer;';
    btn.addEventListener('click', async () => {
      console.log('DSCT | button clicked for effect', effect);
      const api = game.modules.get('draw-steel-combat-tools')?.api;
      if (!api) { ui.notifications.error('Draw Steel: Combat Tools not active.'); return; }

      const targets    = [...game.user.targets];
      const controlled = canvas.tokens.controlled;
      const target     = targets.length === 1 ? targets[0] : null;
      const source     = targets.length === 1 && controlled.length === 1 ? controlled[0] : null;
      console.log(`DSCT | click: targets=${targets.length} controlled=${controlled.length} source=${source?.name} target=${target?.name}`);

      if (!game.user.isGM && (data.dsid === 'knockback' || data.dsid === 'grab')) {
        if (source && target && !canForcedMoveTarget(source.actor, target.actor)) {
          ui.notifications.warn(`${source.name} cannot force-move ${target.name} (size too large for their Might and size).`);
          return;
        }
      }

      const type           = effect.movement.charAt(0).toUpperCase() + effect.movement.slice(1);
      const verticalHeight = effect.vertical ? String(effect.distance) : '';
      const kwArray        = data.keywords instanceof Set ? [...data.keywords] : (Array.isArray(data.keywords) ? data.keywords : []);
      const kw             = kwArray.join(',');
      const args = [type, String(effect.distance), '0', '0', verticalHeight, '0', 'false', String(effect.ignoreStability), 'false', kw, String(data.range ?? 0)];
      console.log('DSCT | calling api.forcedMovement with args:', args);
      await api.forcedMovement(args);
    });
    container.appendChild(btn);
  }

  target.appendChild(container);
  console.log(`DSCT | injectButtons: appended ${data.effects.length} button(s)`);
};

export function registerChatHooks() {
  console.log('DSCT | registerChatHooks called');

  const trySetFlag = async (msg) => {
    console.log(`DSCT | trySetFlag called for msg ${msg.id} author=${msg.author?.id} me=${game.user?.id}`);
    if (msg.author.id !== game.user.id) { console.log('DSCT | trySetFlag: not my message, skipping'); return; }
    if (msg.getFlag('draw-steel-combat-tools', 'forcedMovement')) { console.log('DSCT | trySetFlag: flag already set, skipping'); return; }

    const parts         = msg.system?.parts?.contents ?? Object.values(msg.system?.parts ?? {});
    const abilityUse    = parts.find(p => p.type === 'abilityUse');
    const abilityResult = parts.find(p => p.type === 'abilityResult');
    console.log(`DSCT | trySetFlag: parts=${parts.length} abilityUse=${!!abilityUse} abilityResult=${!!abilityResult} tier=${abilityResult?.tier}`);

    if (!abilityUse?.abilityUuid || !abilityResult?.tier) { console.log('DSCT | trySetFlag: missing abilityUse or tier, skipping'); return; }

    const item = await fromUuid(abilityUse.abilityUuid);
    console.log(`DSCT | trySetFlag: item=${item?.name} uuid=${abilityUse.abilityUuid}`);
    if (!item) { console.log('DSCT | trySetFlag: item not found, skipping'); return; }

    const forced = getForcedEffects(item, abilityResult.tier);
    if (!forced.length) { console.log('DSCT | trySetFlag: no forced effects found, skipping'); return; }

    const range = getItemRange(item);
    const dsid  = getItemDsid(item);
    console.log(`DSCT | trySetFlag: setting flag — dsid=${dsid} range=${range} effects=${forced.length}`);

    await msg.setFlag('draw-steel-combat-tools', 'forcedMovement', {
      effects:      forced,
      keywords:     Array.from(item.system?.keywords ?? []),
      range,
      dsid,
      speakerToken: msg.speaker?.token ?? null,
    });
    console.log(`DSCT | trySetFlag: flag set successfully on msg ${msg.id}`);
  };

  const tryInject = (msg) => {
    console.log(`DSCT | tryInject queued for msg ${msg.id}`);
    setTimeout(() => {
      const liveEl = document.querySelector(`[data-message-id="${msg.id}"]`);
      console.log(`DSCT | tryInject firing for msg ${msg.id} — DOM el found: ${!!liveEl}`);
      if (liveEl) injectButtons(msg, liveEl);
    }, 500);
  };

  Hooks.on('createChatMessage',     (msg) => { console.log(`DSCT | hook createChatMessage ${msg.id}`); trySetFlag(msg); });
  Hooks.on('updateChatMessage',     (msg) => { console.log(`DSCT | hook updateChatMessage ${msg.id}`); trySetFlag(msg); tryInject(msg); });
  Hooks.on('renderChatMessageHTML', (msg) => {
    console.log(`DSCT | hook renderChatMessageHTML ${msg.id}`);
    trySetFlag(msg).then(() => tryInject(msg));
  });
}

export function refreshChatInjections() {
  console.log('DSCT | refreshChatInjections called');
  ui.chat.render(true);
}
