import { runForcedMovement } from './forced-movement.js';
import { runGrab } from './grab.js';
import { canForcedMoveTarget, getItemRange, getItemDsid, getSetting } from './helpers.js';

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

const hasGrabEffect = (item, tier) => {
  const dsid = item.system?._dsid ?? item.toObject().system?._dsid;
  if (dsid === 'grab') return tier >= 2;

  const effectsCollection = item.system?.power?.effects;
  const effects = effectsCollection?.contents ?? Object.values(effectsCollection ?? {});
  for (const effect of effects) {
    const tierData = effect[effect.type]?.[`tier${tier}`] ?? effect[`tier${tier}`];
    if (!tierData) continue;
    const conditions = tierData.conditions ?? tierData.statuses ?? tierData.status ?? [];
    const arr = Array.isArray(conditions) ? conditions
              : conditions instanceof Set ? [...conditions]
              : Object.values(conditions ?? {});
    if (arr.some(c => String(c?.id ?? c?.name ?? c).toLowerCase() === 'grabbed')) return true;
  }
  return false;
};

const injectForcedButtons = (msg, el) => {
  const data = msg.getFlag('draw-steel-combat-tools', 'forcedMovement');
  if (!data) return;
  if (el.querySelector('.dsct-forced-buttons')) return;

  const footer  = el.querySelector('.message-part-buttons');
  const content = el.querySelector('.message-content');
  const target  = footer ?? content ?? el;
  if (!target) return;

  const container = document.createElement('div');
  container.className = 'dsct-forced-buttons';
  container.style.cssText = 'display:contents;';

  for (const effect of data.effects) {
    const label = [
      effect.vertical ? 'Vertical' : '',
      `${effect.movement.charAt(0).toUpperCase() + effect.movement.slice(1)} ${effect.distance}`,
    ].filter(Boolean).join(' ');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.innerHTML = `<i class="fa-solid fa-person-walking-arrow-right"></i> ${label}`;
    btn.style.cssText = 'cursor:pointer;';
    btn.addEventListener('click', async () => {
      const api = game.modules.get('draw-steel-combat-tools')?.api;
      if (!api) { ui.notifications.error('Draw Steel: Combat Tools not active.'); return; }

      const targets    = [...game.user.targets];
      const controlled = canvas.tokens.controlled;
      const target     = targets.length === 1 ? targets[0] : null;
      const source     = targets.length === 1 && controlled.length === 1 ? controlled[0] : null;

      if (!(game.user.isGM && getSetting('gmBypassesSizeCheck')) && (data.dsid === 'knockback' || data.dsid === 'grab')) {
        if (source && target && !canForcedMoveTarget(source.actor, target.actor)) {
          ui.notifications.warn(`${source.name} cannot force-move ${target.name} (size too large for their Might and size).`);
          return;
        }
      }

      const type           = effect.movement.charAt(0).toUpperCase() + effect.movement.slice(1);
      const verticalHeight = effect.vertical ? String(effect.distance) : '';
      const kwArray        = data.keywords instanceof Set ? [...data.keywords] : (Array.isArray(data.keywords) ? data.keywords : []);
      const kw             = kwArray.join(',');
      await api.forcedMovement([type, String(effect.distance), '0', '0', verticalHeight, '0', 'false', String(effect.ignoreStability), 'false', kw, String(data.range ?? 0)]);
    });
    container.appendChild(btn);
  }

  target.appendChild(container);
};

const injectGrabButton = (msg, el) => {
  const data = msg.getFlag('draw-steel-combat-tools', 'grab');
  if (!data) return;

  // Surgically target the exact native Draw Steel grabbed button
  const nativeBtns = el.querySelectorAll('button[data-action="applyEffect"][data-effect-id="grabbed"]');
  if (!nativeBtns.length) return;

  for (const btn of nativeBtns) {
    // Create our replacement button
    const newBtn = document.createElement('button');
    newBtn.type = 'button';
    newBtn.className = 'dsct-grab-btn';
    // Use a slightly different icon and text so you know it successfully hijacked!
    newBtn.innerHTML = '<i class="fa-solid fa-hand-rock"></i> Execute Grab';
    newBtn.style.cssText = btn.style.cssText || 'cursor:pointer; background: rgba(122, 80, 192, 0.2); border: 1px solid #7a50c0; color: var(--color-text-dark-primary);';

    newBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const api = game.modules.get('draw-steel-combat-tools')?.api;
      if (!api) { ui.notifications.error('Draw Steel: Combat Tools not active.'); return; }

      const targets    = [...game.user.targets];
      const controlled = canvas.tokens.controlled;
      
      // Get the token of whoever rolled the ability from the chat message
      const speakerTok = data.speakerToken ? canvas?.tokens?.get(data.speakerToken) : null;

      // If the user has exactly 1 token controlled, use that. Otherwise fallback to the chat speaker.
      const grabber = controlled.length === 1 ? controlled[0] : speakerTok;
      const grabbed = targets.length === 1 ? targets[0] : null;

      if (!grabber) { ui.notifications.warn('Control the grabber token or ensure the ability speaker token is on the canvas.'); return; }
      if (!grabbed) { ui.notifications.warn('Target the creature to be grabbed.'); return; }

      // Fire off the API method (which natively handles the Tier logic and spawns the UI if Tier 2)
      await api.grab(grabber, grabbed, { tier: data.tier });
    });

    // Replace the native button with our new one
    btn.replaceWith(newBtn);
  }
};

export function registerChatHooks() {
  const trySetFlag = async (msg) => {
    if (msg.author.id !== game.user.id) return;

    const parts         = msg.system?.parts?.contents ?? Object.values(msg.system?.parts ?? {});
    const abilityUse    = parts.find(p => p.type === 'abilityUse');
    const abilityResult = parts.find(p => p.type === 'abilityResult');
    if (!abilityUse?.abilityUuid || !abilityResult?.tier) return;

    const item = await fromUuid(abilityUse.abilityUuid);
    if (!item) return;

    const dsid = getItemDsid(item);
    const tier = abilityResult.tier;

    if (!msg.getFlag('draw-steel-combat-tools', 'forcedMovement')) {
      const forced = getForcedEffects(item, tier);
      if (forced.length) {
        const range = getItemRange(item);
        await msg.setFlag('draw-steel-combat-tools', 'forcedMovement', {
          effects:      forced,
          keywords:     Array.from(item.system?.keywords ?? []),
          range,
          dsid,
          speakerToken: msg.speaker?.token ?? null,
        });
      }
    }

    if (!msg.getFlag('draw-steel-combat-tools', 'grab')) {
      if (hasGrabEffect(item, tier)) {
        await msg.setFlag('draw-steel-combat-tools', 'grab', {
          speakerToken: msg.speaker?.token ?? null,
          tier,
          dsid,
        });
      }
    }
  };

  const tryInject = (msg) => {
    setTimeout(() => {
      const liveEl = document.querySelector(`[data-message-id="${msg.id}"]`);
      if (!liveEl) return;
      injectForcedButtons(msg, liveEl);
      injectGrabButton(msg, liveEl);
    }, getSetting('chatInjectDelay'));
  };

  Hooks.on('createChatMessage',     (msg) => trySetFlag(msg));
  Hooks.on('updateChatMessage',     (msg) => { trySetFlag(msg); tryInject(msg); });
  Hooks.on('renderChatMessageHTML', (msg) => trySetFlag(msg).then(() => tryInject(msg)));
}

export function refreshChatInjections() {
  ui.chat.render(true);
}
