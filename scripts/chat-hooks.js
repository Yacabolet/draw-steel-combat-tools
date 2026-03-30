import { runForcedMovement } from './forced-movement.js';

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
  return results;
};

const injectButtons = (msg, el) => {
  const data = msg.getFlag('draw-steel-combat-tools', 'forcedMovement');
  if (!data) return;
  if (el.querySelector('.dsct-forced-buttons')) return;

  const footer = el.querySelector('.message-part-buttons');
  const content = el.querySelector('.message-content');
  const target = footer ?? content ?? el;
  if (!target) return;

  const container = document.createElement('div');
  container.className = 'dsct-forced-buttons';
  container.style.cssText = 'display:contents;';

  for (const effect of data.effects) {
    const label = [
      `Execute ${effect.name} ${effect.distance}`,
      effect.vertical        ? '(vertical)'          : '',
      effect.ignoreStability ? '(ignores stability)' : '',
    ].filter(Boolean).join(' ');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.innerHTML = `<i class="fa-solid fa-person-walking-arrow-right"></i> ${label}`;
    btn.style.cssText = 'cursor:pointer;';
    btn.addEventListener('click', async () => {
      const api = game.modules.get('draw-steel-combat-tools')?.api;
      if (!api) { ui.notifications.error('Draw Steel: Combat Tools not active.'); return; }
      const type           = effect.movement.charAt(0).toUpperCase() + effect.movement.slice(1);
      const verticalHeight = effect.vertical ? String(effect.distance) : '';
      const kwArray        = data.keywords instanceof Set ? [...data.keywords] : (Array.isArray(data.keywords) ? data.keywords : []);
      const kw             = kwArray.join(',');
      await api.forcedMovement([type, String(effect.distance), '0', '0', verticalHeight, '0', 'false', String(effect.ignoreStability), 'false', kw]);
    });
    container.appendChild(btn);
  }

  target.appendChild(container);
};

export function registerChatHooks() {
  const trySetFlag = async (msg) => {
    if (msg.author.id !== game.user.id) return;
    if (msg.getFlag('draw-steel-combat-tools', 'forcedMovement')) return;

    const parts = msg.system?.parts?.contents ?? Object.values(msg.system?.parts ?? {});
    const abilityUse    = parts.find(p => p.type === 'abilityUse');
    const abilityResult = parts.find(p => p.type === 'abilityResult');

    if (!abilityUse?.abilityUuid || !abilityResult?.tier) return;

    const item = await fromUuid(abilityUse.abilityUuid);
    if (!item) return;

    const forced = getForcedEffects(item, abilityResult.tier);
    if (!forced.length) return;

    await msg.setFlag('draw-steel-combat-tools', 'forcedMovement', {
      effects: forced,
      keywords: Array.from(item.system?.keywords ?? []),
      speakerToken: msg.speaker?.token ?? null,
    });
  };

  const tryInject = (msg) => {
    setTimeout(() => {
      const liveEl = document.querySelector(`[data-message-id="${msg.id}"]`);
      if (liveEl) injectButtons(msg, liveEl);
    }, 500);
  };

  Hooks.on('createChatMessage', trySetFlag);
  Hooks.on('updateChatMessage', trySetFlag);
  Hooks.on('renderChatMessageHTML', (msg) => tryInject(msg));
  Hooks.on('updateChatMessage', (msg) => tryInject(msg));
}
