import {createHash} from 'node:crypto';
// Only file persistence crosses the backend. Colour analysis runs locally in a worker.
const ID=/^[a-f0-9]{32}$/;
const fail=(message,status=400)=>Object.assign(Error(message),{status});
function palette(value){if(!Array.isArray(value)||value.length<1||value.length>256||value.some(c=>!Array.isArray(c)||c.length!==3||c.some(n=>!Number.isInteger(n)||n<0||n>255)))throw fail('Invalid palette');return value;}
function png(value){if(typeof value!=='string'||value.length>6*1024*1024)throw fail('Image must be smaller than 4 MiB');const bytes=Buffer.from(value.replace(/^data:image\/png;base64,/,''),'base64');if(bytes.length<24||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw fail('A PNG report is required');const w=bytes.readUInt32BE(16),h=bytes.readUInt32BE(20);if(w*h>4000000)throw fail('Report is too large');return bytes;}
export function createService({headless}={}){const operations=new Map();return async function handle(request,{ink,namespace}){
  try{
    const path=new URL(request.url).pathname;
    if(path==='/workflow/analyse'&&request.method==='POST'){
      if(!headless)throw fail('Build the workflow renderer before deploying this app',503);
      const input=await request.json();if(!ID.test(input.file||''))throw fail('Choose a PNG image');
      const file=await ink.data.get(input.file);if(file.kind!=='file'||file.archived)throw fail('Source image is unavailable',404);
      const metadata=JSON.parse(file.body||'{}');if(metadata.mime!=='image/png')throw fail('Background analysis accepts PNG images');
      const bytes=Buffer.from(await ink.assets.get(file.id));if(bytes.length>24*1024*1024)throw fail('Use an image below 24 MiB');
      const identity=input.__inkWorkflow?createHash('sha256').update(input.__inkWorkflow.runId+':'+input.__inkWorkflow.stepId).digest('hex').slice(0,32):createHash('sha256').update(String(Date.now())+Math.random()).digest('hex').slice(0,32);
      try{const existing=await ink.data.get(identity),value=JSON.parse(existing.body);if(existing.kind==='palette-analysis'&&existing.namespace===namespace&&value.sourceId===file.id&&value.reportId)return Response.json({analysis:{id:existing.id,title:existing.title,...value},reportId:value.reportId,sourceId:file.id});}catch(error){if(error.status!==404)throw error;}
      const result=await headless(bytes,{limit:Number(input.colors??32)}),title=file.title.replace(/\.[^.]+$/,'')+' palette';
      const response=await handle(new Request('https://app.invalid/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:identity,title,sourceId:file.id,...result,workflow:input.__inkWorkflow||null})}),{ink,namespace});
      const saved=await response.json();if(!response.ok)return Response.json(saved,{status:response.status});return Response.json({...saved,reportId:saved.analysis.reportId,sourceId:file.id});
    }
    if(path==='/workflow/css'&&request.method==='POST'){
      const input=await request.json();if(!ID.test(input.analysis||''))throw fail('Choose a palette analysis');const record=await ink.data.get(input.analysis);
      if(record.kind!=='palette-analysis'||record.namespace!==namespace||record.archived)throw fail('Analysis unavailable',404);const value=JSON.parse(record.body);
      if(value.cssFileId){try{const existing=await ink.data.get(value.cssFileId);if(!existing.archived)return Response.json({fileId:existing.id,analysisId:record.id});}catch{}}
      const colors=palette(value.palette),css=':root {\n'+colors.map((color,i)=>'  --palette-'+(i+1)+': #'+color.map(n=>n.toString(16).padStart(2,'0')).join('')+';').join('\n')+'\n}\n';
      const file=await ink.assets.put(Buffer.from(css),{mime:'text/css',title:record.title+' — palette.css'});await ink.data.update(file.id,{source:record.id,tags:['palette-analysis','css'],body:JSON.stringify({mime:'text/css',bytes:Buffer.byteLength(css),analysisId:record.id,sourceImageId:value.sourceId})},file.revision);
      await ink.data.update(record.id,{body:JSON.stringify({...value,cssFileId:file.id})},record.revision);return Response.json({fileId:file.id,analysisId:record.id});
    }
    if(path==='/health')return Response.json({ok:true,engine:'DawnBringer V2.21',localAnalysis:true});
    const image=path.match(/^\/image\/([a-f0-9]{32})$/);
    if(image&&request.method==='GET'){
      const file=await ink.data.get(image[1]);if(file.kind!=='file'||file.archived)throw fail('Image not found',404);
      let info;try{info=JSON.parse(file.body);}catch{info={};}
      const mime=info.mime||'application/octet-stream';if(!/^image\/(png|jpeg|webp|gif|bmp|x-ms-bmp)$/.test(mime))throw fail('Open a PNG, JPEG, WebP, GIF or BMP image');
      const bytes=await ink.assets.get(file.id);if(bytes.length>24*1024*1024)throw fail('Use an image below 24 MiB');
      return Response.json({id:file.id,title:file.title,mime,analysisId:info.analysisId||null,dataURL:`data:${mime};base64,`+Buffer.from(bytes).toString('base64')});
    }
    if(path==='/analyses'&&request.method==='GET'){
      const rows=await ink.data.list({kind:'palette-analysis',namespace});return Response.json({analyses:rows.filter(r=>!r.archived).map(r=>({id:r.id,title:r.title,...JSON.parse(r.body)})).sort((a,b)=>b.createdAt-a.createdAt)});
    }
    const saved=path.match(/^\/analyses\/([a-f0-9]{32})$/);
    if(saved&&request.method==='GET'){const record=await ink.data.get(saved[1]);if(record.kind!=='palette-analysis'||record.archived)throw fail('Analysis not found',404);return Response.json({id:record.id,title:record.title,...JSON.parse(record.body)});}
    if(path==='/save'&&request.method==='POST'){
      const input=await request.json();if(!ID.test(input.id||''))throw fail('Missing report identity');palette(input.palette);
      const bytes=png(input.report);if(input.sourceId&&!ID.test(input.sourceId))throw fail('Invalid source image');
      if(input.sourceId){const source=await ink.data.get(input.sourceId);if(source.kind!=='file')throw fail('Source is not an image file');}
      if(!operations.has(input.id)){
        const operation=(async()=>{
          const title=String(input.title||'Palette analysis').slice(0,140);
          const fingerprint=createHash('sha256').update(JSON.stringify([title,input.sourceId||null,input.palette,input.options,input.layout,input.extraction||null])).update(bytes).digest('hex');
          let record,value;
          try{
            record=await ink.data.get(input.id);
            if(record.kind!=='palette-analysis'||record.namespace!==namespace)throw fail('Report identity belongs to another record',409);
            value=JSON.parse(record.body);
            if(value.fingerprint!==fingerprint)throw fail('This report identity belongs to a different analysis',409);
            if(value.reportId)return{id:record.id,title:record.title,...value};
          }catch(error){if(error.status!==404)throw error;}
          if(!record){
            value={sourceId:input.sourceId||null,palette:input.palette,extraction:input.extraction||null,options:input.options,layout:input.layout,engine:'DawnBringer Analyze Palette V2.21',createdAt:Date.now(),reportId:null,fingerprint,...(input.workflow?{workflow:input.workflow}:{})};
            record=await ink.data.create({id:input.id,kind:'palette-analysis',title,tags:['palette-analysis'],status:'saving',body:JSON.stringify(value)});
          }
          const report=await ink.assets.put(bytes,{mime:'image/png',title:title+' — analysis.png'});
          await ink.data.update(report.id,{source:input.id,tags:['palette-analysis','report'],body:JSON.stringify({mime:'image/png',bytes:bytes.length,analysisId:input.id,sourceImageId:value.sourceId})},report.revision);
          value.reportId=report.id;await ink.data.update(record.id,{body:JSON.stringify(value),status:'saved'},record.revision);
          return{id:record.id,title,...value};
        })();operations.set(input.id,operation);operation.finally(()=>operations.delete(input.id)).catch(()=>{});
      }
      return Response.json({analysis:await operations.get(input.id)});
    }
    throw fail('Not found',404);
  }catch(error){return Response.json({error:error.message||'Could not save analysis'},{status:error.status||500});}
};}
export const fetch=createService();
