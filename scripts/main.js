import { runForcedMovement } from './forced-movement.js';
import { WallBuilderPanel } from './wall-builder.js';
import { runKnockback } from './knockback.js';
import { registerChatHooks } from './chat-hooks.js';

const api = {
  forcedMovement: runForcedMovement,
  wallBuilder: () => {
    const existing = Object.values(ui.windows).find(w => w.id === 'wall-builder-panel');
    if (existing) existing.close();
    else new WallBuilderPanel().render(true);
  },
  knockback: runKnockback,
  socket: null,
};

Hooks.once('init', () => {
  game.modules.get('draw-steel-combat-tools').api = api;
  registerChatHooks();
});

Hooks.once('socketlib.ready', () => {
  const socket = socketlib.registerModule('draw-steel-combat-tools');
  api.socket = socket;

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
