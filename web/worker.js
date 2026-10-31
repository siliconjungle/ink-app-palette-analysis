importScripts('./vendor/wasmoon/index.js');
let sources;
onmessage=async event=>{
  const {id,type,palette,options,pixels,limit,preferredPalette}=event.data;
  try{
    const analysis=await import('./analysis.mjs');
    if(type==='extract'){postMessage({id,result:analysis.extractPalette(new Uint8ClampedArray(pixels),limit,preferredPalette)});return;}
    const {SOURCE_PATHS,renderOriginal}=await import('./runner.mjs');
    sources??=await Promise.all(SOURCE_PATHS.map(path=>fetch(path).then(r=>{if(!r.ok)throw Error('Could not load analysis source');return r.text();})));
    const result=await renderOriginal({LuaFactory:wasmoon.LuaFactory,wasmURI:new URL('./vendor/wasmoon/glue.wasm',location.href).href,sources,palette,options,onProgress:step=>postMessage({id,progress:step})});
    postMessage({id,result},[result.rgba.buffer,result.indices.buffer,result.legacyPolar.rgba.buffer,result.legacyPolar.indices.buffer]);
  }catch(error){postMessage({id,error:error.message||'Analysis failed'});}
};
