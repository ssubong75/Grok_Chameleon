let lowResolution=true;
export function setPreviewPolicy(enabled){lowResolution=Boolean(enabled);}
export function previewScale(width,height,maxWidth=640,maxHeight=maxWidth){if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw Error('Invalid preview dimensions.');return lowResolution?Math.min(1,maxWidth/width,maxHeight/height):1;}
