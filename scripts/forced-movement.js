import {
  hasTags, getTags, getByTag, addTags, removeTags,
  GRID as getGRID,
  toGrid, toWorld, toCenter, gridEq, gridDist,
  MATERIAL_RULES, MATERIAL_ICONS, MATERIAL_ALPHA, WALL_RESTRICTIONS,
  getMaterial, tokenAt, tileAt, segmentsIntersect, wallBetween,
  getSquadGroup, applyDamage, undoDamage, snapStamina,
  hasFly, getWallBlockTileAt, getWallBlockTop, getWallBlockBottom,
  sizeRank,
  safeUpdate, safeDelete, safeCreateEmbedded, safeToggleStatusEffect,
} from './helpers.js';

const parseType = (raw) => {
  const t = (raw ?? '').toLowerCase();
  if (t === 'push')  return 'Push';
  if (t === 'pull')  return 'Pull';
  if (t === 'slide') return 'Slide';
  return null;
};

const chooseFreeSquare = (targetToken) => new Promise((resolve) => {
  const GRID = getGRID();
  const size = targetToken.actor?.system?.combat?.size?.value ?? 1;
  const tg   = toGrid(targetToken.document);

  const getAdjacentRing = (radius) => {
    const squares = [];
    const minX = tg.x - radius, maxX = tg.x + size - 1 + radius;
    const minY = tg.y - radius, maxY = tg.y + size - 1 + radius;
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        if (x !== minX && x !== maxX && y !== minY && y !== maxY) continue;
        if (x >= tg.x && x < tg.x + size && y >= tg.y && y < tg.y + size) continue;
        squares.push({ x, y });
      }
    }
    return squares;
  };

  const isSquareFree = (gx, gy) => {
    if (tokenAt(gx, gy, targetToken.id)) return false;
    const t = tileAt(gx, gy);
    if (t && hasTags(t, 'obstacle') && !hasTags(t, 'broken')) return false;
    return true;
  };

  let candidates = [];
  for (let r = 1; r <= 10 && candidates.length === 0; r++) {
    candidates = getAdjacentRing(r).filter(g => isSquareFree(g.x, g.y));
  }

  if (candidates.length === 0) { resolve(null); return; }

  const graphics = new PIXI.Graphics();
  canvas.app.stage.addChild(graphics);

  const redraw = (hoverGrid) => {
    graphics.clear();
    for (const g of candidates) {
      const isHover = hoverGrid && g.x === hoverGrid.x && g.y === hoverGrid.y;
      graphics.beginFill(0x44cc44, isHover ? 0.6 : 0.3);
      graphics.drawRect(g.x * GRID, g.y * GRID, GRID, GRID);
      graphics.endFill();
    }
  };

  const overlay = new PIXI.Container();
  overlay.interactive = true;
  overlay.hitArea = new PIXI.Rectangle(0, 0, canvas.dimensions.width, canvas.dimensions.height);
  canvas.app.stage.addChild(overlay);
  let hoverGrid = null;

  const onMove = (e) => {
    const pos  = e.data.getLocalPosition(canvas.app.stage);
    const gpos = toGrid(pos);
    hoverGrid  = candidates.find(g => g.x === gpos.x && g.y === gpos.y) ?? null;
    redraw(hoverGrid);
  };

  const onClick = (e) => {
    const pos    = e.data.getLocalPosition(canvas.app.stage);
    const gpos   = toGrid(pos);
    const chosen = candidates.find(g => g.x === gpos.x && g.y === gpos.y);
    if (!chosen) return;
    cleanup();
    resolve(chosen);
  };

  const onKeyDown = (e) => { if (e.key === 'Escape') { cleanup(); resolve(null); } };

  const cleanup = () => {
    overlay.off('pointermove', onMove);
    overlay.off('pointerdown', onClick);
    document.removeEventListener('keydown', onKeyDown);
    canvas.app.stage.removeChild(overlay);
    canvas.app.stage.removeChild(graphics);
    graphics.destroy();
    overlay.destroy();
  };

  overlay.on('pointermove', onMove);
  overlay.on('pointerdown', onClick);
  document.addEventListener('keydown', onKeyDown);
  redraw(null);
  ui.notifications.info(`Choose where ${targetToken.name} lands. Escape to skip.`);
});

const breakTileFromTop = async (tile, fallDmg, undoOps, collisionMsgs, targetToken) => {
  const blockTag = getTags(tile).find(t => t.startsWith('wall-block-'));
  if (!blockTag) return null;
  const mat   = getMaterial(tile);
  const walls = getByTag(blockTag).filter(o => Array.isArray(o.c));
  const tileBottom    = walls[0]?.flags?.['wall-height']?.bottom ?? 0;
  const tileTop       = walls[0]?.flags?.['wall-height']?.top    ?? 1;
  const tileHeight    = tileTop - tileBottom;
  const costPerSquare = MATERIAL_RULES[mat]?.cost ?? 3;
  const squaresBroken = Math.min(Math.floor(fallDmg / costPerSquare), tileHeight);

  if (squaresBroken === 0) return tileTop - 1;

  const prevDamagedTag = getTags(tile).find(t => t.startsWith('damaged:'));
  const prevDamagedN   = prevDamagedTag ? parseInt(prevDamagedTag.split(':')[1]) : 0;
  const newDamagedN    = prevDamagedN + squaresBroken;

  if (squaresBroken >= tileHeight) {
    for (const w of walls) {
      await safeUpdate(w, { move: 0, sight: 0, light: 0, sound: 0 });
      if (game.user.isGM) await addTags(w, ['broken']);
    }
    await safeUpdate(tile.document, { 'texture.src': MATERIAL_ICONS.broken, alpha: 0.8 });
    if (game.user.isGM) await addTags(tile, ['broken']);

    undoOps.push(async () => {
      const restrict = WALL_RESTRICTIONS[mat] ?? WALL_RESTRICTIONS.stone;
      for (const w of walls) {
        await safeUpdate(w, restrict);
        if (game.user.isGM) await removeTags(w, ['broken']);
        await safeUpdate(w, { 'flags.wall-height.top': tileTop, 'flags.wall-height.bottom': tileBottom });
      }
      await safeUpdate(tile.document, { 'texture.src': MATERIAL_ICONS[mat] ?? MATERIAL_ICONS.stone, alpha: MATERIAL_ALPHA[mat] ?? 0.8 });
      if (game.user.isGM) {
        await removeTags(tile, ['broken']);
        if (prevDamagedTag) await addTags(tile, [prevDamagedTag]);
      }
    });
    collisionMsgs.push(`${targetToken.name} crashes through the entire ${mat} object (${tileHeight} square${tileHeight !== 1 ? 's' : ''}).`);
    return tileBottom;
  }

  const newTop = tileTop - squaresBroken;
  for (const w of walls) await safeUpdate(w, { 'flags.wall-height.top': newTop });
  if (game.user.isGM) {
    if (prevDamagedTag) await removeTags(tile, [prevDamagedTag]);
    await addTags(tile, [`damaged:${newDamagedN}`]);
  }

  undoOps.push(async () => {
    for (const w of walls) await safeUpdate(w, { 'flags.wall-height.top': tileTop });
    if (game.user.isGM) {
      await removeTags(tile, [`damaged:${newDamagedN}`]);
      if (prevDamagedTag) await addTags(tile, [prevDamagedTag]);
    }
  });
  collisionMsgs.push(`${targetToken.name} breaks ${squaresBroken} square${squaresBroken !== 1 ? 's' : ''} off the top of the ${mat} object (${tileHeight} tall, now ${newTop - tileBottom} remain).`);
  return newTop - 1;
};

const splitTileAtElevation = async (tile, splitElev, undoOps, collisionMsgs) => {
  const GRID     = getGRID();
  const blockTag = getTags(tile).find(t => t.startsWith('wall-block-'));
  if (!blockTag) return;
  const origId     = blockTag.replace('wall-block-', '');
  const mat        = getMaterial(tile);
  const walls      = getByTag(blockTag).filter(o => Array.isArray(o.c));
  const tileBottom = walls[0]?.flags?.['wall-height']?.bottom ?? 0;
  const tileTop    = walls[0]?.flags?.['wall-height']?.top    ?? 1;
  const restrict   = WALL_RESTRICTIONS[mat] ?? WALL_RESTRICTIONS.stone;

  if (splitElev <= tileBottom || splitElev >= tileTop) return;

  const botTag = `wall-block-${origId}-bot`;
  const topTag = `wall-block-${origId}-top`;

  for (const w of walls) {
    await safeUpdate(w, { 'flags.wall-height.top': splitElev });
    if (game.user.isGM) {
      await removeTags(w, [blockTag]);
      await addTags(w, [botTag, 'damaged:0']);
    }
  }

  if (game.user.isGM) {
    await removeTags(tile, [blockTag]);
    await addTags(tile, [botTag]);
  }

  const tg = toGrid(tile.document);
  const edges = [
    [tg.x * GRID, tg.y * GRID,         (tg.x + 1) * GRID, tg.y * GRID],
    [tg.x * GRID, (tg.y + 1) * GRID,   (tg.x + 1) * GRID, (tg.y + 1) * GRID],
    [tg.x * GRID, tg.y * GRID,          tg.x * GRID,       (tg.y + 1) * GRID],
    [(tg.x + 1) * GRID, tg.y * GRID,   (tg.x + 1) * GRID, (tg.y + 1) * GRID],
  ];

  const topTileAllTags = ['obstacle', 'breakable', topTag, mat, 'broken'];
  const createdTiles = await safeCreateEmbedded(canvas.scene, 'Tile', [{
    x: tg.x * GRID, y: tg.y * GRID,
    width: GRID, height: GRID,
    elevation: splitElev,
    texture: { src: MATERIAL_ICONS.broken },
    alpha: 0.8, hidden: false, locked: false,
    occlusion: { mode: 0, alpha: 0 }, restrictions: { light: false, weather: false },
    video: { loop: false, autoplay: false, volume: 0 },
    flags: { tagger: { tags: topTileAllTags } },
  }]);

  for (const [x1, y1, x2, y2] of edges) {
    await safeCreateEmbedded(canvas.scene, 'Wall', [{
      c: [x1, y1, x2, y2], move: 0, sight: 0, light: 0, sound: 0,
      dir: 0, door: 0,
      flags: { 'wall-height': { bottom: splitElev, top: tileTop }, tagger: { tags: topTileAllTags } },
    }]);
  }

  collisionMsgs.push(`The ${mat} object splits at elevation ${splitElev}.`);

  undoOps.push(async () => {
    const topWalls = getByTag(topTag).filter(o => Array.isArray(o.c));
    for (const w of topWalls) await safeDelete(w);
    if (createdTiles.length) await safeDelete(createdTiles[0]);
    const botWalls = getByTag(botTag).filter(o => Array.isArray(o.c));
    for (const w of botWalls) {
      await safeUpdate(w, { 'flags.wall-height.top': tileTop, ...restrict });
      if (game.user.isGM) {
        await removeTags(w, [botTag, 'damaged:0']);
        await addTags(w, [blockTag]);
      }
    }
    if (game.user.isGM) {
      await removeTags(tile, [botTag]);
      await addTags(tile, [blockTag]);
    }
  });
};

const applyFallDamage = async (targetToken, finalElev, landingGrid, agility, canFly, undoOps, collisionMsgs, fallReduction = 0, noFallDamage = false) => {
  if (!isNaN(finalElev) && !canFly && finalElev > 0) {
    const GRID = getGRID();
    const tilesBelow = canvas.tiles.placeables
      .filter(t => {
        const tg = toGrid(t.document);
        if (tg.x !== landingGrid.x || tg.y !== landingGrid.y) return false;
        if (!hasTags(t, 'obstacle') || hasTags(t, 'broken')) return false;
        const top = getWallBlockTop(t) ?? 0;
        return (top - 1) < finalElev;
      })
      .sort((a, b) => (getWallBlockTop(b) ?? 0) - (getWallBlockTop(a) ?? 0));

    const topTile        = tilesBelow[0] ?? null;
    const origTopValue   = topTile ? (getWallBlockTop(topTile) ?? 1) : 1;
    const landingSurface = topTile ? (origTopValue - 1) : 0;
    const rawFall        = finalElev - landingSurface;
    const effectiveFall  = Math.max(0, rawFall - Math.max(0, agility) - fallReduction);

    if (noFallDamage) {
      await safeUpdate(targetToken.document, { elevation: landingSurface });
      collisionMsgs.push(`${targetToken.name} falls ${rawFall} square${rawFall !== 1 ? 's' : ''} but takes no damage.`);
      return;
    }

    if (effectiveFall >= 2) {
      const fallDmg = Math.min(effectiveFall * 2, 50);
      await applyDamage(targetToken.actor, fallDmg);

      const reductionNote = fallReduction > 0
        ? ` (${rawFall} raw, reduced by Agility ${agility} + ${fallReduction})`
        : ` (${effectiveFall} effective after Agility ${agility})`;
      collisionMsgs.push(`${targetToken.name} falls ${rawFall} square${rawFall !== 1 ? 's' : ''}${reductionNote} and takes <strong>${fallDmg} damage</strong>, landing prone.`);

      let actualLanding = landingSurface;
      if (topTile) {
        const newTop = await breakTileFromTop(topTile, fallDmg, undoOps, collisionMsgs, targetToken);
        if (newTop !== null) actualLanding = newTop;
      }

      await safeUpdate(targetToken.document, { elevation: actualLanding });
      await safeToggleStatusEffect(targetToken.actor, 'prone', { active: true });
      undoOps.push(async () => safeToggleStatusEffect(targetToken.actor, 'prone', { active: false }));

      const landedOn = tokenAt(landingGrid.x, landingGrid.y, targetToken.id);
      if (landedOn) {
        await applyDamage(landedOn.actor, fallDmg);
        collisionMsgs.push(`${landedOn.name} takes <strong>${fallDmg} damage</strong> from the impact.`);
        const fallerSize   = targetToken.actor?.system?.combat?.size?.value ?? 1;
        const blockerMight = landedOn.actor?.system?.characteristics?.might?.value ?? 0;
        if (fallerSize > blockerMight) {
          await safeToggleStatusEffect(landedOn.actor, 'prone', { active: true });
          undoOps.push(async () => safeToggleStatusEffect(landedOn.actor, 'prone', { active: false }));
          collisionMsgs.push(`${landedOn.name} is knocked prone (${targetToken.name}'s size ${fallerSize} exceeds their Might ${blockerMight}).`);
        }
        const chosen = await chooseFreeSquare(targetToken);
        if (chosen) {
          await safeUpdate(targetToken.document, { x: chosen.x * GRID, y: chosen.y * GRID });
          collisionMsgs.push(`${targetToken.name} lands in a nearby free space.`);
        } else {
          collisionMsgs.push(`${targetToken.name} could not find a free space to land.`);
        }
      }
    } else if (rawFall > 0) {
      await safeUpdate(targetToken.document, { elevation: landingSurface });
      const reductionNote = fallReduction > 0
        ? ` (${rawFall} raw, reduced by Agility ${agility} + ${fallReduction})`
        : ` (${effectiveFall} effective after Agility ${agility})`;
      collisionMsgs.push(`${targetToken.name} falls ${rawFall} square${rawFall !== 1 ? 's' : ''}${reductionNote}. Less than 2 squares, no damage.`);
    }
  } else if (!isNaN(finalElev) && canFly && finalElev > 0) {
    collisionMsgs.push(`${targetToken.name} is launched into the air (elevation ${finalElev}). No fall damage since they can fly.`);
  }
};

const _runForcedMovement = async (type, distance, targetToken, sourceToken, bonusCreatureDmg = 0, bonusObjectDmg = 0, verticalHeight = 0, fallReduction = 0, noFallDamage = false, ignoreStability = false, noCollisionDamage = false, keywords = []) => {
  const GRID      = getGRID();
  const stability = ignoreStability ? 0 : (targetToken.actor?.system?.combat?.stability ?? 0);

  let effectiveDistance = distance;
  if (keywords.includes('melee') && sourceToken) {
    const attackerRank = sizeRank(sourceToken.actor?.system?.combat?.size ?? { value: 1, letter: 'M' });
    const targetRank   = sizeRank(targetToken.actor?.system?.combat?.size ?? { value: 1, letter: 'M' });
    if (attackerRank > targetRank) {
      effectiveDistance += 1;
      ui.notifications.info(`+1 ${type} ${sourceToken.name} is larger than ${targetToken.name}.`);
    }
  }

  const reduced     = Math.max(0, effectiveDistance - stability);
  const vertSign    = verticalHeight >= 0 ? 1 : -1;
  const reducedVert = Math.max(0, Math.abs(verticalHeight) - stability) * vertSign;
  const isVertical  = reducedVert !== 0;

  if (reduced === 0 && reducedVert === 0) {
    ui.notifications.info(`${targetToken.name}'s stability fully resists the forced movement.`);
    return;
  }

  if (stability > 0) {
    const parts = [];
    if (distance > 0)                 parts.push(`push ${distance} to ${reduced}`);
    if (Math.abs(verticalHeight) > 0) parts.push(`vertical ${Math.abs(verticalHeight)} to ${Math.abs(reducedVert)}`);
    ui.notifications.info(`${targetToken.name}'s stability reduces forced movement by ${stability} (${parts.join(', ')}).`);
  }

  const startElev  = targetToken.document.elevation ?? 0;
  const agility    = targetToken.actor?.system?.characteristics?.agility?.value ?? 0;
  const canFly     = hasFly(targetToken.actor);
  const sourceGrid = sourceToken ? toGrid(sourceToken.document) : null;
  const startGrid  = toGrid(targetToken.document);

  const buildSummary = () => {
    const parts = [`${type} ${reduced}`];
    if (isVertical)         parts.push(`vertical ${reducedVert}`);
    if (bonusCreatureDmg)   parts.push(`+${bonusCreatureDmg} creature collision`);
    if (bonusObjectDmg)     parts.push(`+${bonusObjectDmg} object collision`);
    if (fallReduction)      parts.push(`+${fallReduction} fall reduction`);
    if (noFallDamage)       parts.push('no fall damage');
    if (noCollisionDamage)  parts.push('no collision damage');
    if (ignoreStability)    parts.push('ignores stability');
    let summary = `<strong>${targetToken.name}</strong> forced: ${parts.join(', ')}.`;
    if (stability > 0 && !ignoreStability) {
      const stabParts = [];
      if (distance !== reduced)                                parts.push(`push ${distance} to ${reduced}`);
      if (Math.abs(verticalHeight) !== Math.abs(reducedVert)) parts.push(`vertical ${Math.abs(verticalHeight)} to ${Math.abs(reducedVert)}`);
      if (stabParts.length) summary += ` Stability reduced ${stabParts.join(', ')}.`;
    }
    return summary;
  };

  await new Promise((resolve) => {
    if (reduced === 0) { resolve([]); return; }

    const path     = [];
    const graphics = new PIXI.Graphics();
    canvas.app.stage.addChild(graphics);

    const colorPath    = 0x4488ff;
    const colorStart   = 0xffaa00;
    const colorValid   = 0x44cc44;
    const colorInvalid = 0xcc4444;

    const isValidStep = (from, to) => {
      if (gridDist(from, to) !== 1) return false;
      if (gridEq(to, startGrid)) return false;
      for (const p of path) if (gridEq(to, p)) return false;
      if (type === 'Push' && sourceGrid) {
        if (gridDist(to, sourceGrid) <= gridDist(from, sourceGrid)) return false;
      }
      if (type === 'Pull' && sourceGrid) {
        if (gridDist(to, sourceGrid) >= gridDist(from, sourceGrid)) return false;
      }
      return true;
    };

    const redraw = (hoverGrid) => {
      graphics.clear();
      graphics.beginFill(colorStart, 0.35);
      const sw = toWorld(startGrid);
      graphics.drawRect(sw.x, sw.y, GRID, GRID);
      graphics.endFill();
      for (const p of path) {
        graphics.beginFill(colorPath, 0.35);
        const pw = toWorld(p);
        graphics.drawRect(pw.x, pw.y, GRID, GRID);
        graphics.endFill();
      }
      if (hoverGrid && path.length < reduced) {
        const prev  = path.length ? path[path.length - 1] : startGrid;
        const valid = isValidStep(prev, hoverGrid);
        graphics.beginFill(valid ? colorValid : colorInvalid, 0.4);
        const hw = toWorld(hoverGrid);
        graphics.drawRect(hw.x, hw.y, GRID, GRID);
        graphics.endFill();
      }
    };

    const overlay = new PIXI.Container();
    overlay.interactive = true;
    overlay.hitArea     = new PIXI.Rectangle(0, 0, canvas.dimensions.width, canvas.dimensions.height);
    canvas.app.stage.addChild(overlay);
    let hoverGrid = null;

    const onMove = (e) => {
      hoverGrid = toGrid(e.data.getLocalPosition(canvas.app.stage));
      redraw(hoverGrid);
    };

    const onClick = (e) => {
      const gpos = toGrid(e.data.getLocalPosition(canvas.app.stage));
      const prev = path.length ? path[path.length - 1] : startGrid;
      if (!isValidStep(prev, gpos)) { ui.notifications.warn('Invalid step for ' + type + '.'); return; }
      path.push(gpos);
      if (path.length === reduced) { cleanup(); resolve(path); return; }
      redraw(hoverGrid);
    };

    const onRightClick = () => { if (path.length > 0) { path.pop(); redraw(hoverGrid); } };

    const onKeyDown = (e) => {
      if (e.key === 'Escape') { cleanup(); resolve(null); }
      if (e.key === 'Enter')  { cleanup(); resolve(path); }
    };

    const cleanup = () => {
      overlay.off('pointermove', onMove);
      overlay.off('pointerdown', onClick);
      overlay.off('rightdown',   onRightClick);
      document.removeEventListener('keydown', onKeyDown);
      canvas.app.stage.removeChild(overlay);
      canvas.app.stage.removeChild(graphics);
      graphics.destroy();
      overlay.destroy();
    };

    overlay.on('pointermove', onMove);
    overlay.on('pointerdown', onClick);
    overlay.on('rightdown',   onRightClick);
    document.addEventListener('keydown', onKeyDown);
    redraw(null);
    const vertNote = isVertical ? ` vertical ${reducedVert}` : '';
    ui.notifications.info(`${type} ${reduced}${vertNote}: click squares to trace path. Right-click to undo. Enter to confirm. Escape to cancel.`);

  }).then(async (path) => {
    if (!path || (path.length === 0 && !isVertical)) {
      ui.notifications.info('Forced movement cancelled.');
      return;
    }

    if (path.length === 0 && isVertical) {
      const GRID          = getGRID();
      const startPos      = { x: targetToken.document.x, y: targetToken.document.y };
      const undoOps       = [];
      const collisionMsgs = [];
      const movedSnap     = snapStamina(targetToken.actor);
      let finalElev       = startElev;
      let blocked         = false;

      const steps = reduced > 0 ? reduced : Math.abs(reducedVert);
      const dir   = reducedVert >= 0 ? 1 : -1;

      for (let i = 0; i < steps; i++) {
        const stepElev  = startElev + dir * (reduced > 0 ? Math.round(Math.abs(reducedVert) * (i + 1) / steps) : (i + 1));
        const remaining = (reduced > 0 ? reduced : Math.abs(reducedVert)) - i;
        const vTile     = getWallBlockTileAt(startGrid.x, startGrid.y);

        if (vTile && !hasTags(vTile, 'broken')) {
          const blockTag   = getTags(vTile).find(t => t.startsWith('wall-block-'));
          const walls      = blockTag ? getByTag(blockTag).filter(o => Array.isArray(o.c)) : [];
          const tileBottom = walls[0]?.flags?.['wall-height']?.bottom ?? 0;
          const tileTop    = walls[0]?.flags?.['wall-height']?.top    ?? Infinity;
          if (stepElev >= tileBottom && stepElev < tileTop) {
            const dmg = 2 + remaining + bonusObjectDmg;
            if (!noCollisionDamage) await applyDamage(targetToken.actor, dmg);
            collisionMsgs.push(`${targetToken.name} is blocked by a wall and takes <strong>${dmg} damage</strong>.`);
            blocked = true;
            break;
          }
        }

        const blocker = tokenAt(startGrid.x, startGrid.y, targetToken.id);
        if (blocker && (blocker.document.elevation ?? 0) === stepElev) {
          if (!noCollisionDamage) await applyDamage(targetToken.actor, remaining + bonusCreatureDmg);
          if (!noCollisionDamage) await applyDamage(blocker.actor, remaining + bonusCreatureDmg);
          collisionMsgs.push(`<strong>Collision!</strong> ${targetToken.name} hits ${blocker.name}. Both take <strong>${remaining + bonusCreatureDmg} damage</strong>.`);
          blocked = true;
          break;
        }

        finalElev = stepElev;
      }

      await safeUpdate(targetToken.document, { elevation: finalElev });
      if (!blocked) {
        await applyFallDamage(targetToken, finalElev, startGrid, agility, canFly, undoOps, collisionMsgs, fallReduction, noFallDamage);
      }

      window._forcedMovementUndo = async () => {
        await safeUpdate(targetToken.document, { x: startPos.x, y: startPos.y, elevation: startElev });
        await undoDamage(targetToken.actor, movedSnap);
        for (const op of undoOps) await op();
        ui.notifications.info('Forced movement undone.');
      };

      await ChatMessage.create({
        content: buildSummary() + '<br>' + (collisionMsgs.length ? collisionMsgs.join('<br>') + '<br>' : '') + '@Macro[Forced Movement Undo]{Undo}',
      });
      return;
    }

    const GRID          = getGRID();
    const startPos      = { x: targetToken.document.x, y: targetToken.document.y };
    const startElevSnap = startElev;
    const undoOps       = [];
    const collisionMsgs = [];
    let landingIndex    = path.length - 1;
    const movedSnap     = snapStamina(targetToken.actor);
    let blockerSnap     = null;

    for (let i = 0; i < path.length; i++) {
      const step      = path[i];
      const prev      = i > 0 ? path[i - 1] : startGrid;
      const remaining = reduced - i;
      const stepElev  = isVertical && reduced > 0
        ? startElev + Math.round(reducedVert * (i + 1) / reduced)
        : startElev;

      if (isVertical) {
        const vTile = getWallBlockTileAt(step.x, step.y);
        if (vTile && !hasTags(vTile, 'broken')) {
          const blockTag   = getTags(vTile).find(t => t.startsWith('wall-block-'));
          const walls      = blockTag ? getByTag(blockTag).filter(o => Array.isArray(o.c)) : [];
          const tileBottom = walls[0]?.flags?.['wall-height']?.bottom ?? 0;
          const tileTop    = walls[0]?.flags?.['wall-height']?.top    ?? Infinity;
          if (stepElev >= tileBottom && stepElev < tileTop) {
            landingIndex = i - 1;
            const dmg = 2 + remaining + bonusObjectDmg;
            if (!noCollisionDamage) await applyDamage(targetToken.actor, dmg);
            collisionMsgs.push(`${targetToken.name} is blocked by a wall at elevation ${stepElev} and takes <strong>${dmg} damage</strong>.`);
            break;
          }
        }
      }

      const wall = wallBetween(prev, step);
      if (wall && hasTags(wall, 'obstacle')) {
        const wallBottom = wall.flags?.['wall-height']?.bottom ?? 0;
        const wallTop    = wall.flags?.['wall-height']?.top    ?? Infinity;
        if (!(stepElev >= wallTop || stepElev < wallBottom)) {
          const isBreakable = hasTags(wall, 'breakable');
          const blockTag    = getTags(wall).find(t => t.startsWith('wall-block-'));

          if (!isBreakable) {
            landingIndex = i - 1;
            const dmg = 2 + remaining + bonusObjectDmg;
            if (!noCollisionDamage) await applyDamage(targetToken.actor, dmg);
            collisionMsgs.push(`${targetToken.name} hits a wall and takes <strong>${dmg} damage</strong>.`);
            break;
          }

          const mat  = getMaterial(wall);
          const rule = MATERIAL_RULES[mat];
          const dmg  = remaining < rule.cost ? 2 + remaining + bonusObjectDmg : rule.damage + bonusObjectDmg;
          if (!noCollisionDamage) await applyDamage(targetToken.actor, dmg);

          if (remaining >= rule.cost) {
            if (blockTag) {
              const allWalls    = getByTag(blockTag).filter(o => Array.isArray(o.c));
              const tile        = canvas.tiles.placeables.find(t => hasTags(t, blockTag));
              const isMidHeight = stepElev > wallBottom;
              const isStable    = tile && hasTags(tile, 'stable');

              if (isMidHeight && isStable) {
                await splitTileAtElevation(tile, stepElev, undoOps, collisionMsgs);
              } else if (isMidHeight && !isStable) {
                const prevTop    = wallTop;
                for (const w of allWalls) await safeUpdate(w, { 'flags.wall-height.top': wallTop - 1 });
                const prevDmgTag = tile ? getTags(tile).find(t => t.startsWith('damaged:')) : null;
                const prevDmgN   = prevDmgTag ? parseInt(prevDmgTag.split(':')[1]) : 0;
                if (tile && game.user.isGM) {
                  if (prevDmgTag) await removeTags(tile, [prevDmgTag]);
                  await addTags(tile, [`damaged:${prevDmgN + 1}`]);
                }
                undoOps.push(async () => {
                  for (const w of allWalls) await safeUpdate(w, { 'flags.wall-height.top': prevTop });
                  if (tile && game.user.isGM) {
                    await removeTags(tile, [`damaged:${prevDmgN + 1}`]);
                    if (prevDmgTag) await addTags(tile, [prevDmgTag]);
                  }
                });
                collisionMsgs.push(`The top of the ${mat} object collapses into the gap (now ${wallTop - 1 - wallBottom} square${wallTop - 1 - wallBottom !== 1 ? 's' : ''} tall).`);
              } else {
                const prevWallData = allWalls.map(w => ({
                  wall: w, restrict: { move: w.move, sight: w.sight, light: w.light, sound: w.sound },
                }));
                for (const w of allWalls) {
                  await safeUpdate(w, { move: 0, sight: 0, light: 0, sound: 0 });
                  if (game.user.isGM) await addTags(w, ['broken']);
                }
                if (tile) {
                  await safeUpdate(tile.document, { 'texture.src': MATERIAL_ICONS.broken, alpha: 0.8 });
                  if (game.user.isGM) await addTags(tile, ['broken']);
                }
                undoOps.push(async () => {
                  if (tile) {
                    const origMat = getTags(tile).find(t => Object.keys(MATERIAL_ICONS).includes(t)) ?? 'stone';
                    await safeUpdate(tile.document, { 'texture.src': MATERIAL_ICONS[origMat], alpha: MATERIAL_ALPHA[origMat] });
                    if (game.user.isGM) await removeTags(tile, ['broken']);
                  }
                  for (const { wall: w, restrict } of prevWallData) {
                    await safeUpdate(w, restrict);
                    if (game.user.isGM) await removeTags(w, ['broken']);
                  }
                });
              }
            } else {
              await safeDelete(wall);
            }
            collisionMsgs.push(`${targetToken.name} smashes through ${mat} (costs ${rule.cost}, deals ${rule.damage} damage).`);
            i += rule.cost - 1;
            continue;
          }

          landingIndex = i - 1;
          collisionMsgs.push(`${targetToken.name} hits ${mat} but lacks the momentum to break through (needs ${rule.cost}, has ${remaining}). Takes <strong>${dmg} damage</strong>.`);
          break;
        }
      }

      const blocker = tokenAt(step.x, step.y, targetToken.id);
      if (blocker) {
        landingIndex = i - 1;
        const movedSquadGroup   = getSquadGroup(targetToken.actor);
        const blockerSquadGroup = getSquadGroup(blocker.actor);
        const sharedGroup       = movedSquadGroup && blockerSquadGroup &&
          movedSquadGroup.id === blockerSquadGroup.id ? movedSquadGroup : null;
        const prevSharedHP      = sharedGroup?.system?.staminaValue ?? null;

        if (!noCollisionDamage) await applyDamage(targetToken.actor, remaining + bonusCreatureDmg);
        const blockerPrev = noCollisionDamage ? null : await applyDamage(blocker.actor, remaining + bonusCreatureDmg, sharedGroup ? null : blockerSquadGroup);

        if (blockerPrev && sharedGroup && prevSharedHP !== null) {
          blockerPrev.squadGroup  = sharedGroup;
          blockerPrev.prevSquadHP = prevSharedHP;
        }
        blockerSnap = blockerPrev;
        if (blockerPrev) undoOps.push(() => undoDamage(blocker.actor, blockerSnap));

        const dmgTotal  = remaining + bonusCreatureDmg;
        const bonusNote = bonusCreatureDmg ? ` (${remaining} + ${bonusCreatureDmg} bonus)` : '';
        collisionMsgs.push(`<strong>Collision!</strong> ${targetToken.name} crashes into ${blocker.name} with ${remaining} square${remaining !== 1 ? 's' : ''} remaining. Both take <strong>${dmgTotal} damage</strong>${bonusNote}.`);
        break;
      }

      const tile = tileAt(step.x, step.y);
      if (tile && hasTags(tile, 'obstacle') && !hasTags(tile, 'broken')) {
        const blockTag   = getTags(tile).find(t => t.startsWith('wall-block-'));
        const tileWalls  = blockTag ? getByTag(blockTag).filter(o => Array.isArray(o.c)) : [];
        const tileBottom = tileWalls[0]?.flags?.['wall-height']?.bottom ?? 0;
        const tileTop    = tileWalls[0]?.flags?.['wall-height']?.top    ?? Infinity;

        if (!(isVertical && (stepElev >= tileTop || stepElev < tileBottom))) {
          const isBreakable = hasTags(tile, 'breakable');

          if (!isBreakable) {
            landingIndex = i - 1;
            const dmg = 2 + remaining + bonusObjectDmg;
            if (!noCollisionDamage) await applyDamage(targetToken.actor, dmg);
            collisionMsgs.push(`${targetToken.name} is stopped by an obstacle and takes <strong>${dmg} damage</strong>.`);
            break;
          }

          const mat  = getMaterial(tile);
          const rule = MATERIAL_RULES[mat];
          const dmg  = remaining < rule.cost ? 2 + remaining + bonusObjectDmg : rule.damage + bonusObjectDmg;
          if (!noCollisionDamage) await applyDamage(targetToken.actor, dmg);

          if (remaining >= rule.cost) {
            if (blockTag) {
              const walls        = getByTag(blockTag).filter(o => Array.isArray(o.c));
              const prevWallData = walls.map(w => ({
                wall: w, restrict: { move: w.move, sight: w.sight, light: w.light, sound: w.sound },
              }));
              for (const wall of walls) {
                await safeUpdate(wall, { move: 0, sight: 0, light: 0, sound: 0 });
                if (game.user.isGM) await addTags(wall, ['broken']);
              }
              await safeUpdate(tile.document, { 'texture.src': MATERIAL_ICONS.broken, alpha: 0.8 });
              if (game.user.isGM) await addTags(tile, ['broken']);

              undoOps.push(async () => {
                if (game.user.isGM) await removeTags(tile, ['broken']);
                for (const { wall, restrict } of prevWallData) {
                  await safeUpdate(wall, restrict);
                  if (game.user.isGM) await removeTags(wall, ['broken']);
                }
              });
            } else {
              await safeDelete(tile.document);
            }
            collisionMsgs.push(`${targetToken.name} smashes through ${mat} (costs ${rule.cost}, deals ${rule.damage} damage).`);
            i += rule.cost - 1;
            continue;
          }

          landingIndex = i - 1;
          collisionMsgs.push(`${targetToken.name} hits ${mat} but lacks the momentum to break through (needs ${rule.cost}, has ${remaining}). Takes <strong>${dmg} damage</strong>.`);
          break;
        }
      }
    }

    const landingGrid      = landingIndex >= 0 ? path[landingIndex] : startGrid;
    const landingWorld     = toWorld(landingGrid);
    const landingStepIndex = landingIndex >= 0 ? landingIndex : -1;
    const finalElev        = isVertical && reduced > 0
      ? startElev + Math.round(reducedVert * (landingStepIndex + 1) / reduced)
      : startElev;

    await safeUpdate(targetToken.document, { x: landingWorld.x, y: landingWorld.y, elevation: finalElev });
    await applyFallDamage(targetToken, finalElev, landingGrid, agility, canFly, undoOps, collisionMsgs, fallReduction, noFallDamage);

    window._forcedMovementUndo = async () => {
      await safeUpdate(targetToken.document, { x: startPos.x, y: startPos.y, elevation: startElevSnap });
      await undoDamage(targetToken.actor, movedSnap);
      for (const op of undoOps) await op();
      ui.notifications.info('Forced movement undone.');
    };

    await ChatMessage.create({
      content: buildSummary() + '<br>' + (collisionMsgs.length ? collisionMsgs.join('<br>') + '<br>' : '') + '@Macro[Forced Movement Undo]{Undo}',
    });
  });
};

const getTargetAndSource = () => {
  const targets    = [...game.user.targets];
  const controlled = canvas.tokens.controlled;
  const target     = targets.length === 1 ? targets[0] : (controlled.length === 1 ? controlled[0] : null);
  const source     = targets.length === 1 && controlled.length === 1 ? controlled[0] : null;
  return { target, source };
};

export const pickTarget = (remaining) => new Promise((resolve) => {
  if (remaining.length === 1) { resolve(remaining[0]); return; }

  const graphics = new PIXI.Graphics();
  canvas.app.stage.addChild(graphics);

  const redraw = (hoverToken) => {
    graphics.clear();
    for (const t of remaining) {
      const isHover = hoverToken && t.id === hoverToken.id;
      graphics.beginFill(0xffaa00, isHover ? 0.6 : 0.35);
      graphics.drawRect(t.document.x, t.document.y, canvas.grid.size, canvas.grid.size);
      graphics.endFill();
    }
  };

  const overlay = new PIXI.Container();
  overlay.interactive = true;
  overlay.hitArea = new PIXI.Rectangle(0, 0, canvas.dimensions.width, canvas.dimensions.height);
  canvas.app.stage.addChild(overlay);
  let hoverToken = null;

  const onMove = (e) => {
    const pos = e.data.getLocalPosition(canvas.app.stage);
    hoverToken = remaining.find(t => {
      const d = t.document;
      return pos.x >= d.x && pos.x < d.x + canvas.grid.size && pos.y >= d.y && pos.y < d.y + canvas.grid.size;
    }) ?? null;
    redraw(hoverToken);
  };

  const onClick = (e) => {
    const pos     = e.data.getLocalPosition(canvas.app.stage);
    const clicked = remaining.find(t => {
      const d = t.document;
      return pos.x >= d.x && pos.x < d.x + canvas.grid.size && pos.y >= d.y && pos.y < d.y + canvas.grid.size;
    });
    if (!clicked) return;
    cleanup();
    resolve(clicked);
  };

  const onKeyDown = (e) => { if (e.key === 'Escape') { cleanup(); resolve(null); } };

  const cleanup = () => {
    overlay.off('pointermove', onMove);
    overlay.off('pointerdown', onClick);
    document.removeEventListener('keydown', onKeyDown);
    canvas.app.stage.removeChild(overlay);
    canvas.app.stage.removeChild(graphics);
    graphics.destroy();
    overlay.destroy();
  };

  overlay.on('pointermove', onMove);
  overlay.on('pointerdown', onClick);
  document.addEventListener('keydown', onKeyDown);
  redraw(null);
  ui.notifications.info('Click a highlighted target to resolve their forced movement. Escape to cancel.');
});

export async function runForcedMovement(macroArgs = []) {
  if (macroArgs.length >= 2) {
    const type              = parseType(macroArgs[0]);
    const distance          = parseInt(macroArgs[1]);
    const bonusCreatureDmg  = parseInt(macroArgs[2]) || 0;
    const bonusObjectDmg    = parseInt(macroArgs[3]) || 0;
    const verticalRaw       = macroArgs[4];
    const fallReduction     = parseInt(macroArgs[5]) || 0;
    const noFallDamage      = macroArgs[6] === 'true' || macroArgs[6] === true;
    const ignoreStability   = macroArgs[7] === 'true' || macroArgs[7] === true;
    const noCollisionDamage = macroArgs[8] === 'true' || macroArgs[8] === true;
    const keywords          = macroArgs[9] ? String(macroArgs[9]).split(',').map(k => k.trim().toLowerCase()).filter(Boolean) : [];

    let verticalHeight = 0;
    if (verticalRaw !== undefined && verticalRaw !== '') {
      const sign = type === 'Pull' ? -1 : 1;
      verticalHeight = Math.abs(parseInt(verticalRaw) || 0) * sign;
    }
    if (!type)           { ui.notifications.warn('Invalid type. Use Push, Pull, or Slide.'); return; }
    if (isNaN(distance)) { ui.notifications.warn('Invalid distance.'); return; }
    const { target, source } = getTargetAndSource();
    if (!target) { ui.notifications.warn('Target or select the creature to move.'); return; }
    await _runForcedMovement(type, distance, target, source, bonusCreatureDmg, bonusObjectDmg, verticalHeight, fallReduction, noFallDamage, ignoreStability, noCollisionDamage, keywords);
  } else {
    const { createFormGroup, createSelectInput, createNumberInput, createCheckboxInput } = foundry.applications.fields;
    const content = document.createElement('div');
    content.appendChild(createFormGroup({ label: 'Type', input: createSelectInput({ name: 'type', options: [{ value: 'Push', label: 'Push' }, { value: 'Pull', label: 'Pull' }, { value: 'Slide', label: 'Slide' }] }), classes: ['slim'] }));
    content.appendChild(createFormGroup({ label: 'Distance', input: createNumberInput({ name: 'distance', min: 0, value: 1, step: 1 }), classes: ['slim'] }));
    content.appendChild(createFormGroup({ label: 'Vertical', input: createCheckboxInput({ name: 'vertical', value: false }), classes: ['slim'] }));
    content.appendChild(createFormGroup({ label: 'Vertical Distance', hint: 'Leave blank to default to distance. Push forces positive, Pull forces negative.', input: createNumberInput({ name: 'verticalHeight', value: '', step: 1 }), classes: ['slim'] }));
    content.appendChild(createFormGroup({ label: 'Fall Reduction Bonus', hint: 'Stacks with Agility.', input: createNumberInput({ name: 'fallReduction', min: 0, value: 0, step: 1 }), classes: ['slim'] }));
    content.appendChild(createFormGroup({ label: 'Negate Fall Damage', input: createCheckboxInput({ name: 'noFallDamage', value: false }), classes: ['slim'] }));
    content.appendChild(createFormGroup({ label: 'Ignore Stability', input: createCheckboxInput({ name: 'ignoreStability', value: false }), classes: ['slim'] }));
    content.appendChild(createFormGroup({ label: 'No Collision Damage', input: createCheckboxInput({ name: 'noCollisionDamage', value: false }), classes: ['slim'] }));

    const fd = await ds.applications.api.DSDialog.input({ content, window: { title: 'Forced Movement' } });
    if (!fd) return;

    const type     = parseType(fd.type);
    const distance = parseInt(fd.distance);
    if (!type || isNaN(distance) || distance < 0) { ui.notifications.warn('Invalid input.'); return; }

    let verticalHeight = 0;
    if (fd.vertical) {
      const sign    = type === 'Pull' ? -1 : 1;
      const rawVert = fd.verticalHeight === '' || fd.verticalHeight === null ? null : parseInt(fd.verticalHeight);
      verticalHeight = (rawVert === null || isNaN(rawVert) ? distance : Math.abs(rawVert)) * sign;
    }

    const fallReduction     = parseInt(fd.fallReduction) || 0;
    const noFallDamage      = !!fd.noFallDamage;
    const ignoreStability   = !!fd.ignoreStability;
    const noCollisionDamage = !!fd.noCollisionDamage;

    const allTargets = [...game.user.targets];
    const controlled = canvas.tokens.controlled;
    const source     = allTargets.length >= 1 && controlled.length === 1 ? controlled[0] : null;

    if (allTargets.length === 0) {
      const { target } = getTargetAndSource();
      if (!target) { ui.notifications.warn('Target or select the creature to move.'); return; }
      await _runForcedMovement(type, distance, target, source, 0, 0, verticalHeight, fallReduction, noFallDamage, ignoreStability, noCollisionDamage);
    } else {
      const remaining = [...allTargets];
      while (remaining.length > 0) {
        const chosen = await pickTarget(remaining);
        if (!chosen) break;
        remaining.splice(remaining.findIndex(t => t.id === chosen.id), 1);
        await _runForcedMovement(type, distance, chosen, source, 0, 0, verticalHeight, fallReduction, noFallDamage, ignoreStability, noCollisionDamage);
      }
    }
  }
}
