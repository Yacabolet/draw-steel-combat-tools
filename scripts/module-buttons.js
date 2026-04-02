export const registerModuleButtons = () => {
  Hooks.on('getModuleTools', (controlManager, tools) => {
    
    // Fetch our API
    const api = game.modules.get('draw-steel-combat-tools')?.api;
    if (!api) return;

    // The main Radial Tool
    tools.dsct = {
      icon: 'fas fa-hammer',
      title: 'Draw Steel Combat Tools',
      type: 'radial',
      tools: {
        grabPanel: {
          title: 'Grab Panel',
          icon: 'fas fa-hand-rock',
          type: 'button',
          onClick: () => api.grabPanel()
        },
        wallBuilder: {
          title: 'Wall Builder (GM)',
          icon: 'fas fa-dungeon',
          type: 'button',
          enabled: () => game.user.isGM, // Only shows up for the GM!
          onClick: () => api.wallBuilder()
        },
        squadLabels: {
          title: 'Apply Squad Labels (GM)',
          icon: 'fas fa-tags',
          type: 'button',
          enabled: () => game.user.isGM,
          onClick: () => api.squadLabels()
        },
        renameSquads: {
          title: 'Auto-Rename Squads (GM)',
          icon: 'fas fa-spell-check',
          type: 'button',
          enabled: () => game.user.isGM,
          onClick: async () => {
            await api.renameSquads();
            ui.notifications.info("NPC Combat squads renamed.");
          }
        },
        triggeredActions: {
          title: 'Triggered Actions Tracker (GM)',
          icon: 'fas fa-shield-alt',
          type: 'button',
          enabled: () => game.user.isGM,
          onClick: () => api.triggeredActions('ALL')
        }
      }
    };
    
  });
};