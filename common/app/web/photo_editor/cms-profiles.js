// PhotoCraft crates/cms built-in profiles at the checked-out main.
// Matrix and gray profiles are built from the same primaries, white points and curves as builtin.rs.
// Coated CMYK is the shipped public-domain ICC, not a re-fit.
import {readIccModel} from './icc-lut.js';
export function isIccPath(spec){const name=String(spec||'').trim();const lower=name.toLowerCase();return lower.endsWith('.icc')||lower.endsWith('.icm');}

const D50=[0.9642,1,0.8249];
const BRADFORD=[[0.8951,0.2664,-0.1614],[-0.7502,1.7135,0.0367],[0.0389,-0.0685,1.0296]];
export const PROFILE_IDS=['srgb','display-p3','adobe-rgb-compat','prophoto-compat','linear-srgb','rec2020','gray-gamma-2.2','sgray','dot-gain-20-compat','lab-d50','coated-cmyk'];
const ALIASES={
  srgb:'srgb',srgbiec6196621:'srgb',srgbiec61966:'srgb',
  p3:'display-p3',displayp3:'display-p3',
  adobergb:'adobe-rgb-compat','adobe-rgb':'adobe-rgb-compat',adobergb1998:'adobe-rgb-compat',adobergbcompat:'adobe-rgb-compat',clayrgb:'adobe-rgb-compat',
  prophoto:'prophoto-compat',prophotorgb:'prophoto-compat',prophotocompat:'prophoto-compat',romm:'prophoto-compat',rommrgb:'prophoto-compat',
  linearsrgb:'linear-srgb',srgblinear:'linear-srgb',linear:'linear-srgb',
  rec2020:'rec2020',bt2020:'rec2020',
  gray:'gray-gamma-2.2',graygamma22:'gray-gamma-2.2',gamma22:'gray-gamma-2.2',
  sgray:'sgray',graysrgb:'sgray',
  dotgain20:'dot-gain-20-compat','dot-gain-20':'dot-gain-20-compat',dotgain20compat:'dot-gain-20-compat',dotgain:'dot-gain-20-compat',
  lab:'lab-d50',labd50:'lab-d50',cielab:'lab-d50',
  cmyk:'coated-cmyk',coatedcmyk:'coated-cmyk',defaultcmyk:'coated-cmyk',photocraftcoatedcmyk:'coated-cmyk'
};
const DESCRIPTIONS={
  srgb:'sRGB IEC61966-2.1',
  'display-p3':'Display P3',
  'adobe-rgb-compat':'Adobe RGB (1998)-compatible (PhotoCraft)',
  'prophoto-compat':'ProPhoto RGB-compatible (ROMM primaries, PhotoCraft)',
  'linear-srgb':'Linear sRGB (PhotoCraft)',
  rec2020:'Rec. ITU-R BT.2020 (PhotoCraft)',
  'gray-gamma-2.2':'Gray Gamma 2.2 (PhotoCraft)',
  sgray:'sGray (sRGB tone curve, PhotoCraft)',
  'dot-gain-20-compat':'Dot Gain 20%-compatible (gamma 1.732, PhotoCraft)',
  'lab-d50':'Lab D50 identity (PhotoCraft)',
  'coated-cmyk':'PhotoCraft Coated CMYK (synthetic, 300% TAC, medium GCR)'
};

function mul(a,b){const o=[[0,0,0],[0,0,0],[0,0,0]];for(let i=0;i<3;i++)for(let j=0;j<3;j++)o[i][j]=a[i][0]*b[0][j]+a[i][1]*b[1][j]+a[i][2]*b[2][j];return o;}
function apply(m,v){return [m[0][0]*v[0]+m[0][1]*v[1]+m[0][2]*v[2],m[1][0]*v[0]+m[1][1]*v[1]+m[1][2]*v[2],m[2][0]*v[0]+m[2][1]*v[1]+m[2][2]*v[2]];}
function det(m){return m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1])-m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0])+m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0]);}
function invert(m){const d=det(m);if(!Number.isFinite(d)||Math.abs(d)<1e-12)throw Error('The colour matrix cannot be inverted.');const s=1/d;return [[(m[1][1]*m[2][2]-m[1][2]*m[2][1])*s,(m[0][2]*m[2][1]-m[0][1]*m[2][2])*s,(m[0][1]*m[1][2]-m[0][2]*m[1][1])*s],[(m[1][2]*m[2][0]-m[1][0]*m[2][2])*s,(m[0][0]*m[2][2]-m[0][2]*m[2][0])*s,(m[0][2]*m[1][0]-m[0][0]*m[1][2])*s],[(m[1][0]*m[2][1]-m[1][1]*m[2][0])*s,(m[0][1]*m[2][0]-m[0][0]*m[2][1])*s,(m[0][0]*m[1][1]-m[0][1]*m[1][0])*s]];}
function xyToXyz(xy){const [x,y]=xy;return [x/y,1,(1-x-y)/y];}
function bradford(src,dst){const inv=invert(BRADFORD),s=apply(BRADFORD,src),d=apply(BRADFORD,dst),scale=[[d[0]/s[0],0,0],[0,d[1]/s[1],0],[0,0,d[2]/s[2]]];return mul(inv,mul(scale,BRADFORD));}
function s15(v){return Math.round(v*65536)/65536;}
function rgbToXyz(r,g,b,white){const [xr,xg,xb]=[xyToXyz(r),xyToXyz(g),xyToXyz(b)],m=[[xr[0],xg[0],xb[0]],[xr[1],xg[1],xb[1]],[xr[2],xg[2],xb[2]]],scale=apply(invert(m),white);return [[m[0][0]*scale[0],m[0][1]*scale[1],m[0][2]*scale[2]],[m[1][0]*scale[0],m[1][1]*scale[1],m[1][2]*scale[2]],[m[2][0]*scale[0],m[2][1]*scale[1],m[2][2]*scale[2]]];}
function colorants(r,g,b,white){
  const m=rgbToXyz(r,g,b,white),d50=D50.map(s15);
  const near=Math.abs(white[0]-D50[0])<1e-3&&Math.abs(white[2]-D50[2])<1e-3;
  let m50=m;
  if(!near)m50=mul(bradford(white,D50),m);
  else{const s=apply(m,[1,1,1]);m50=m.map((row,i)=>row.map(v=>v*D50[i]/s[i]));}
  const q=m50.map(row=>row.map(s15));
  for(let i=0;i<3;i++){const err=d50[i]-q[i].reduce((sum,v)=>sum+v,0);let k=0;for(let c=1;c<3;c++)if(Math.abs(q[i][c])>Math.abs(q[i][k]))k=c;q[i][k]=s15(q[i][k]+err);}
  return q;
}
function srgbDecode(x){return x<=0.04045?x/12.92:Math.max(0,(x+0.055)/1.055)**2.4;}
function srgbEncode(x){return x<=0.0031308?12.92*x:1.055*Math.max(0,x)**(1/2.4)-0.055;}
function gammaDecode(g){return x=>x<=0?0:x**g;}
function gammaEncode(g){return x=>x<=0?0:x**(1/g);}
function rec709Decode(x){const a=1.099,b=(a-1)/a,d=0.081;return x>=d?((x+b)*(1/a))**(1/0.45):x/4.5;}
function rec709Encode(x){const a=1.099;return x>=0.018?a*Math.max(0,x)**0.45-(a-1):4.5*x;}

function u32(n){return Uint8Array.of((n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255);}
function u16(n){return Uint8Array.of((n>>>8)&255,n&255);}
function s15bytes(v){const n=Math.round(v*65536)|0;return u32(n>>>0);}
function four(text){return new TextEncoder().encode(text);}
function align(bytes){const pad=(4-(bytes.length%4))%4;if(!pad)return bytes;const out=new Uint8Array(bytes.length+pad);out.set(bytes);return out;}
function xyzTag(xyz){const payload=new Uint8Array(12);payload.set(s15bytes(xyz[0]),0);payload.set(s15bytes(xyz[1]),4);payload.set(s15bytes(xyz[2]),8);const tag=new Uint8Array(8+payload.length);tag.set(four('XYZ '));tag.set(payload,8);return tag;}
function paraTag(kind,params){const payload=new Uint8Array(4+params.length*4);payload.set(u16(kind),0);for(let i=0;i<params.length;i++)payload.set(s15bytes(params[i]),4+i*4);const tag=new Uint8Array(8+payload.length);tag.set(four('para'));tag.set(payload,8);return tag;}
function encodeTags(space,pcs,tags,profileClass='mntr'){
  const count=tags.length,table=128+4+count*12;
  let cursor=table;const placed=tags.map((tag)=>{const at=cursor,data=align(tag.data);cursor+=data.length;return {name:tag.name,data,size:tag.data.length,at};});
  const out=new Uint8Array(cursor);
  out.set(u32(out.length),0);out[8]=4;out[9]=0x30;out.set(four(profileClass),12);out.set(four(space),16);out.set(four(pcs),20);out.set(four('acsp'),36);
  out.set(s15bytes(D50[0]),68);out.set(s15bytes(D50[1]),72);out.set(s15bytes(D50[2]),76);
  out.set(u32(count),128);
  placed.forEach((tag,index)=>{const at=132+index*12;out.set(four(tag.name),at);out.set(u32(tag.at),at+4);out.set(u32(tag.size),at+8);out.set(tag.data,tag.at);});
  return out;
}
function encodeRgb(matrix,trc){const columns=[[matrix[0][0],matrix[1][0],matrix[2][0]],[matrix[0][1],matrix[1][1],matrix[2][1]],[matrix[0][2],matrix[1][2],matrix[2][2]]];const tags=[{name:'wtpt',data:xyzTag(D50)},{name:'rXYZ',data:xyzTag(columns[0])},{name:'gXYZ',data:xyzTag(columns[1])},{name:'bXYZ',data:xyzTag(columns[2])}];for(const name of ['rTRC','gTRC','bTRC'])tags.push({name,data:trc});return encodeTags('RGB ','XYZ ',tags);}
function encodeGray(trc){return encodeTags('GRAY','XYZ ',[{name:'wtpt',data:xyzTag(D50)},{name:'kTRC',data:trc}]);}
function identityCurv(){const tag=new Uint8Array(12);tag.set(four('curv'));return tag;}
function identityLabLut(signature){const body=new Uint8Array(32+36);body.set(four(signature));body[8]=3;body[9]=3;body.set(u32(32),12);for(let i=0;i<3;i++)body.set(identityCurv(),32+i*12);return body;}
function mluc(text){const units=Array.from(text,char=>char.charCodeAt(0)),body=new Uint8Array(28+units.length*2);body.set(four('mluc'));body.set(u32(1),8);body.set(u32(12),12);body.set(four('enUS'),16);body.set(u32(units.length*2),20);body.set(u32(28),24);units.forEach((unit,index)=>{body[28+index*2]=unit>>8;body[29+index*2]=unit&255;});return body;}
function encodeLab(){const bytes=encodeTags('Lab ','Lab ',[{name:'desc',data:mluc('Lab D50 identity (PhotoCraft)')},{name:'cprt',data:mluc('No copyright: CC0-1.0 public domain dedication. Generated by photocraft-cms.')},{name:'wtpt',data:xyzTag(D50)},{name:'A2B0',data:identityLabLut('mAB ')},{name:'B2A0',data:identityLabLut('mBA ')}],'spac'),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);view.setUint16(24,2026);view.setUint16(26,1);view.setUint16(28,1);return bytes;}

const SRGB_PARA=paraTag(3,[2.4,1/1.055,0.055/1.055,1/12.92,0.04045]);
const GAMMA_22=paraTag(0,[2.2]);
const GAMMA_1732=paraTag(0,[1.732]);
const GAMMA_18=paraTag(0,[1.8]);
const GAMMA_1=paraTag(0,[1]);
const REC709_PARA=paraTag(3,[1/0.45,1/1.099,(1.099-1)/1.099,1/4.5,0.081]);

function rgbModel(id,primaries,white,decode,encode,trcTag){
  const matrix=colorants(primaries[0],primaries[1],primaries[2],white);
  const columns=[[matrix[0][0],matrix[1][0],matrix[2][0]],[matrix[0][1],matrix[1][1],matrix[2][1]],[matrix[0][2],matrix[1][2],matrix[2][2]]];
  const bytes=encodeRgb(matrix,trcTag);
  return {id,description:DESCRIPTIONS[id],bytes,space:'RGB ',pcs:'xyz',version:4,white:D50.map(s15),channels:3,a2b:[null,null,null],b2a:[null,null,null],columns,curves:[decode,decode,decode],invCurves:[encode,encode,encode],gray:null,grayInv:null};
}
function grayModel(id,decode,encode,trcTag){
  return {id,description:DESCRIPTIONS[id],bytes:encodeGray(trcTag),space:'GRAY',pcs:'xyz',version:4,white:D50.map(s15),channels:1,a2b:[null,null,null],b2a:[null,null,null],columns:null,curves:null,invCurves:null,gray:decode,grayInv:encode};
}
export function linearGrayProfile(){return grayModel('linear-gray',gammaDecode(1),gammaEncode(1),GAMMA_1);}
function labModel(){
  const bytes=encodeLab(),model=readIccModel(bytes);
  model.id='lab-d50';model.description=DESCRIPTIONS['lab-d50'];model.bytes=bytes;
  return model;
}

const D65=xyToXyz([0.3127,0.3290]);
const PRIMARIES={
  srgb:[[0.64,0.33],[0.30,0.60],[0.15,0.06]],
  p3:[[0.680,0.320],[0.265,0.690],[0.150,0.060]],
  adobe:[[0.64,0.33],[0.21,0.71],[0.15,0.06]],
  romm:[[0.7347,0.2653],[0.1596,0.8404],[0.0366,0.0001]],
  bt2020:[[0.708,0.292],[0.170,0.797],[0.131,0.046]]
};
const built=new Map();
function buildSync(id){
  switch(id){
    case 'srgb':return rgbModel(id,PRIMARIES.srgb,D65,srgbDecode,srgbEncode,SRGB_PARA);
    case 'display-p3':return rgbModel(id,PRIMARIES.p3,D65,srgbDecode,srgbEncode,SRGB_PARA);
    case 'adobe-rgb-compat':return rgbModel(id,PRIMARIES.adobe,D65,gammaDecode(563/256),gammaEncode(563/256),paraTag(0,[563/256]));
    case 'prophoto-compat':return rgbModel(id,PRIMARIES.romm,D50,gammaDecode(1.8),gammaEncode(1.8),GAMMA_18);
    case 'linear-srgb':return rgbModel(id,PRIMARIES.srgb,D65,gammaDecode(1),gammaEncode(1),GAMMA_1);
    case 'rec2020':return rgbModel(id,PRIMARIES.bt2020,D65,rec709Decode,rec709Encode,REC709_PARA);
    case 'gray-gamma-2.2':return grayModel(id,gammaDecode(2.2),gammaEncode(2.2),GAMMA_22);
    case 'sgray':return grayModel(id,srgbDecode,srgbEncode,SRGB_PARA);
    case 'dot-gain-20-compat':return grayModel(id,gammaDecode(1.732),gammaEncode(1.732),GAMMA_1732);
    case 'lab-d50':return labModel();
    default:return null;
  }
}
let coatedPromise=null,coatedSync=null;
async function coatedModel(){
  if(coatedSync)return coatedSync;
  if(!coatedPromise)coatedPromise=(async()=>{
    const url=new URL('./profiles/photocraft-coated-cmyk.icc',import.meta.url);
    let bytes;
    try{const response=await fetch(url);if(!response.ok)throw Error('The PhotoCraft coated CMYK profile is missing.');bytes=new Uint8Array(await response.arrayBuffer());}
    catch(error){if(error?.message==='The PhotoCraft coated CMYK profile is missing.')throw error;const {readFileSync}=await import('node:fs');bytes=new Uint8Array(readFileSync(url));}
    const model=readIccModel(bytes);
    model.id='coated-cmyk';model.description=DESCRIPTIONS['coated-cmyk'];model.bytes=bytes;
    coatedSync=model;
    return model;
  })().catch(error=>{coatedPromise=null;throw error;});
  return coatedPromise;
}
export function preloadProfiles(){return coatedModel();}
export function cachedProfile(spec){
  const id=canonicalProfileId(spec);
  if(!id)throw Error('Unknown profile `'+spec+'`.');
  if(id==='coated-cmyk'){if(!coatedSync)throw Error('The coated CMYK profile is still loading.');return coatedSync;}
  if(!built.has(id))built.set(id,buildSync(id));
  return built.get(id);
}

export function canonicalProfileId(spec){
  const raw=String(spec||'').trim();
  const folded=raw.toLowerCase().replace(/[^a-z0-9-]/g,'');
  return ALIASES[folded]||ALIASES[raw.toLowerCase()]||(PROFILE_IDS.includes(raw)?raw:null);
}
export function profileChoices(space){
  const ids=space==='cmyk'?['coated-cmyk']:space==='gray'?['dot-gain-20-compat','sgray','gray-gamma-2.2']:space==='lab'?['lab-d50']:['srgb','display-p3','adobe-rgb-compat','prophoto-compat','linear-srgb','rec2020'];
  return ids.map(id=>[id,DESCRIPTIONS[id]]);
}
function storedWorking(value,fallback){const text=String(value||'').trim();if(isIccPath(text))return text;return canonicalProfileId(text)||fallback;}
export function workingProfileId(settings,mode){
  if(mode==='cmyk')return storedWorking(settings?.workingCmyk,'coated-cmyk');
  if(mode==='gray')return storedWorking(settings?.workingGray,'dot-gain-20-compat');
  if(mode==='lab')return 'lab-d50';
  return storedWorking(settings?.workingRgb,'srgb');
}
export function profileSpace(id){
  const key=canonicalProfileId(id);
  if(!key)return null;
  if(key==='coated-cmyk')return 'cmyk';
  if(key==='lab-d50')return 'lab';
  if(key==='gray-gamma-2.2'||key==='sgray'||key==='dot-gain-20-compat')return 'gray';
  return 'rgb';
}
function profileBytes(value){if(value instanceof Uint8Array)return value;if(ArrayBuffer.isView(value))return new Uint8Array(value.buffer,value.byteOffset,value.byteLength);if(value instanceof ArrayBuffer)return new Uint8Array(value);if(Array.isArray(value))return Uint8Array.from(value);throw Error('The profile bytes did not arrive.');}
export async function profileById(spec){
  if(isIccPath(spec)){
    const host=globalThis.photocraftHost;
    if(!host?.readIcc)throw Error('An .icc path can be read in the editor window.');
    const file=await host.readIcc(String(spec).trim());
    const model=readIccModel(profileBytes(file.bytes));
    model.id=file.path||String(spec).trim();
    model.description=file.name||model.id;
    return model;
  }
  const id=canonicalProfileId(spec);
  if(!id)throw Error('Unknown profile `'+spec+'`.');
  if(id==='coated-cmyk')return coatedModel();
  if(!built.has(id))built.set(id,buildSync(id));
  return built.get(id);
}
export async function resolveProfile(spec,settings,doc){
  const name=String(spec||'');
  if(name==='none')return null;
  if(name==='working'||name==='default')return profileById(workingProfileId(settings,doc?.colorMode||'rgb'));
  if(name==='working-cmyk'||name==='workingCmyk')return profileById(workingProfileId(settings,'cmyk'));
  if(name==='working-rgb'||name==='workingRgb')return profileById(workingProfileId(settings,'rgb'));
  if(name==='working-gray'||name==='workingGray')return profileById(workingProfileId(settings,'gray'));
  if(name==='document'){if(!doc)throw Error('No document is open.');return documentProfile(doc,settings);}
  return profileById(name);
}
function sameBytes(a,b){if(!a||!b)return false;const left=a instanceof Uint8Array?a:new Uint8Array(a),right=b instanceof Uint8Array?b:new Uint8Array(b);if(left.length!==right.length)return false;for(let i=0;i<left.length;i++)if(left[i]!==right[i])return false;return true;}
export async function documentProfile(doc,settings){
  const mode=doc?.colorMode||'rgb';
  const named=doc?.profileName?canonicalProfileId(doc.profileName):null;
  if(named&&profileSpace(named)===mode){
    const model=await profileById(named);
    if(!doc.iccProfile||model.bytes&&sameBytes(doc.iccProfile,model.bytes))return model;
  }
  if(doc?.iccProfile){
    try{const model=readIccModel(doc.iccProfile);if(spaceName(model.space)===mode)return model;}catch{}
  }
  return profileById(workingProfileId(settings,mode));
}
export function spaceName(tag){return tag==='CMYK'?'cmyk':tag==='GRAY'?'gray':tag==='Lab '?'lab':tag==='RGB '?'rgb':null;}
export function spaceTag(mode){return mode==='cmyk'?'CMYK':mode==='gray'?'GRAY':mode==='lab'?'Lab ':'RGB ';}
export function modeOfProfile(model){const mode=spaceName(model.space);if(!mode)throw Error('This profile has no document mode.');return mode;}
