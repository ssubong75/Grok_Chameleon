// View › Screen Mode. PhotoCraft view_cmds.rs SCREEN_MODES, hides_chrome, hides_tabs, shows_scrollbars.
export const screenModes=['standard','fullScreenWithMenuBar','fullScreen'];
export function nextScreenMode(mode){const index=screenModes.indexOf(mode);return screenModes[(index<0?0:index+1)%screenModes.length];}
export function screenChrome(mode){const full=mode==='fullScreen',standard=mode==='standard';return {menu:!full,options:!full,tools:!full,dock:!full,status:!full,tabs:standard,scrollbars:standard,black:full,fullscreen:!standard};}
