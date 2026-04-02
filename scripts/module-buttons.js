export const registerModuleButtons = () => {
  Hooks.on('getSceneControlButtons', (controls) => {
    
    // Find the native Token Controls menu (the top icon on the left)
    const tokenControl = controls.tokens || controls.token;
    if (!tokenControl) return;

    // We fetch the API lazily when the button is clicked
    const getApi = () => game.modules.get('draw-steel-combat-tools')?.api;

    const myTools = {
      'dsct-grab': {
        name: 'dsct-grab',
        title: 'Grab Panel',
        icon: 'fas fa-hand-rock',
        button: true,
        visible: true,
        onClick: () => getApi()?.grabPanel(),
        onChange: () => getApi()?.grabPanel()
      },
      'dsct-wall': {
        name: 'dsct-wall',
        title: 'Wall Builder',
        icon: 'fas fa-dungeon',
        button: true,
        visible: game.user.isGM,
        onClick: () => getApi()?.wallBuilder(),
        onChange: () => getApi()?.wallBuilder()
      },
      'dsct-pwk': {
        name: 'dsct-pwk',
        title: 'Power Word: Kill',
        icon: 'fas fa-skull',
        button: true,
        visible: game.user.isGM,
        onClick: () => getApi()?.powerWordKill(),
        onChange: () => getApi()?.powerWordKill()
      }
    };

    // Safely inject tools into the native Token category for V12 or V13
    if (Array.isArray(tokenControl.tools)) {
      tokenControl.tools.push(...Object.values(myTools));
    } else {
      let orderIndex = Object.keys(tokenControl.tools).length;
      for (const [key, tool] of Object.entries(myTools)) {
        tool.order = orderIndex++;
        tokenControl.tools[key] = tool;
      }
    }
  });
};