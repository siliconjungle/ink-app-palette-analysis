export const DEFAULT_OPTIONS = Object.freeze({saturation: 'purity', closeLow: 10, closeHigh: 70, saturations: [255,128,48], excludeBackground: false});
export const DB32 = ['000000','222034','45283c','663931','8f563b','df7126','d9a066','eec39a','fbf236','99e550','6abe30','37946e','4b692f','524b24','323c39','3f3f74','306082','5b6ee1','639bff','5fcde4','cbdbfc','ffffff','9badb7','847e87','696a6a','595652','76428a','ac3232','d95763','d77bba','8f974a','8a6f30'].map(hex=>[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16)));
export const PICO8 = ['000000','1d2b53','7e2553','008751','ab5236','5f574f','c2c3c7','fff1e8','ff004d','ffa300','ffec27','00e436','29adff','83769c','ff77a8','ffccaa'].map(hex=>[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16)));
export const hex = color => '#' + color.slice(0,3).map(n=>n.toString(16).padStart(2,'0')).join('');
export const brightness = ([r,g,b]) => Math.min(255,Math.sqrt(.0676*r*r+.3025*g*g+.0361*b*b)*1.5690256395005606);
export function saturation(color, mode='purity') {
  let [lo,mid,hi]=color.slice(0,3).sort((a,b)=>a-b);
  if(mode==='hsv')return hi===0?0:(hi-lo)/hi;
  if(mode==='hsl'){const d=hi-lo,l=(hi+lo)/510;return d===0?0:Math.min(1,Math.ceil(d/255/(1-Math.abs(2*l-1))*1000)*.001);}
  if(hi>0){const scale=255/hi;hi=Math.ceil(hi*scale*1000)*.001;mid=Math.ceil(mid*scale*1000)*.001;lo=Math.ceil(lo*scale*1000)*.001;}
  return ((hi-mid)+(255-(hi-mid))/255*(mid-lo))/255;
}
export function validateOptions(input={}) {
  const value={...DEFAULT_OPTIONS,...input,saturations:input.saturations||[...DEFAULT_OPTIONS.saturations]};
  if(!['purity','hsv','hsl'].includes(value.saturation))throw Error('Unknown saturation model');
  for(const key of ['closeLow','closeHigh'])if(!Number.isFinite(value[key])||value[key]<0||value[key]>100)throw Error('Brightness weights must be 0–100');
  if(value.saturations.length!==3||value.saturations.some(n=>!Number.isInteger(n)||n<0||n>255))throw Error('Saturation levels must be 0–255');
  value.excludeBackground=!!value.excludeBackground;return value;
}
export function validatePalette(palette) {
  if(!Array.isArray(palette)||palette.length<1||palette.length>256)throw Error('A palette needs 1–256 colours');
  if(palette.some(c=>!Array.isArray(c)||c.length<3||c.slice(0,3).some(n=>!Number.isInteger(n)||n<0||n>255)))throw Error('Invalid RGB palette');
  return palette.map(c=>c.slice(0,3));
}

export function pngPalette(bytes){
  if(bytes.length<8||[137,80,78,71,13,10,26,10].some((n,i)=>bytes[i]!==n))return null;
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  for(let offset=8;offset+12<=bytes.length;){const length=view.getUint32(offset),type=String.fromCharCode(...bytes.subarray(offset+4,offset+8));
    if(offset+12+length>bytes.length)break;
    if(type==='PLTE'){if(length%3||length>768)return null;const colors=[];for(let i=offset+8;i<offset+8+length;i+=3)colors.push(Array.from(bytes.subarray(i,i+3)));return colors;}
    if(type==='IDAT')break;offset+=length+12;
  }return null;
}

// Exact RGB entries for small palettes; deterministic weighted median cut otherwise.
export function extractPalette(pixels, limit=256, preferredPalette=null) {
  if(![16,32,64,128,256].includes(limit))throw Error('Unsupported palette size');
  const exact=new Map(), bins=new Map();let visiblePixels=0,overflow=false;
  for(let i=0;i<pixels.length;i+=4){
    const alpha=pixels[i+3];if(!alpha)continue;visiblePixels++;
    const r=pixels[i],g=pixels[i+1],b=pixels[i+2],w=alpha/255,key=(r<<16)|(g<<8)|b;
    if(!overflow){const prior=exact.get(key);if(prior)prior.count+=w;else if(exact.size<65536)exact.set(key,{rgb:[r,g,b],count:w,order:i});else {overflow=true;exact.clear();}}
    const bin=((r>>3)<<10)|((g>>3)<<5)|(b>>3),entry=bins.get(bin);
    if(entry){entry.count+=w;entry.r+=r*w;entry.g+=g*w;entry.b+=b*w;}
    else bins.set(bin,{count:w,r:r*w,g:g*w,b:b*w});
  }
  if(!visiblePixels)throw Error('This image has no visible pixels');
  if(!overflow&&exact.size<=limit){const colors=[...exact.values()];if(preferredPalette){const order=new Map();preferredPalette.forEach((c,i)=>{if(!order.has(hex(c)))order.set(hex(c),i);});colors.sort((a,b)=>(order.get(hex(a.rgb))??Infinity)-(order.get(hex(b.rgb))??Infinity));}return {palette:colors.map(c=>c.rgb),counts:colors.map(c=>c.count),uniqueColors:colors.length,visiblePixels,quantized:false};}
  let entries=overflow?[...bins.values()].map(c=>({rgb:[Math.round(c.r/c.count),Math.round(c.g/c.count),Math.round(c.b/c.count)],count:c.count})):[...exact.values()];
  const describe=points=>{const min=[255,255,255],max=[0,0,0];let count=0;for(const p of points){count+=p.count;for(let c=0;c<3;c++){min[c]=Math.min(min[c],p.rgb[c]);max[c]=Math.max(max[c],p.rgb[c]);}}const ranges=max.map((n,i)=>n-min[i]);const axis=ranges.indexOf(Math.max(...ranges));return{points,count,axis,score:ranges[axis]*Math.sqrt(count)};};
  const boxes=[describe(entries)];
  while(boxes.length<limit){let best=-1;for(let i=0;i<boxes.length;i++)if(boxes[i].points.length>1&&(best<0||boxes[i].score>boxes[best].score))best=i;if(best<0)break;
    const box=boxes.splice(best,1)[0];box.points.sort((a,b)=>a.rgb[box.axis]-b.rgb[box.axis]||a.rgb[0]-b.rgb[0]||a.rgb[1]-b.rgb[1]||a.rgb[2]-b.rgb[2]);let total=0,index=0;
    while(index<box.points.length-1&&total<box.count/2)total+=box.points[index++].count;
    index=Math.max(1,index);boxes.push(describe(box.points.slice(0,index)),describe(box.points.slice(index)));
  }
  const merged=new Map();for(const box of boxes){const rgb=[0,0,0];for(const p of box.points)for(let c=0;c<3;c++)rgb[c]+=p.rgb[c]*p.count;for(let c=0;c<3;c++)rgb[c]=Math.round(rgb[c]/box.count);const key=hex(rgb);const item=merged.get(key);if(item)item.count+=box.count;else merged.set(key,{rgb,count:box.count});}
  const colors=[...merged.values()].sort((a,b)=>brightness(a.rgb)-brightness(b.rgb));
  return{palette:colors.map(c=>c.rgb),counts:colors.map(c=>c.count),uniqueColors:overflow?null:exact.size,visiblePixels,quantized:true};
}

// Regions match the original 640×432 V2.21 sheet in the article.
export const REGIONS = [
  {id:'overview',name:'Overview',box:[0,0,640,432]},
  {id:'grays',name:'Grayscale matches',box:[17,9,34,105],detail:'RGB distance and 50% / 85% brightness-weighted grayscale matches.'},
  {id:'hsb',name:'Hue–brightness fields',box:[52,9,275,105],detail:'HSB nearest-colour fields at the three selected saturation levels.'},
  {id:'brightness',name:'Brightness matching & levels',box:[328,9,27,204],detail:'Nearest brightness and the palette’s actual brightness levels.'},
  {id:'rgb',name:'RGB colour-space cubes',box:[372,9,171,97],detail:'The same palette in two isometric RGB projections.'},
  {id:'spectrum',name:'Spectrum ramps',box:[0,115,220,95],detail:'Two hybrid brightness weights, saturation/lightness ramps and intermediate variants.'},
  {id:'indexed',name:'Indexed palette',box:[221,115,103,42],detail:'Original indexed entries; duplicate padded slots are marked.'},
  {id:'closest',name:'Closest colour pairs',box:[221,158,105,55],detail:'The ten closest pairs under each selected brightness weight.'},
  {id:'brihue',name:'Hue–brightness scatter',box:[369,104,174,106],detail:'Palette hue against perceptual brightness, with three saturation bands.'},
  {id:'saturation',name:'Brightness & saturation bars',box:[549,93,79,135],detail:'A side-by-side comparison for every palette entry.'},
  {id:'mixes',name:'Useful dither mixes',box:[548,16,80,73],detail:'Gamma-adjusted midpoint novelty versus colour-pair distance; original limit: 64 colours.'},
  {id:'neutral',name:'Brightness order & neutralisers',box:[0,215,530,50],detail:'Brightness-sorted colours, best neutralising pairs and three half-shade rows.'},
  {id:'12bit',name:'12-bit colour-space coverage',box:[17,265,132,44],detail:'The original 4,096-colour RGB cube mapped to this palette.'},
  {id:'huesat',name:'Polar hue–saturation',box:[17,310,125,119],detail:'Hue angle and selected saturation radius; marker size follows brightness.'},
  {id:'polar',name:'Polar hue–brightness',box:[151,265,177,164],detail:'Four nearest-colour polar fields, light-centred and dark-centred, S255 / S96.'},
  {id:'complement',name:'Complementaries & desaturation',box:[312,265,216,164],detail:'Six opposing hue pairs with brightness/desaturation variation.'},
  {id:'primary',name:'Primary colour ranges',box:[530,229,97,198],detail:'Black–primary–white ramps and varying brightness-match weights for nine hue anchors.'}
];
