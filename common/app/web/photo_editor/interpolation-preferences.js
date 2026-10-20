// PhotoCraft prefs.rs Interpolation choices. MIT; see vendor attribution.
export const interpolationOptions=[['bicubicAutomatic','Bicubic Automatic'],['nearestNeighbor','Nearest Neighbor'],['bilinear','Bilinear'],['bicubic','Bicubic'],['bicubicSmoother','Bicubic Smoother'],['bicubicSharper','Bicubic Sharper'],['preserveDetails','Preserve Details']];
export function preferenceResampling(value){if(!interpolationOptions.some(([id])=>id===value))throw Error('Choose a listed image interpolation.');return value==='nearestNeighbor'?'nearest':value;}
// Browser affine drawing exposes smoothing, not PhotoCraft's complete resampling kernels.
export function applyCanvasInterpolation(context,value='bicubicAutomatic'){
  const method=value==='nearest'?'nearest':preferenceResampling(value);
  context.imageSmoothingEnabled=method!=='nearest';context.imageSmoothingQuality=method==='bilinear'?'low':'high';
}
