import {startPreview} from './quick-look.mjs';

await startPreview({render:({ink,file,root})=>{
 const meta=JSON.parse(file.body),report=file.kind==='palette-analysis'?meta.reportId:file.id;
 if(report){const image=document.createElement('img');image.src=ink.files.url(report);image.alt=file.title;root.append(image);return()=>image.removeAttribute('src');}
 const title=document.createElement('h2');title.textContent=file.title;root.append(title);
 for(const color of meta.palette||[]){const swatch=document.createElement('span');swatch.style.cssText=`display:inline-block;width:36px;height:36px;background:rgb(${color.join(',')})`;swatch.title='#'+color.map(value=>value.toString(16).padStart(2,'0')).join('');root.append(swatch);}
}});
