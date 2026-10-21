// PhotoCraft layer_menu_cmds global_light. Angle wraps to -180..180. Altitude stays in 0..90.
const F32_MAX=3.4028234663852886e38;
export function defaultGlobalLight(){return {angle:120,altitude:30};}
function readLight(params,key,fallback){if(params?.[key]==null||params[key]==='')return fallback;const value=Number(params[key]);if(!Number.isFinite(value)||Math.abs(value)>F32_MAX)throw Error(key+' must be a finite number');return value;}
export function setGlobalLight(current,params={}){const cur=current||defaultGlobalLight(),angle=readLight(params,'angle',cur.angle),altitude=Math.max(0,Math.min(90,readLight(params,'altitude',cur.altitude)));return {angle:((angle+180)%360+360)%360-180,altitude};}
export function lightRecord(raw){if(raw==null)return defaultGlobalLight();return setGlobalLight(defaultGlobalLight(),raw);}
