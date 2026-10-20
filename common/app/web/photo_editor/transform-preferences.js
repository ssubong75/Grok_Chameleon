// The current transform engine's shift argument means proportional scaling.
export function transformShift(handle,shift,legacy){return !legacy&&['nw','ne','sw','se'].includes(handle)?!shift:Boolean(shift);}
