export const hasTags    = (obj, tag)  => Tagger.hasTags(obj, tag);
export const getTags    = (obj)       => Tagger.getTags(obj);
export const getByTag   = (tag)       => Tagger.getByTag(tag);
export const addTags    = (obj, tags) => Tagger.addTags(obj, tags);
export const removeTags = (obj, tags) => Tagger.removeTags(obj, tags);

export const GRID = () => canvas.grid.size;

export const toGrid   = (world) => ({ x: Math.floor(world.x / GRID()), y: Math.floor(world.y / GRID()) });
export const toWorld  = (grid)  => ({ x: grid.x * GRID(), y: grid.y * GRID() });
export const toCenter = (grid)  => ({ x: grid.x * GRID() + GRID() / 2, y: grid.y * GRID() + GRID() / 2 });
export const gridEq   = (a, b)  => a.x === b.x && a.y === b.y;
export const gridDist = (a, b)  => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

export const MATERIAL_RULES = {
  glass: { cost: 1, damage: 3 },
  wood:  { cost: 3, damage: 5 },
  stone: { cost: 6, damage: 8 },
  metal: { cost: 9, damage: 11 },
};

export const MATERIAL_ICONS = {
  glass:  'icons/magic/light/beam-rays-yellow-blue-small.webp',
  wood:   'icons/commodities/wood/lumber-plank-brown.webp',
  stone:  'icons/commodities/stone/paver-brick-brown.webp',
  metal:  'icons/environment/traps/pressure-plate.webp',
  broken: 'icons/environment/settlement/building-rubble.webp',
};

export const MATERIAL_ALPHA = { glass: 0.1, wood: 0.8, stone: 0.8, metal: 0.8 };

export const WALL_RESTRICTIONS = {
  glass: { move: 20, sight: 0,  light: 0,  sound: 0 },
  wood:  { move: 20, sight: 10, light: 20, sound: 0 },
  stone: { move: 20, sight: 10, light: 20, sound: 0 },
  metal: { move: 20, sight: 10, light: 20, sound: 0 },
};

export const getMaterial = (obj) => {
  for (const mat of Object.keys(MATERIAL_RULES)) {
    if (hasTags(obj, mat)) return mat;
  }
  return 'wood';
};

export const tokenAt = (gx, gy, excludeId) => canvas.tokens.placeables.find(t => {
  if (t.id === excludeId) return false;
  const tg = toGrid(t.document);
  return tg.x === gx && tg.y === gy;
});

export const tileAt = (gx, gy) => canvas.tiles.placeables.find(t => {
  const tg = toGrid(t.document);
  return tg.x === gx && tg.y === gy;
});

export const segmentsIntersect = (ax, ay, bx, by, cx, cy, dx, dy) => {
  const cross = (ox, oy, px, py, qx, qy) => (px - ox) * (qy - oy) - (py - oy) * (qx - ox);
  const d1 = cross(cx, cy, dx, dy, ax, ay);
  const d2 = cross(cx, cy, dx, dy, bx, by);
  const d3 = cross(ax, ay, bx, by, cx, cy);
  const d4 = cross(ax, ay, bx, by, dx, dy);
  return (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
          ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)));
};

export const wallBetween = (fromGrid, toGrid_) => {
  const from = toCenter(fromGrid);
  const to   = toCenter(toGrid_);
  for (const w of canvas.walls.placeables) {
    const c = w.document.c;
    if (segmentsIntersect(from.x, from.y, to.x, to.y, c[0], c[1], c[2], c[3])) return w.document;
  }
  return null;
};

export const getSquadGroup = (actor) => {
  const combatant = game.combat?.combatants.find(c => c.actorId === actor.id);
  const group = combatant?.group;
  if (group?.type === 'squad') return group;
  return null;
};

const getSocket = () => game.modules.get('draw-steel-combat-tools').api.socket;

export const replayUndo = async (ops) => {
  for (const entry of ops) {
    try {
      const doc = await fromUuid(entry.uuid);
      if (!doc) continue;
      const obj = doc.object ?? doc;
      switch (entry.op) {
        case 'update':     await safeUpdate(doc, entry.data); break;
        case 'delete':     await safeDelete(doc); break;
        case 'addTags':    await addTags(obj, entry.tags); break;
        case 'removeTags': await removeTags(obj, entry.tags); break;
        case 'status':     await safeToggleStatusEffect(doc, entry.effectId, { active: entry.active }); break;
        case 'stamina':
          await safeUpdate(doc, { 'system.stamina.temporary': entry.prevTemp, 'system.stamina.value': entry.prevValue });
          if (entry.squadGroupUuid && entry.prevSquadHP !== null) {
            const sg = await fromUuid(entry.squadGroupUuid);
            if (sg) await safeUpdate(sg, { 'system.staminaValue': entry.prevSquadHP });
          }
          break;
      }
    } catch (e) {
      console.error('DSCT | replayUndo error on entry:', entry, e);
    }
  }
};

export const safeUpdate = async (document, data) => {
  if (document.isOwner) return await document.update(data);
  return await getSocket().executeAsGM('updateDocument', document.uuid, data);
};

export const safeDelete = async (document) => {
  if (document.isOwner) return await document.delete();
  return await getSocket().executeAsGM('deleteDocument', document.uuid);
};

export const safeCreateEmbedded = async (parent, type, data) => {
  if (parent.isOwner) return await parent.createEmbeddedDocuments(type, data);
  return await getSocket().executeAsGM('createEmbedded', parent.uuid, type, data);
};

export const safeToggleStatusEffect = async (actor, effectId, options = {}) => {
  if (actor.isOwner) return await actor.toggleStatusEffect(effectId, options);
  return await getSocket().executeAsGM('toggleStatusEffect', actor.uuid, effectId, options);
};

export const safeTakeDamage = async (actor, amount, options = {}) => {
  if (actor.isOwner) return await actor.system.takeDamage(amount, options);
  return await getSocket().executeAsGM('takeDamage', actor.uuid, amount, options);
};

export const applyDamage = async (actor, amount, squadGroupOverride = undefined) => {
  const prevValue   = actor.system.stamina.value;
  const prevTemp    = actor.system.stamina.temporary;
  const squadGroup  = squadGroupOverride !== undefined ? squadGroupOverride : getSquadGroup(actor);
  const prevSquadHP = squadGroup?.system?.staminaValue ?? null;
  await safeTakeDamage(actor, amount, { type: 'untyped', ignoredImmunities: [] });
  return { prevTemp, prevValue, prevSquadHP, squadGroup };
};

export const undoDamage = async (actor, { prevTemp, prevValue, prevSquadHP, squadGroup }) => {
  await safeUpdate(actor, { 'system.stamina.temporary': prevTemp, 'system.stamina.value': prevValue });
  if (squadGroup && prevSquadHP !== null) {
    await safeUpdate(squadGroup, { 'system.staminaValue': prevSquadHP });
  }
};

export const snapStamina = (actor) => ({
  prevValue:   actor.system.stamina.value,
  prevTemp:    actor.system.stamina.temporary,
  squadGroup:  getSquadGroup(actor),
  prevSquadHP: getSquadGroup(actor)?.system?.staminaValue ?? null,
});

export const hasFly = (actor) => {
  const types = actor?.system?.movement?.types;
  if (types instanceof Set) return types.has('fly');
  if (Array.isArray(types)) return types.includes('fly');
  return false;
};

export const sizeRank = (size) =>
  size.value >= 2 ? size.value + 2 : ({ T: 0, S: 1, M: 2, L: 3 })[size.letter] ?? 2;

export const canForcedMoveTarget = (attackerActor, targetActor) => {
  const targetSizeValue = targetActor?.system?.combat?.size?.value ?? 1;
  const might           = attackerActor?.system?.characteristics?.might?.value ?? 0;
  if (might >= 2 && targetSizeValue <= might) return true;
  const attackerRank = sizeRank(attackerActor?.system?.combat?.size ?? { value: 1, letter: 'M' });
  const targetRank   = sizeRank(targetActor?.system?.combat?.size ?? { value: 1, letter: 'M' });
  return attackerRank >= targetRank;
};

export const getItemDsid = (item) => item.system?._dsid ?? item.toObject().system?._dsid ?? null;

export const getItemRange = (item) => {
  const dist = item.system?.distance;
  if (!dist) return 0;
  const p = parseInt(dist.primary)   || 0;
  const s = parseInt(dist.secondary) || 0;
  const t = parseInt(dist.tertiary)  || 0;
  if (dist.type === 'meleeRanged')              return Math.max(p, s);
  if (dist.type === 'line')                      return p + t;
  if (dist.type === 'cube' || dist.type === 'wall') return p + s;
  return p;
};

export const getWallBlockTileAt = (gx, gy) => {
  return canvas.tiles.placeables.find(t => {
    const tg = toGrid(t.document);
    return tg.x === gx && tg.y === gy && hasTags(t, 'obstacle');
  }) ?? null;
};

export const getWallBlockWalls = (tile) => {
  const blockTag = getTags(tile).find(t => t.startsWith('wall-block-'));
  if (!blockTag) return { blockTag: null, walls: [] };
  return { blockTag, walls: getByTag(blockTag).filter(o => Array.isArray(o.c)) };
};

export const getWallBlockBottom = (tile) => {
  const { walls } = getWallBlockWalls(tile);
  return walls[0]?.flags?.['wall-height']?.bottom ?? null;
};

export const getWallBlockTop = (tile) => {
  const { walls } = getWallBlockWalls(tile);
  return walls[0]?.flags?.['wall-height']?.top ?? null;
};
