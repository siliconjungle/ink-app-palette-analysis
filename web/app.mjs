import {connect} from './sdk/browser.js';
import {VirtualList} from './sdk/virtual.js';
import {saveAnalysis} from './save.mjs';
import {DB32,PICO8,DEFAULT_OPTIONS,REGIONS,hex,brightness,saturation,validateOptions,pngPalette} from './analysis.mjs';
const $=id=>document.getElementById(id);
let ink,state,source=null,extracted=null,result=null,options=structuredClone(DEFAULT_OPTIONS),revision=0,working=0,worker,requestId=0,saveIdentity=null,dropRegistration,view='analysis';
const requests=new Map();
const rawCanvas=document.createElement('canvas'),classicCanvas=document.createElement('canvas');
let classicRegions=[];
const savedList=new VirtualList({container:$('saved-list'),rowHeight:60,overscan:3,key:item=>item.id,create(){
  const node=document.createElement('button'),copy=document.createElement('div'),title=document.createElement('strong'),detail=document.createElement('span');copy.append(title,detail);node.append(copy);node.className='saved-row';let current;
  node.onclick=()=>{$('saved-dialog').close();void openSaved(current.id).catch(showError);};
  return{node,update(item){current=item;title.textContent=item.title;detail.textContent=`${item.palette.length} colours · ${new Date(item.createdAt).toLocaleDateString()}`;}};
}});
for(const region of REGIONS.slice(1)){const option=document.createElement('option');option.value=region.id;option.textContent=region.name;$('section').append(option);}
function showError(error){$('notice').firstElementChild.textContent=typeof error==='string'?error:error.message;$('notice').hidden=false;}
function message(value){$('status').textContent=value;}
function controls(){for(const id of ['download','json','save'])$(id).disabled=!result||!!working;$('max-colors').disabled=!source||!!working;$('show-image').disabled=$('source-preview').disabled=!source;}
function setView(value){view=value;$('show-analysis').classList.toggle('selected',view==='analysis');$('show-image').classList.toggle('selected',view==='image');$('canvas-holder').hidden=view!=='analysis'||!result;$('image-holder').hidden=view!=='image'||!source;if(source){$('image-preview').src=source.dataURL;$('image-large').src=source.dataURL;}$('section').hidden=$('layout').hidden=view==='image';$('chart-detail').textContent=view==='image'&&source?`${source.title} · ${source.width||''} × ${source.height||''}`:(REGIONS.find(r=>r.id===$('section').value)?.detail||'');sizeCanvas();}
async function api(path,body){
  // Database records are already part of Ink's shared world. Reading them does
  // not need backend compute, including recovery after an interrupted save.
  if(ink&&!body&&path==='/analyses'){
    const analyses=[];let offset=0;
    do{const page=await ink.world.query({kind:'palette-analysis',namespace:ink.snapshot.namespace,limit:1000,offset});for(const record of page.objects)analyses.push({id:record.id,title:record.title,...JSON.parse(record.body)});offset=page.nextOffset??null;}while(offset!==null);
    return{analyses:analyses.sort((a,b)=>b.createdAt-a.createdAt)};
  }
  if(ink&&!body&&/^\/analyses\/[a-f0-9]{32}$/.test(path)){
    const record=await ink.world.get(path.split('/').at(-1));if(!record||record.kind!=='palette-analysis')throw Error('Analysis not found');return{id:record.id,title:record.title,...JSON.parse(record.body)};
  }
  const response=ink?await ink.backend.request(path,{method:body?'POST':'GET',...(body?{body}:{})}):await fetch('/backend'+path,{method:body?'POST':'GET',...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})}).then(async r=>({status:r.status,body:await r.json()}));
  if(response.status>=400)throw Error(response.body.error||'Request failed');return response.body;
}
function task(type,data){
  if(!worker){worker=new Worker('./worker.js');worker.onmessage=event=>{const {id,error,result,progress}=event.data;const pending=requests.get(id);if(!pending)return;if(progress!==undefined)return;
    clearTimeout(pending.timer);requests.delete(id);error?pending.reject(Error(error)):pending.resolve(result);
  };worker.onerror=()=>{for(const pending of requests.values()){clearTimeout(pending.timer);pending.reject(Error('The analysis worker failed. Reopen this app to retry.'));}requests.clear();};}
  const id=++requestId;
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{requests.delete(id);reject(Error('Analysis is taking longer than expected. Choose fewer colours or reopen the app.'));},90000);requests.set(id,{resolve,reject,timer});worker.postMessage({id,type,...data},data.pixels?[data.pixels]:[]);});
}
function paletteUI(){
  $('swatches').replaceChildren();if(!extracted)return;
  extracted.palette.forEach((color,index)=>{const button=document.createElement('button');button.className='swatch';button.style.background=hex(color);button.title=hex(color);button.setAttribute('aria-label',`Colour ${index+1}: ${hex(color)}`);
    button.onclick=()=>{for(const node of $('swatches').children)node.classList.toggle('selected',node===button);$('color-info').textContent=`${hex(color).toUpperCase()} · RGB ${color.join(', ')}\nBrightness ${brightness(color).toFixed(1)} · ${options.saturation==='purity'?'Purity':options.saturation.toUpperCase()} ${(saturation(color,options.saturation)*100).toFixed(1)}%`;};$('swatches').append(button);
  });
  $('palette-info').textContent=extracted.quantized?`${extracted.uniqueColors===null?'65,537+':extracted.uniqueColors.toLocaleString()} source colours → ${extracted.palette.length} extracted`:`${extracted.palette.length} exact colours`;
  $('color-info').textContent='';
}
async function analyse(){
  if(!extracted)return;const token=++revision;result=null;saveIdentity=null;$('canvas-holder').hidden=true;working++;controls();message('Analysing…');$('notice').hidden=true;
  const started=performance.now();
  try{
    const next=await task('render',{palette:extracted.palette,options});if(token!==revision)return;
    result=next;saveIdentity=null;
    rawCanvas.width=next.width;rawCanvas.height=next.height;rawCanvas.getContext('2d').putImageData(new ImageData(next.rgba,next.width,next.height),0,0);
    buildClassic();draw();paletteUI();
    $('render-info').textContent=`${extracted.palette.length} colours · ${((performance.now()-started)/1000).toFixed(2)} s`;
    message('');
    if(extracted.palette.length>64)$('chart-detail').textContent='Mixes & neutralisers use the original ≤64-colour limit.';
    if(state)await state.set('last',{sourceId:source?.id||null,sample:!source?$('sample').value:null,options,limit:Number($('max-colors').value)});
  }catch(error){if(token===revision){showError(error);message('Analysis unavailable');}}
  finally{working--;controls();}
}
function buildClassic(){
  classicCanvas.width=1074;classicCanvas.height=770;const ctx=classicCanvas.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.fillStyle='#141414';ctx.fillRect(0,0,1074,770);classicRegions=[];
  function region(id,x,y,w,h,box){const item=REGIONS.find(r=>r.id===id),crop=box||item.box;const scale=Math.min(w*2/crop[2],h*2/crop[3]),dw=crop[2]*scale,dh=crop[3]*scale;ctx.drawImage(rawCanvas,...crop,x*2+(w*2-dw)/2,y*2+(h*2-dh)/2,dw,dh);classicRegions.push({...item,box:[x*2,y*2,w*2,h*2]});}
  const colors=extracted.palette;for(let i=0;i<Math.min(colors.length,64);i++){ctx.fillStyle=hex(colors[i]);ctx.fillRect(6+i%8*30,6+Math.floor(i/8)*30,30,30);}
  ctx.fillStyle='#aaa';ctx.font='18px monospace';ctx.fillText(source?.title?.slice(0,32)||'Palette analysis',318,70);
  region('neutral',3,71,522,8,[18,230,512,10]);
  region('grays',3,86,34,99);region('hsb',39,86,275,99);
  region('brightness',324,85,27,180);
  region('brihue',389,85,136,107,[415,104,131,106]);
  const polar=document.createElement('canvas');polar.width=result.legacyPolar.width;polar.height=result.legacyPolar.height;polar.getContext('2d').putImageData(new ImageData(result.legacyPolar.rgba,polar.width,polar.height),0,0);
  ctx.drawImage(polar,6,390,504,328);classicRegions.push({...REGIONS.find(r=>r.id==='polar'),box:[6,390,504,328]});
  region('rgb',255,190,65,75,[371,17,86,87]);region('rgb',255,270,65,75,[458,17,87,87]);
  region('saturation',391,202,78,92);region('brihue',474,202,51,92,[369,104,47,106]);
  region('primary',330,302,62,51,[530,229,97,198]);
  region('neutral',400,302,126,32,[18,230,512,31]);
  region('mixes',444,340,80,16);
  region('12bit',3,362,522,20);
}
function draw(){
  if(!result)return;
  const canvas=$('report'),ctx=canvas.getContext('2d'),selected=REGIONS.find(r=>r.id===$('section').value)||REGIONS[0];
  const classic=$('layout').value==='classic'&&selected.id==='overview',base=classic?classicCanvas:rawCanvas;
  const [x,y,w,h]=selected.id==='overview'?[0,0,base.width,base.height]:selected.box;
  canvas.width=w;canvas.height=h;ctx.imageSmoothingEnabled=false;ctx.drawImage(base,x,y,w,h,0,0,w,h);
  $('canvas-holder').hidden=view!=='analysis';$('empty').hidden=true;$('regions').replaceChildren();
  if(selected.id==='overview')for(const region of classic?classicRegions:REGIONS.slice(1)){
    const button=document.createElement('button');button.className='region';button.title=region.name;button.setAttribute('aria-label',`Inspect ${region.name}`);
    const [rx,ry,rw,rh]=region.box;Object.assign(button.style,{left:rx/w*100+'%',top:ry/h*100+'%',width:rw/w*100+'%',height:rh/h*100+'%'});
    button.onmouseenter=()=>{$('chart-detail').textContent=region.detail;};button.onfocus=button.onmouseenter;
    button.onclick=()=>{$('section').value=region.id;draw();};$('regions').append(button);
  }
  $('chart-detail').textContent=selected.detail||'';$('layout').disabled=selected.id!=='overview';sizeCanvas();
}
function sizeCanvas(){if(!result&&view!=='image')return;const imageView=view==='image'&&source,canvas=imageView?{width:source.width||$('source-image').naturalWidth||96,height:source.height||$('source-image').naturalHeight||96}:$('report'),zoom=$('zoom').value;const scale=zoom==='fit'?Math.min(($('scroll').clientWidth-40)/canvas.width,($('scroll').clientHeight-40)/canvas.height):Number(zoom);const factor=Math.max(.15,scale);Object.assign($(imageView?'image-holder':'canvas-holder').style,{width:Math.round(canvas.width*factor)+'px',height:Math.round(canvas.height*factor)+'px'});}
new ResizeObserver(sizeCanvas).observe($('scroll'));
function dataURL(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('Could not read image'));reader.readAsDataURL(file);});}
async function decode(url){const image=new Image();image.src=url;await image.decode();if(image.naturalWidth*image.naturalHeight>16000000)throw Error('Use an image with at most 16 million pixels');return image;}
async function extractSource(){
  if(!source)return;
  // Saved reports can display signed Ink image URLs without reading pixels.
  // Fetch bytes only if the user asks to extract a different palette.
  if(source.displayOnly)source=await api('/image/'+source.id);
  const current=source;result=null;saveIdentity=null;$('canvas-holder').hidden=true;
  working++;controls();message('Reading colours…');
  try{const image=await decode(source.dataURL),canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);const imageData=ctx.getImageData(0,0,canvas.width,canvas.height);
    let preferredPalette=null;if(source.mime==='image/png'){const prefix=atob(source.dataURL.split(',')[1].slice(0,131072));preferredPalette=pngPalette(Uint8Array.from(prefix,c=>c.charCodeAt(0)));}
    const colors=await task('extract',{pixels:imageData.data.buffer,limit:Number($('max-colors').value),preferredPalette});
    if(source!==current)return;extracted=colors;
    source.width=canvas.width;source.height=canvas.height;$('source-image').src=source.dataURL;$('source-image').hidden=false;$('source-empty').hidden=true;$('image-size').textContent=`${canvas.width} × ${canvas.height}`;setView(view);
    $('title').textContent=source.title;$('sample').value='';paletteUI();
  }finally{working--;controls();}
  await analyse();
}
async function openFile(file){
  if(!file)return;if(file.kind==='palette-analysis'){await openSaved(file.id);return;}
  message('Opening image…');source=await api('/image/'+file.id);
  if(source.analysisId){await openSaved(source.analysisId);return;}
  await extractSource();
}
async function uploadFile(file){
  if(file.size>24*1024*1024)throw Error('Use an image below 24 MiB');
  if(ink){const url=await dataURL(file),files=await ink.files.upload([file]);source={id:files[0].id,title:file.name,mime:file.type,dataURL:url};await extractSource();}
  else{const url=await dataURL(file),response=await fetch('/upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:file.name,mime:file.type,base64:url.split(',')[1]})});const value=await response.json();if(!response.ok)throw Error(value.error);await openFile(value.file);}
}
async function pick(){if(ink){const files=await ink.files.pick({multiple:false});if(files[0])await openFile(files[0]);}else $('file-input').click();}
async function sample(name){source=null;extracted={palette:structuredClone(name==='pico8'?PICO8:DB32),quantized:false};$('sample').value=name;$('title').textContent=name==='pico8'?'PICO-8':'DawnBringer 32';$('source-image').hidden=true;$('source-empty').hidden=false;$('source-empty').textContent='Sample palette';$('image-size').textContent='';setView('analysis');await analyse();}
async function openSaved(id){message('Opening…');const saved=await api('/analyses/'+id);options=validateOptions(saved.options);$('layout').value=saved.layout||'toolbox';
  if(saved.sourceId&&ink){const file=await ink.world.get(saved.sourceId),metadata=JSON.parse(file.body||'{}');source={id:file.id,title:file.title,mime:metadata.mime,dataURL:ink.files.url(file.id),displayOnly:true,width:metadata.width,height:metadata.height};}
  else source=saved.sourceId?await api('/image/'+saved.sourceId):null;
  extracted={palette:saved.palette,...(saved.extraction||{quantized:false})};$('max-colors').value=saved.extraction?.limit||256;$('title').textContent=saved.title;$('sample').value='';
  $('source-image').hidden=!source;$('source-empty').hidden=!!source;if(source){const image=await decode(source.dataURL);source.width=image.naturalWidth;source.height=image.naturalHeight;$('image-size').textContent=`${source.width} × ${source.height}`;$('source-image').src=source.dataURL;}setView('analysis');
  await analyse();saveIdentity=null;
}
function reportCanvas(){return $('layout').value==='classic'?classicCanvas:rawCanvas;}
function download(url,name){const link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();}
function baseName(){return(source?.title||$('title').textContent||'palette').replace(/\.[a-z0-9]+$/i,'').slice(0,90);}
$('download').onclick=()=>download(reportCanvas().toDataURL('image/png'),baseName()+'-analysis.png');
$('json').onclick=()=>{const data={title:$('title').textContent,sourceId:source?.id||null,palette:extracted.palette,extraction:{quantized:extracted.quantized,uniqueColors:extracted.uniqueColors,visiblePixels:extracted.visiblePixels,limit:Number($('max-colors').value)},hex:extracted.palette.map(hex),options,layout:$('layout').value,engine:result.engine};const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));download(url,baseName()+'-palette.json');setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('save').onclick=async()=>{
  $('save').disabled=true;message('Saving…');saveIdentity??=crypto.randomUUID().replaceAll('-','');
  try{const {palette,...statistics}=extracted;const data={id:saveIdentity,title:baseName(),sourceId:source?.id||null,palette,extraction:{...statistics,limit:Number($('max-colors').value)},options,layout:$('layout').value,report:reportCanvas().toDataURL('image/png')};await saveAnalysis(api,data);message('Saved');if(ink)void ink.desktop.toast('Palette analysis saved').catch(()=>{});}
  catch(error){showError(error.message+' Use Save to Ink again to resume this report.');message('Save interrupted');}
  finally{controls();}
};
$('open').onclick=$('empty-open').onclick=()=>void pick().catch(showError);
$('show-analysis').onclick=()=>setView('analysis');$('show-image').onclick=()=>setView('image');
$('source-preview').onclick=()=>{if(!source)return;$('image-dialog-title').textContent=source.title;$('image-large').src=source.dataURL;$('image-large').style.width=Math.min(720,(source.width||256)*4)+'px';$('image-dialog').showModal();};
$('upload').onclick=()=>$('file-input').click();
$('file-input').onchange=event=>{const file=event.target.files[0];event.target.value='';if(file)void uploadFile(file).catch(showError);};
$('max-colors').onchange=()=>void extractSource().catch(showError);
$('sample').onchange=event=>{if(event.target.value)void sample(event.target.value).catch(showError);};
$('section').onchange=$('layout').onchange=()=>{saveIdentity=null;draw();};$('zoom').onchange=sizeCanvas;
$('toggle-sidebar').onclick=()=>{if(matchMedia('(max-width:720px)').matches)document.body.classList.toggle('sidebar-open');else document.body.classList.toggle('sidebar-hidden');sizeCanvas();};
$('dismiss').onclick=()=>{$('notice').hidden=true;};
for(const button of document.querySelectorAll('[data-close]'))button.onclick=()=>$(button.dataset.close).close();
function populateSettings(value=options){const form=$('settings-form');for(const [key,item]of Object.entries(value)){if(key==='saturations')item.forEach((n,i)=>form.elements['sat'+i].value=n);else if(key==='excludeBackground')form.elements[key].checked=item;else form.elements[key].value=item;}}
$('settings').onclick=()=>{populateSettings();$('settings-dialog').showModal();};
$('reset-settings').onclick=()=>populateSettings(DEFAULT_OPTIONS);
$('settings-form').onsubmit=event=>{event.preventDefault();const fields=event.target.elements;options=validateOptions({saturation:fields.saturation.value,closeLow:Number(fields.closeLow.value),closeHigh:Number(fields.closeHigh.value),saturations:[0,1,2].map(i=>Number(fields['sat'+i].value)),excludeBackground:fields.excludeBackground.checked});$('settings-dialog').close();void analyse();};
$('math-info').onclick=()=>$('methods-dialog').showModal();
$('saved').onclick=async()=>{try{const data=await api('/analyses');$('saved-dialog').showModal();$('saved-empty').hidden=!!data.analyses.length;savedList.set(data.analyses);}catch(error){showError(error);}};
addEventListener('dragover',event=>{if(event.dataTransfer?.types.includes('Files')){event.preventDefault();document.body.classList.add('dragging');}});
addEventListener('dragleave',event=>{if(!event.relatedTarget)document.body.classList.remove('dragging');});
addEventListener('drop',event=>{document.body.classList.remove('dragging');if(!ink&&event.dataTransfer?.files[0]){event.preventDefault();void uploadFile(event.dataTransfer.files[0]).catch(showError);}});
addEventListener('pagehide',()=>{dropRegistration?.unsubscribe();savedList.destroy();void state?.close();});
async function boot(){
  if(parent!==window){ink=await connect();ink.ready();state=await ink.state.open('palette-analysis');
    ink.on('visibility',event=>savedList.suspend(event.hidden));
    dropRegistration=ink.files.acceptDrops(['image/*'],files=>{if(files[0])void openFile(files[0]).catch(showError);});await dropRegistration.ready;
    if(ink.route?.id){const file=await ink.world.get(ink.route.id);await openFile(file);return;}
    const last=state.get('last',null);if(last){options=validateOptions(last.options);$('max-colors').value=last.limit||256;if(last.sourceId){await openFile({id:last.sourceId});return;}if(last.sample){await sample(last.sample);return;}}
  }
  await sample('db32');
}
const commandBoot=boot().catch(showError);
globalThis.InkAppCommandHandlers={analyse:async input=>{await commandBoot;await openFile({id:input.file});}};
