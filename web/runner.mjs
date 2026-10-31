import {validatePalette,validateOptions} from './analysis.mjs';
export const SOURCE_PATHS=['host.lua','vendor/dawn/libs/dawnbringer_lib.lua','vendor/dawn/libs/db_text.lua','vendor/dawn/ffonts/font_mini_3x4.lua','vendor/dawn/scripts/pic_db_AnalyzePalette18.lua'];
function luaValue(value){if(Array.isArray(value))return '{'+value.map(luaValue).join(',')+'}';if(value&&typeof value==='object')return '{'+Object.entries(value).map(([k,v])=>'['+JSON.stringify(k)+']='+luaValue(v)).join(',')+'}';return JSON.stringify(value);}
export async function renderOriginal({LuaFactory,wasmURI,sources,palette,options={},onProgress=()=>{}}){
  palette=validatePalette(palette);options=validateOptions(options);
  if(new Set(palette.map(c=>c.join(','))).size-(options.excludeBackground?1:0)<2)throw Error('Analysis needs at least two distinct colours after exclusions');
  const factory=new LuaFactory(wasmURI),lua=await factory.createEngine({enableProxy:false});
  try{
    lua.global.set('progress',onProgress);
    await lua.doString('INPUT_PALETTE='+luaValue(palette)+'\nOPTIONS='+luaValue(options));
    for(const source of sources)await lua.doString(source);
    function pixels(value){const indices=Uint8Array.from(value.rows.join(',').split(','),Number),rgba=new Uint8ClampedArray(indices.length*4);
      for(let i=0;i<indices.length;i++){const c=palette[indices[i]<palette.length?indices[i]:0],o=i*4;rgba[o]=c[0];rgba[o+1]=c[1];rgba[o+2]=c[2];rgba[o+3]=255;}
      return{width:value.width,height:value.height,rgba,indices};}
    const original=await lua.doString('return EXPORT_PIXELS()');
    const result=pixels(original);
    // The older DB32 arrangement has six polar fields instead of V2.21's four.
    // Draw those with the very same source function, without stretching charts.
    const polar=await lua.doString(`
      local p=db.fixPalette(db.makePalList(256),1)
      local sf=OPTIONS.saturation=='hsv' and db.getSaturationHSV_255 or OPTIONS.saturation=='hsl' and db.getSaturationHSL_255 or db.getPurity_255
      p=db.addHSBtoPalette(p,sf)
      if OPTIONS.excludeBackground then local r,g,b=getcolor(0);p=db.strip_RGB_FromPalList(p,r,g,b) end
      setpicturesize(252,164);clearpicture(matchcolor(0,0,0))
      for i=1,3 do
        db.polarHSBdiagram_Pixel(p,(i-1)*84,0,40,OPTIONS.saturations[i],1.25,false)
        db.polarHSBdiagram_Pixel(p,(i-1)*84,82,40,OPTIONS.saturations[i],1.25,true)
      end
      return EXPORT_PIXELS()
    `);
    return{...result,legacyPolar:pixels(polar),message:original.message,palette,options,engine:'DawnBringer Analyze Palette V2.21'};
  }finally{lua.global.close();}
}
