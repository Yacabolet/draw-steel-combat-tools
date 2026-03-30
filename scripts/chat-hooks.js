import { runForcedMovement } from './forced-movement.js';

const CHAT_VERSION = "v1.0.5 - HTML Hook Fix";
console.log(`🔴 DSCT DEBUG | Loaded chat-hooks.js - Version: ${CHAT_VERSION}`);

const getForcedEffects = (item, tier) => {
  const effectsCollection = item.system?.power?.effects;
  const effects = effectsCollection?.contents ?? Object.values(effectsCollection ?? {});
  const results = [];
  for (const effect of effects) {
    if (effect.type !== 'forced') continue;
    const tierData = effect.forced?.[`tier${tier}`];
    if (!tierData) continue;
    const distance        = parseInt(tierData.distance);
    if (isNaN(distance) || distance <= 0) continue;
    const propertiesRaw   = tierData.properties;
    const properties      = Array.isArray(propertiesRaw) ? propertiesRaw
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
  
  // Prevent duplicate injections
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
  
  // Logic to attach our custom flag to the message
  const trySetFlag = async (msg) => {
    // Only the person rolling should write to the database to prevent duplicate writes
    if (msg.author.id !== game.user.id) return;
    
    // If the flag is already there, our job is done
    if (msg.getFlag('draw-steel-combat-tools', 'forcedMovement')) return;

    const parts = msg.system?.parts?.contents ?? Object.values(msg.system?.parts ?? {});
    const abilityUse    = parts.find(p => p.type === 'abilityUse');
    const abilityResult = parts.find(p => p.type === 'abilityResult');
    
    // If Draw Steel hasn't attached the tier data yet, abort and wait for the next update
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
    console.log('🔴 DSCT DEBUG | Flag set successfully on msg:', msg.id);
  };

  // Logic to actually put the HTML button on the screen
  const tryInject = (msg) => {
    // Yield the thread to let Draw Steel finish its own async HTML rendering
    setTimeout(() => {
      const liveEl = document.querySelector(`[data-message-id="${msg.id}"]`);
      if (liveEl) injectButtons(msg, liveEl);
    }, 500);
  };

  // Listen for both creation and subsequent system updates to catch the tier data
  Hooks.on('createChatMessage', trySetFlag);
  Hooks.on('updateChatMessage', trySetFlag);

  // V13 COMPATIBLE: Attempt to inject whenever the message initially renders or when our flag is added
  Hooks.on('renderChatMessageHTML', (msg) => tryInject(msg));
  Hooks.on('updateChatMessage', (msg) => tryInject(msg));
}