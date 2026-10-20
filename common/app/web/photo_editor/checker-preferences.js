// PhotoCraft TransparencyAndGamut::colors, MIT; see vendor attribution.
export const checkerPalettes={light:['#ffffff','#cccccc'],medium:['#999999','#666666'],dark:['#666666','#333333'],red:['#ffffff','#ffcccc'],orange:['#ffffff','#ffe5cc'],green:['#ffffff','#ccffcc'],blue:['#ffffff','#cce5ff'],purple:['#ffffff','#e5ccff']};
export function checkerColors(prefs){return prefs.gridColors==='custom'?[prefs.checkerLight,prefs.checkerDark]:checkerPalettes[prefs.gridColors]||checkerPalettes.light;}
