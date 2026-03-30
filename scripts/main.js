import { runForcedMovement } from './forced-movement.js';
import { WallBuilderPanel } from './wall-builder.js';
import { runKnockback } from './knockback.js';
import { registerChatHooks } from './chat-hooks.js';

const MAIN_VERSION = "v1.1.2 - API Init Fix";
console.log(`🔴 DSCT DEBUG | Loaded main.js - Version: ${MAIN_VERSION}`);

// 1. DEFINE THE API OBJECT (Safe to do immediately)
const api = {
  forcedMovement: runForcedMovement,
  wallBuilder: () => {
    const existing = Object.values(ui.windows).find(w => w.id === 'wall-builder-panel');
    if (existing) existing.close();
    else new WallBuilderPanel().render(true);
  },
  knockback: runKnockback,
  socket: null // Placeholder ready for socketlib
};

// 2. REGULAR INITIALIZATION
Hooks.once('init', () => {
  // Now that 'init' has fired, 'game.modules' actually exists!
  game.modules.get('draw-steel-combat-tools').api = api;
  registerChatHooks();
  console.log('Draw Steel: Combat Tools | Initialized.');
});

// 3. THE SOCKETLIB REGISTRATION
Hooks.once('socketlib.ready', () => {
  console.log('🔴 DSCT DEBUG | Registering with socketlib...');
  
  const socket = socketlib.registerModule('draw-steel-combat-tools');
  
  // Save the socket to our pre-built API
  api.socket = socket; 

  // Register the GM-only bypass functions
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

  socket.register('ping', (senderName) => {
    ui.notifications.info(`Socketlib Ping Received from ${senderName}!`);
  });

  console.log('🔴 DSCT DEBUG | Socketlib functions registered!');
});

// 4. PLAYER DIAGNOSTIC TOOL
Hooks.once('ready', () => {
  console.log('Draw Steel: Combat Tools | Ready.');

  window.DSCT = {
    testSocket: async () => {
      console.log('🔴 DSCT DEBUG | Sending Socketlib Ping...');
      const socket = game.modules.get('draw-steel-combat-tools').api.socket;
      if (socket) {
        await socket.executeAsGM('ping', game.user.name);
      } else {
        console.error('🔴 DSCT DEBUG | ERROR: DSCT Socket is not initialized! (Is the socketlib module enabled?)');
      }
    }
  };
});