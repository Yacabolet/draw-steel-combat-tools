import { runForcedMovement, toggleForcedMovementPanel, registerForcedMovementHooks } from './forced-movement.js';
import { WallBuilderPanel } from './wall-builder.js';
import { WallBuilderSettingsMenu, MATERIAL_RULE_DEFAULTS, WALL_RESTRICTION_DEFAULTS } from './wall-builder-settings.js';
import { registerChatHooks, refreshChatInjections } from './chat-hooks.js';
import { runGrab, toggleGrabPanel, endGrab, registerGrabHooks } from './grab.js';
import { replayUndo } from './helpers.js';
import { applyJudgement, applyMark, registerTacticalHooks } from './tactical-effects.js';
import { registerDeathTrackerHooks, runReviveUI, runPowerWordKillUI } from './death-tracker.js';
import { applySquadLabels, autoRenameGroups, registerSquadLabelHooks } from './squad-labels.js';
import { applyTriggeredActions, registerTriggeredActionHooks } from './triggered-actions.js';
import { registerModuleButtons } from './module-buttons.js';

const MAIN_VERSION = "v0.3.5 - Undo Expired Fix";
console.log(`🔴 DSCT DEBUG | Loaded main.js - Version: ${MAIN_VERSION}`);

const api = {
  forcedMovement: runForcedMovement,
  grab:           runGrab,
  wallBuilder: () => {
    const existing = Object.values(ui.windows).find(w => w.id === 'wall-builder-panel');
    if (existing) existing.close();
    else new WallBuilderPanel().render(true);
  },
  grabPanel: toggleGrabPanel,
  endGrab: endGrab,
  revive: runReviveUI,
  powerWordKill: runPowerWordKillUI,
  judgement: applyJudgement,
  mark: applyMark,
  forcedMovementUI: toggleForcedMovementPanel,
  squadLabels: applySquadLabels,
  renameSquads: autoRenameGroups,
  triggeredActions: applyTriggeredActions,
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

  game.settings.register('draw-steel-combat-tools', 'materialRules', { scope: 'world', config: false, type: Object, default: foundry.utils.deepClone(MATERIAL_RULE_DEFAULTS) });
  game.settings.register('draw-steel-combat-tools', 'wallRestrictions', { scope: 'world', config: false, type: Object, default: foundry.utils.deepClone(WALL_RESTRICTION_DEFAULTS) });
  game.settings.register('draw-steel-combat-tools', 'wbDefaultMaterial', { scope: 'world', config: false, type: String, default: 'stone' });
  game.settings.register('draw-steel-combat-tools', 'wbDefaultHeightBottom', { scope: 'world', config: false, type: String, default: '' });
  game.settings.register('draw-steel-combat-tools', 'wbDefaultHeightTop', { scope: 'world', config: false, type: String, default: '' });

  game.settings.register('draw-steel-combat-tools', 'animationStepDelay', {
    name: 'Movement Animation Step Delay (ms)', hint: 'Time in milliseconds between each square of animated forced movement. Set to 0 to disable animation.',
    scope: 'world', config: true, type: Number, default: 80, range: { min: 0, max: 500, step: 10 }
  });

  game.settings.register('draw-steel-combat-tools', 'chatInjectDelay', {
    name: 'Chat Button Inject Delay (ms)', hint: 'Time in milliseconds to wait after a chat message renders before injecting forced movement buttons.',
    scope: 'world', config: true, type: Number, default: 500, range: { min: 100, max: 2000, step: 100 }
  });

  game.settings.register('draw-steel-combat-tools', 'fallDamageCap', {
    name: 'Fall Damage Cap', hint: 'Maximum damage a creature can take from falling.',
    scope: 'world', config: true, type: Number, default: 50, range: { min: 10, max: 200, step: 5 }
  });

  game.settings.register('draw-steel-combat-tools', 'gmBypassesRangeCheck', {
    name: 'GM Bypasses Range Check', hint: 'When enabled, the GM can execute forced movement from chat buttons regardless of range.',
    scope: 'world', config: true, type: Boolean, default: true
  });

  game.settings.register('draw-steel-combat-tools', 'gmBypassesSizeCheck', {
    name: 'GM Bypasses Size Check', hint: 'When enabled, the GM can execute Knockback and Grab regardless of target size.',
    scope: 'world', config: true, type: Boolean, default: true
  });

  game.settings.register('draw-steel-combat-tools', 'aidEdgeUuid', {
    name: 'Aid Edge Effect UUID', hint: 'UUID of an Active Effect that grants an edge on a roll. Used by the Grab system.',
    scope: 'world', config: true, type: String, default: ''
  });

  game.settings.register('draw-steel-combat-tools', 'deathTrackerEnabled', {
    name: 'Enable Death Tracker', hint: 'Automatically removes dead enemies from combat, triggers a death animation, and places a skull marker.',
    scope: 'world', config: true, type: Boolean, default: true
  });

  game.settings.register('draw-steel-combat-tools', 'deathAnimationDuration', {
    name: 'Death Animation Duration (ms)', hint: 'How long the red fade-out animation lasts before the token is removed. Set to 0 to skip.',
    scope: 'world', config: true, type: Number, default: 2000, range: { min: 0, max: 5000, step: 100 }
  });

  game.settings.register('draw-steel-combat-tools', 'clearSkullsOnCombatEnd', {
    name: 'Clear Skulls on Combat End', hint: 'If enabled, all skull tiles placed by the tracker during a combat encounter will be deleted when combat ends.',
    scope: 'world', config: true, type: Boolean, default: false
  });

  game.settings.register('draw-steel-combat-tools', 'clearEffectsOnRevive', {
    name: 'Clear Effects on Revive', hint: 'If enabled, reviving a creature will automatically remove all of their active conditions and effects (except core system states like Winded).',
    scope: 'world', config: true, type: Boolean, default: false
  });

  game.settings.register('draw-steel-combat-tools', 'deathTrackerSkullIds', {
    scope: 'world', config: false, type: Array, default: []
  });

  game.settings.register('draw-steel-combat-tools', 'autoSquadLabelsEnabled', {
    name: 'Auto-Apply Squad Labels', hint: 'Automatically apply squad label icons to tokens when combat starts.',
    scope: 'world', config: true, type: Boolean, default: true
  });

  game.settings.register('draw-steel-combat-tools', 'autoTriggeredActionsEnabled', {
    name: 'Auto-Apply Triggered Action Tracker', hint: 'Automatically place the Unspent Triggered Action effect on combatants when combat starts.',
    scope: 'world', config: true, type: Boolean, default: true
  });

  game.settings.register('draw-steel-combat-tools', 'autoTriggeredActionsTarget', {
    name: 'Auto-Apply Tracker Targets', hint: 'Who should receive the Triggered Action tracker at the start of combat?',
    scope: 'world', config: true, type: String,
    choices: { 'ALL': 'All Combatants', 'HEROES': 'Heroes Only', 'NPCS': 'NPCs Only' },
    default: 'ALL'
  });

  game.settings.register('draw-steel-combat-tools', 'restrictGrabButtons', {
    name: 'Restrict Manual Grab Buttons to GM', hint: 'If enabled, only the GM can see and click the Apply Grab and End Grab buttons in the Grab Panel.',
    scope: 'world', config: true, type: Boolean, default: false
  });

  registerChatHooks();
  registerGrabHooks(); 
  registerTacticalHooks();
  registerDeathTrackerHooks();
  registerSquadLabelHooks();
  registerTriggeredActionHooks();
  registerModuleButtons();
  registerForcedMovementHooks();

  game.keybindings.register('draw-steel-combat-tools', 'refreshChatInjections', {
    name: 'Refresh Chat Forced Movement Buttons', hint: 'Re-injects Execute buttons into any chat messages that have forced movement data.',
    editable: [{ key: 'KeyR', modifiers: ['Shift'] }],
    onDown: () => { refreshChatInjections(); return true; },
  });
});

Hooks.once('socketlib.ready', () => {
  const socket = socketlib.registerModule('draw-steel-combat-tools');
  api.socket = socket;

  socket.register('updateDocument', async (uuid, data, options = {}) => { const doc = await fromUuid(uuid); if (doc) return await doc.update(data, options); });
  socket.register('deleteDocument', async (uuid) => { const doc = await fromUuid(uuid); if (doc) return await doc.delete(); });
  socket.register('createEmbedded', async (parentUuid, type, data) => { const parent = await fromUuid(parentUuid); if (parent) return await parent.createEmbeddedDocuments(type, data); });
  socket.register('toggleStatusEffect', async (uuid, effectId, options) => { const actor = await fromUuid(uuid); if (actor) return await actor.toggleStatusEffect(effectId, options); });
  socket.register('takeDamage', async (uuid, amount, options) => { const actor = await fromUuid(uuid); if (actor) return await actor.system.takeDamage(amount, options); });
});