import {traceMask} from './shape-trace.js';
export function selectionShapeTolerance(value){const n=value==null?2:Number(value);return Number.isFinite(n)?Math.max(.5,Math.min(10,n)):2;}
export function selectionShapePath(alpha,width,height,tolerance){return traceMask(alpha,width,height,0,0,0,selectionShapeTolerance(tolerance));}
