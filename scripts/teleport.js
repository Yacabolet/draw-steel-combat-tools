import {
  hasTags, GRID as getGRID, toGrid, toWorld, gridDist,
  tokenAt, tileAt, safeUpdate, replayUndo
} from './helpers.js';

// --- SHARED UI STYLING UTILS ---
const SCALE = 1.2;
const s = n => Math.round(n * SCALE);
const palette = () => document.body.classList.contains('theme-dark') ? {
  bg: '#0e0c14', bgInner: '#0a0810', bgBtn: '#1a1628',
  border: '#2a2040', borderOuter: '#4a3870',
  text: '#8a88a0', textDim: '#3a3050', textLabel: '#4a3870',
  accent: '#7a50c0', accentRed: '#802020', accentGreen: '#206040',
} : {
  bg: '#f0eef8', bgInner: '#e4e0f0', bgBtn: '#dbd8ec',
  border: '#b0a8cc', borderOuter: '#7060a8',
  text: '#3a3060', textDim: '#8880aa', textLabel: '#5040a0',
  accent: '#7a50c0', accentRed: '#a03030', accentGreen: '#206040',
};

// --- TELEPORT LOGIC ---
const chooseTeleportSquare = (sourceToken, maxDist) => new Promise((resolve) => {
  const GRID = getGRID();
  
  // Get the teleporting token's dynamic footprint
  const w = sourceToken.document.width ?? 1;
  const h = sourceToken.document.height ?? 1;
  const tg = toGrid(sourceToken.document);

  const isAreaFree = (startX, startY) => {
     // 1. Check against ALL other tokens using Bounding Box (AABB) collision
     for (const t of canvas.tokens.placeables) {
         if (t.id === sourceToken.id) continue;
         if (t.actor?.statuses?.has('dead')) continue; // Draw Steel allows standing on dead bodies!

         const tGrid = toGrid(t.document);
         const tw = t.document.width ?? 1;
         const th = t.document.height ?? 1;
         
         // If the footprints overlap at all, the area is NOT free
         if (startX < tGrid.x + tw && startX + w > tGrid.x && 
             startY < tGrid.y + th && startY + h > tGrid.y) {
             return false;
         }
     }

     // 2. Check obstacle tiles strictly beneath our proposed footprint
     for (let ix = 0; ix < w; ix++) {
         for (let iy = 0; iy < h; iy++) {
             const cx = startX + ix;
             const cy = startY + iy;
             const tile = tileAt(cx, cy);
             if (tile && hasTags(tile, 'obstacle') && !hasTags(tile, 'broken')) return false;
         }
     }
     return true;
  };

  const candidates = [];
  
  // Calculate bounds to ensure large tokens can reach their max distance in all directions
  for (let dx = -maxDist - w + 1; dx <= maxDist + w - 1; dx++) {
    for (let dy = -maxDist - h + 1; dy <= maxDist + h - 1; dy++) {
      const x = tg.x + dx;
      const y = tg.y + dy;
      
      // True Chebyshev distance between the edges of the two footprints
      const dX = Math.max(0, tg.x - (x + w - 1), x - (tg.x + w - 1));
      const dY = Math.max(0, tg.y - (y + h - 1), y - (tg.y + h - 1));
      const dist = Math.max(dX, dY);

      if (dist > 0 && dist <= maxDist) {
        if (isAreaFree(x, y)) {
           candidates.push({ x, y });
        }
      }
    }
  }

  if (candidates.length === 0) {
      ui.notifications.warn("DSCT | No valid teleport destinations within range.");
      resolve(null);
      return;
  }

  const graphics = new PIXI.Graphics();
  canvas.app.stage.addChild(graphics);

  const redraw = (hoverGrid) => {
    graphics.clear();
    for (const g of candidates) {
      const isHover = hoverGrid && g.x === hoverGrid.x && g.y === hoverGrid.y;
      graphics.beginFill(0xaa33ff, isHover ? 0.6 : 0.2); 
      graphics.drawRect(g.x * GRID, g.y * GRID, GRID * w, GRID * h); // Render full footprint!
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
    // Find a candidate footprint that the mouse is currently inside
    hoverGrid  = candidates.find(g => 
         gpos.x >= g.x && gpos.x < g.x + w && 
         gpos.y >= g.y && gpos.y < g.y + h
    ) ?? null;
    redraw(hoverGrid);
  };

  const onClick = (e) => {
    const pos  = e.data.getLocalPosition(canvas.app.stage);
    const gpos = toGrid(pos);
    const chosen = candidates.find(g => 
         gpos.x >= g.x && gpos.x < g.x + w && 
         gpos.y >= g.y && gpos.y < g.y + h
    );
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
  ui.notifications.info(`Choose where ${sourceToken.name} teleports. Escape to cancel.`);
});

const executeTeleport = async (token, distance, animate, colorHex, animDuration = 600) => {
   const chosenGrid = await chooseTeleportSquare(token, distance);
   if (!chosenGrid) return; 

   const origWorld = { x: token.document.x, y: token.document.y, elevation: token.document.elevation ?? 0 };
   const origAlpha = token.document.alpha;
   const origTint  = token.document.texture.tint || null;
   const targetWorld = { ...toWorld(chosenGrid), elevation: token.document.elevation ?? 0 };
   const actualDist = gridDist(toGrid(origWorld), chosenGrid);

   if (animate) {
       await safeUpdate(token.document, { alpha: 0.2, 'texture.tint': colorHex }, { animation: { duration: animDuration } });
       await new Promise(r => setTimeout(r, animDuration));
   }

   await safeUpdate(token.document, { x: targetWorld.x, y: targetWorld.y }, { animate: false });

   if (animate) {
       await safeUpdate(token.document, { alpha: origAlpha, 'texture.tint': origTint }, { animation: { duration: animDuration } });
       await new Promise(r => setTimeout(r, animDuration));
   }

   const moveId = foundry.utils.randomID();
   await safeUpdate(token.document, { 'flags.draw-steel-combat-tools.lastTpMoveId': moveId });

   const undoLog = [{
       op: 'update', uuid: token.document.uuid,
       data: { x: origWorld.x, y: origWorld.y, elevation: origWorld.elevation, alpha: origAlpha, 'texture.tint': origTint },
       options: { animate: false }
   }];

   await ChatMessage.create({
       content: `<strong>${token.name}</strong> teleported ${actualDist} square${actualDist !== 1 ? 's' : ''}.`,
       flags: {
           'draw-steel-combat-tools': {
               isTpUndo: true, isUndone: false, undoLog, moveId, 
               targetTokenId: token.id, targetSceneId: canvas.scene.id, finalPos: targetWorld
           }
       }
   });
};

export async function runTeleport(macroArgs = []) {
  if (typeof macroArgs === 'object' && !Array.isArray(macroArgs) && Object.keys(macroArgs).length > 0) {
    const { distance, sourceId, animate = true, colorHex = "#a030ff", duration = 600 } = macroArgs;
    const source = canvas.tokens.get(sourceId) ?? (canvas.tokens.controlled.length === 1 ? canvas.tokens.controlled[0] : null);
    if (!source) { ui.notifications.warn('DSCT | Source token not found.'); return; }
    await executeTeleport(source, distance || 5, animate, colorHex, duration);
  } else {
    toggleTeleportPanel();
  }
}

// --- TELEPORT UI PANEL ---
export class TeleportPanel extends Application {
  constructor() {
    super();
    this._html = null;
    this._sourceToken = null;
    this._updatePreview();
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'dsct-tp-panel', title: 'Teleport', template: null,
      width: s(220), height: 'auto', resizable: false, minimizable: false,
    });
  }

  _updatePreview() {
    const controlled  = canvas.tokens.controlled;
    this._sourceToken = controlled.length === 1 ? controlled[0] : null;
  }

  _refreshPanel() {
    if (!this._html) return;
    this._updatePreview();
    const p = palette();

    const sourceImg  = this._html.find('#tp-source-img')[0];
    const sourceName = this._html.find('#tp-source-name')[0];
    if (sourceImg)  sourceImg.src = this._sourceToken?.document.texture.src ?? 'icons/svg/mystery-man.svg';
    if (sourceName) { sourceName.textContent = this._sourceToken?.name ?? 'Select exactly 1 token'; sourceName.style.color = this._sourceToken ? p.text : p.textDim; }
  }

  async _renderInner(data) {
    const styleId = 'tp-panel-style';
    const styleEl = document.getElementById(styleId) ?? document.head.appendChild(Object.assign(document.createElement('style'), { id: styleId }));
    const p = palette();
    styleEl.textContent = `
      #dsct-tp-panel .window-content { padding:0; background:${p.bg}; overflow-y:auto; }
      #dsct-tp-panel { border:1px solid ${p.borderOuter}; border-radius:3px; box-shadow:0 0 12px rgba(0,0,0,0.4); }
      #dsct-tp-panel .window-header { display:none !important; }
      #dsct-tp-panel .window-content { border-radius:3px; }
      #dsct-tp-panel button:hover { filter:brightness(1.15); }
      #dsct-tp-panel input[type="number"], #dsct-tp-panel input[type="text"] { background:${p.bgBtn}; color:${p.text}; border:1px solid ${p.border}; border-radius:2px; font-size:${s(9)}px; padding:${s(2)}px; }
      #dsct-tp-panel input[type="number"]:focus, #dsct-tp-panel input[type="text"]:focus { outline:none; border-color:${p.accent}; }
      #dsct-tp-panel input[type="checkbox"] { accent-color:${p.accent}; margin:0; }
    `;

    const sourceSrc   = this._sourceToken?.document.texture.src ?? 'icons/svg/mystery-man.svg';
    const sourceLabel = this._sourceToken?.name ?? 'Select exactly 1 token';
    
    // FETCH THE SAVED SETTINGS!
    const saved = game.user.getFlag('draw-steel-combat-tools', 'tpSettings') || { dist: 5, anim: true, color: '#a030ff', duration: 600 };

    return $(`
      <div style="padding:${s(8)}px;background:${p.bg};font-family:Georgia,serif;border-radius:${s(3)}px;cursor:move;" id="tp-drag-handle">
        <div style="display:flex;align-items:center;gap:${s(6)}px;margin-bottom:${s(8)}px;">
          <button data-action="close-window"
            style="width:${s(16)}px;height:${s(16)}px;flex-shrink:0;cursor:pointer;
            background:${p.bgBtn};border:1px solid ${p.border};color:${p.textDim};border-radius:2px;
            display:flex;align-items:center;justify-content:center;font-size:${s(9)}px;padding:0;"
            onmouseover="this.style.color='${p.text}'" onmouseout="this.style.color='${p.textDim}'">x</button>
          <div style="font-size:${s(9)}px;text-transform:uppercase;letter-spacing:0.8px;color:${p.textLabel};">Teleport</div>
        </div>

        <div style="padding:${s(6)}px;border:1px solid ${p.border};border-radius:${s(3)}px;background:${p.bgInner};margin-bottom:${s(6)}px;display:flex;flex-direction:column;align-items:center;">
          <img id="tp-source-img" src="${sourceSrc}" style="width:${s(44)}px;height:${s(44)}px;border-radius:${s(3)}px;object-fit:contain;border:1px solid ${p.border};background:${p.bg};">
          <div id="tp-source-name" style="font-size:${s(8)}px;color:${this._sourceToken ? p.text : p.textDim};text-align:center;width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:${s(2)}px;">${sourceLabel}</div>
        </div>

        <div style="font-size:${s(8)}px;text-transform:uppercase;letter-spacing:0.5px;color:${p.textLabel};margin-bottom:${s(4)}px;">Parameters</div>
        <div style="padding:${s(6)}px;border:1px solid ${p.border};border-radius:${s(3)}px;background:${p.bgInner};margin-bottom:${s(6)}px;display:flex;flex-direction:column;gap:${s(4)}px;">
          
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div style="color:${p.text};font-size:${s(9)}px;">Distance</div>
            <input type="number" id="tp-dist" value="${saved.dist}" min="1" step="1" style="width:${s(30)}px;text-align:center;" title="Squares">
          </div>

          <div style="width:100%;height:1px;background:${p.border};margin:${s(2)}px 0;"></div>

          <div style="display:flex;justify-content:space-between;align-items:center;">
            <label style="color:${p.textDim};font-size:${s(9)}px;display:flex;align-items:center;gap:${s(3)}px;cursor:pointer;">
              <input type="checkbox" id="tp-anim" ${saved.anim ? 'checked' : ''}> Animate Phase
            </label>
          </div>

          <div id="tp-anim-options" style="display:flex;flex-direction:column;gap:${s(4)}px;transition:opacity 0.2s ease; opacity: ${saved.anim ? '1' : '0.4'};">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <div style="color:${p.textDim};font-size:${s(9)}px;">Phase Color</div>
                <input type="text" id="tp-color" data-color-picker="format: 'hex'; alphaChannel: false;" value="${saved.color}" style="width:${s(80)}px;text-align:center;" ${saved.anim ? '' : 'disabled'}>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <div style="color:${p.textDim};font-size:${s(9)}px;">Duration (ms)</div>
                <input type="number" id="tp-duration" value="${saved.duration}" min="100" step="100" style="width:${s(40)}px;text-align:center;" ${saved.anim ? '' : 'disabled'}>
              </div>
          </div>
        </div>

        <button data-action="execute-tp" style="width:100%;padding:${s(6)}px;border-radius:${s(3)}px;cursor:pointer;font-size:${s(10)}px;font-weight:bold;background:${p.bgBtn};border:1px solid ${p.accent};color:${p.accent};">
          <i class="fas fa-magic" style="margin-right:${s(4)}px;"></i> Execute Teleport
        </button>

      </div>`);
  }

  activateListeners(html) {
    super.activateListeners(html);
    this._html = html;

    if (typeof ColorPicker !== 'undefined') {
        ColorPicker.install();
    }

    const appEl = html[0].closest('.app');
    if (appEl) {
      const saved = window._tpPanelPos;
      appEl.style.left = saved ? `${saved.left}px` : `${Math.round((window.innerWidth - (appEl.offsetWidth || s(220))) / 2)}px`;
      appEl.style.top  = saved ? `${saved.top}px`  : `${Math.round((window.innerHeight - (appEl.offsetHeight || s(300))) / 2)}px`;
      html[0].addEventListener('mousedown', e => {
        if (e.target.closest('button') || e.target.closest('input') || e.target.closest('select')) return;
        e.preventDefault();
        const sx = e.clientX - appEl.offsetLeft, sy = e.clientY - appEl.offsetTop;
        const onMove = ev => { appEl.style.left = `${ev.clientX - sx}px`; appEl.style.top = `${ev.clientY - sy}px`; };
        const onUp   = () => {
          window._tpPanelPos = { left: parseInt(appEl.style.left), top: parseInt(appEl.style.top) };
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    }

    if (this._hookControl) Hooks.off('controlToken', this._hookControl);
    this._hookControl = Hooks.on('controlToken', () => this._refreshPanel());
    this._themeObserver = new MutationObserver(() => this._refreshPanel());
    this._themeObserver.observe(document.body, { attributeFilter: ['class'] });

    const animCheck = html.find('#tp-anim');
    const animOpts = html.find('#tp-anim-options');
    
    const saveSettings = async () => {
        const dist = parseInt(html.find('#tp-dist').val()) || 5;
        const anim = html.find('#tp-anim').is(':checked');
        const color = html.find('#tp-color').val() || "#a030ff";
        const duration = parseInt(html.find('#tp-duration').val()) || 600;
        await game.user.setFlag('draw-steel-combat-tools', 'tpSettings', { dist, anim, color, duration });
    };

    // Gray out fields when disabled, and immediately save!
    animCheck.on('change', () => {
        const isChecked = animCheck.is(':checked');
        animOpts.css('opacity', isChecked ? '1' : '0.4');
        animOpts.find('input').prop('disabled', !isChecked);
        saveSettings();
    });

    html.find('input').on('change', saveSettings);

    html.on('click', '[data-action]', async e => {
      const action = e.currentTarget.dataset.action;
      
      if (action === 'close-window') { 
        this.close(); 
        return; 
      }
      
      if (action === 'execute-tp') {
        if (!this._sourceToken) { ui.notifications.warn("DSCT | You must select exactly 1 token to teleport."); return; }
        
        const dist     = parseInt(html.find('#tp-dist').val()) || 5;
        const animate  = html.find('#tp-anim').is(':checked');
        const color    = html.find('#tp-color').val() || "#a030ff";
        const duration = parseInt(html.find('#tp-duration').val()) || 600;

        await saveSettings(); // One last save check before execution!
        await executeTeleport(this._sourceToken, dist, animate, color, duration);
      }
    });
  }

  async close(options) {
    if (this._hookControl)   Hooks.off('controlToken', this._hookControl);
    if (this._themeObserver) this._themeObserver.disconnect();
    return super.close(options);
  }
}

export const toggleTeleportPanel = () => {
  const existing = Object.values(ui.windows).find(w => w.id === 'dsct-tp-panel');
  if (existing) {
    existing.close();
  } else {
    new TeleportPanel().render(true);
  }
};

// --- CHAT HOOK ---
export const registerTeleportHooks = () => {
  const STATUS_STYLE = 'text-align: center; color: var(--color-text-dark-secondary); font-style: italic; font-size: 11px; padding: 4px; border: 1px dashed var(--color-border-dark-4); border-radius: 3px;';

  Hooks.on('renderChatMessageHTML', (msg, htmlElement) => {
    const html = $(htmlElement);
    if (!msg.getFlag('draw-steel-combat-tools', 'isTpUndo')) return;

    const isUndone   = msg.getFlag('draw-steel-combat-tools', 'isUndone');
    const moveId     = msg.getFlag('draw-steel-combat-tools', 'moveId');
    const targetId   = msg.getFlag('draw-steel-combat-tools', 'targetTokenId');
    const sceneId    = msg.getFlag('draw-steel-combat-tools', 'targetSceneId');
    const finalPos   = msg.getFlag('draw-steel-combat-tools', 'finalPos');

    let isExpired = msg.getFlag('draw-steel-combat-tools', 'isExpired') ?? false;

    if (!isExpired && canvas.scene?.id === sceneId) {
        const token = canvas.scene.tokens.get(targetId);
        if (token) {
           const lastMoveId = token.getFlag('draw-steel-combat-tools', 'lastTpMoveId');
           if (lastMoveId && lastMoveId !== moveId) {
               isExpired = true;
           } else if (finalPos) {
               const isDead = token.actor?.statuses?.has('dead') || token.hidden;
               if (!isDead && (token.x !== finalPos.x || token.y !== finalPos.y || (token.elevation ?? 0) !== finalPos.elevation)) {
                   isExpired = true;
               }
           }
        } else {
           isExpired = true;
        }
    } else if (!isExpired && canvas.scene?.id !== sceneId) {
        isExpired = true;
    }

    const container = $('<div class="dsct-tp-undo-container" style="margin-top: 4px;"></div>');

    if (isUndone) {
      container.append(`<div style="${STATUS_STYLE}">(Teleport Undone)</div>`);
    } else if (isExpired) {
      container.append(`<div style="${STATUS_STYLE}">(Undo Expired)</div>`);
    } else if (game.user.isGM || msg.isAuthor) {
      const btn = $(`<button type="button" class="dsct-undo-tp" style="cursor:pointer; font-size: 12px; line-height: 14px; margin-top: 2px;"><i class="fa-solid fa-rotate-left"></i> Undo Teleport</button>`);
      btn.on('click', async (e) => {
        e.preventDefault();
        const undoLog = msg.getFlag('draw-steel-combat-tools', 'undoLog');
        if (undoLog) {
          await safeUpdate(msg, { 'flags.draw-steel-combat-tools.isUndone': true });
          await replayUndo(undoLog);
          ui.notifications.info('Teleport reversed.');
        }
      });
      container.append(btn);
    }

    html.find('.message-content').append(container);
  });
};