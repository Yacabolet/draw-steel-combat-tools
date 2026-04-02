export const registerModuleButtons = () => {
  Hooks.on('getModuleTools', (controlManager, tools) => {
    
    // Fetch our API
    const api = game.modules.get('draw-steel-combat-tools')?.api;
    if (!api) return;

    // Create a single, top-level button (not a radial menu yet)
    tools.dsct_test = {
      icon: 'fas fa-hand-rock',
      title: 'DSCT: Grab Panel',
      type: 'button',
      onClick: () => {
        console.log("🔴 DSCT DEBUG | DragonFlagon Button Clicked!");
        api.grabPanel();
      }
    };
    
  });
};