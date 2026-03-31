import { runForcedMovement } from './forced-movement.js';
import { WallBuilderPanel } from './wall-builder.js';
import { WallBuilderSettingsMenu, MATERIAL_RULE_DEFAULTS, WALL_RESTRICTION_DEFAULTS } from './wall-builder-settings.js';
import { registerChatHooks, refreshChatInjections } from './chat-hooks.js';
import { replayUndo } from './helpers.js';

const api = {
  forcedMovement: runForcedMovement,
  wallBuilder: () => {
    const existing = Object.values(ui.windows).find(w => w.id === 'wall-builder-panel');
    if (existing) existing.close();
    else new WallBuilderPanel().render(true);
  },
  socket: null,
};

Hooks.once('init', () => {
  game.modules.get('draw-steel-combat-tools').api = api;

  game.settings.registerMenu('draw-steel-combat-tools', 'wallBuilderSettings', {
    name:       'Wall Builder Settings',
    label:      'Configure Wall Builder',
    hint:       'Adjust material costs, damage values, wall restrictions, and wall builder defaults.',
    icon:       'fas fa-dungeon',
    type:       WallBuilderSettingsMenu,
    restricted: true,
  });

  game.settings.register('draw-steel-combat-tools', 'materialRules', {
    scope:   'world',
    config:  false,
    type:    Object,
    default: foundry.utils.deepClone(MATERIAL_RULE_DEFAULTS),
  });

  game.settings.register('draw-steel-combat-tools', 'wallRestrictions', {
    scope:   'world',
    config:  false,
    type:    Object,
    default: foundry.utils.deepClone(WALL_RESTRICTION_DEFAULTS),
  });

  game.settings.register('draw-steel-combat-tools', 'wbDefaultMaterial', {
    scope:   'world',
    config:  false,
    type:    String,
    default: 'stone',
  });

  game.settings.register('draw-steel-combat-tools', 'wbDefaultHeightBottom', {
    scope:   'world',
    config:  false,
    type:    String,
    default: '',
  });

  game.settings.register('draw-steel-combat-tools', 'wbDefaultHeightTop', {
    scope:   'world',
    config:  false,
    type:    String,
    default: '',
  });

  game.settings.register('draw-steel-combat-tools', 'animationStepDelay', {
    name:    'Movement Animation Step Delay (ms)',
    hint:    'Time in milliseconds between each square of animated forced movement. Set to 0 to disable animation.',
    scope:   'world',
    config:  true,
    type:    Number,
    default: 80,
    range:   { min: 0, max: 500, step: 10 },
  });

  game.settings.register('draw-steel-combat-tools', 'chatInjectDelay', {
    name:    'Chat Button Inject Delay (ms)',
    hint:    'Time in milliseconds to wait after a chat message renders before injecting forced movement buttons.',
    scope:   'world',
    config:  true,
    type:    Number,
    default: 500,
    range:   { min: 100, max: 2000, step: 100 },
  });

  game.settings.register('draw-steel-combat-tools', 'fallDamageCap', {
    name:    'Fall Damage Cap',
    hint:    'Maximum damage a creature can take from falling.',
    scope:   'world',
    config:  true,
    type:    Number,
    default: 50,
    range:   { min: 10, max: 200, step: 5 },
  });

  game.settings.register('draw-steel-combat-tools', 'gmBypassesRangeCheck', {
    name:    'GM Bypasses Range Check',
    hint:    'When enabled, the GM can execute forced movement from chat buttons regardless of range.',
    scope:   'world',
    config:  true,
    type:    Boolean,
    default: true,
  });

  game.settings.register('draw-steel-combat-tools', 'gmBypassesSizeCheck', {
    name:    'GM Bypasses Size Check',
    hint:    'When enabled, the GM can execute Knockback and Grab regardless of target size.',
    scope:   'world',
    config:  true,
    type:    Boolean,
    default: true,
  });

  registerChatHooks();

  game.keybindings.register('draw-steel-combat-tools', 'refreshChatInjections', {
    name:     'Refresh Chat Forced Movement Buttons',
    hint:     'Re-injects Execute buttons into any chat messages that have forced movement data.',
    editable: [{ key: 'KeyR', modifiers: ['Shift'] }],
    onDown:   () => { refreshChatInjections(); return true; },
  });
});

Hooks.once('socketlib.ready', () => {
  const socket = socketlib.registerModule('draw-steel-combat-tools');
  api.socket = socket;

  socket.register('setForcedMovementUndo', (undoLog) => {
    window._forcedMovementUndo = async () => {
      await replayUndo(undoLog);
      ui.notifications.info('Forced movement undone.');
    };
  });

  socket.register('updateDocument', async (uuid, data) => {
    const doc = await fromUuid(uuid);
    if (doc) return await doc.update(data);
  });

  socket.register('deleteDocument', async (uuid) => {
    const doc = await fromUuid(uuid);
    if (doc) return await doc.delete();
  });

  socket.register('createEmbedded', async (parentUuid, type, data) => {
    const parent = await fromUuid(parentUuid);
    if (parent) return await parent.createEmbeddedDocuments(type, data);
  });

  socket.register('toggleStatusEffect', async (uuid, effectId, options) => {
    const actor = await fromUuid(uuid);
    if (actor) return await actor.toggleStatusEffect(effectId, options);
  });

  socket.register('takeDamage', async (uuid, amount, options) => {
    const actor = await fromUuid(uuid);
    if (actor) return await actor.system.takeDamage(amount, options);
  });
});
