// Reproduce a native-size report with the same vendored engine used by the app.
import {readFile,writeFile,mkdir} from 'node:fs/promises';import {resolve,dirname} from 'node:path';import {createRequire} from 'node:module';import {deflateSync} from 'node:zlib';
import {renderOriginal,SOURCE_PATHS} from '../web/runner.mjs';import {DB32,PICO8} from '../web/analysis.mjs';
const args=process.argv.slice(2),get=(key,fallback)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1];};
const paletteInput=get('--palette','db32'),palette=paletteInput==='db32'?DB32:paletteInput==='pico8'?PICO8:JSON.parse(await readFile(paletteInput,'utf8'));
const {LuaFactory}=createRequire(import.meta.url)('../web/vendor/wasmoon/index.js');
const sources=await Promise.all(SOURCE_PATHS.map(path=>readFile(new URL('../web/'+path,import.meta.url),'utf8')));
const report=await renderOriginal({LuaFactory,wasmURI:resolve('web/vendor/wasmoon/glue.wasm'),sources,palette,options:{saturation:get('--mode','purity')}});
function crc32(bytes){let c=0xffffffff;for(const byte of bytes){c^=byte;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;}return(c^0xffffffff)>>>0;}
function chunk(type,bytes){const name=Buffer.from(type),out=Buffer.alloc(12+bytes.length);out.writeUInt32BE(bytes.length);name.copy(out,4);bytes.copy(out,8);out.writeUInt32BE(crc32(Buffer.concat([name,bytes])),bytes.length+8);return out;}
const header=Buffer.alloc(13);header.writeUInt32BE(report.width);header.writeUInt32BE(report.height,4);header[8]=8;header[9]=6;
const rows=Buffer.alloc((report.width*4+1)*report.height);for(let y=0;y<report.height;y++)Buffer.from(report.rgba.subarray(y*report.width*4,(y+1)*report.width*4)).copy(rows,y*(report.width*4+1)+1);
const png=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
const output=resolve(get('--output','.local/report.png'));await mkdir(dirname(output),{recursive:true});await writeFile(output,png,{flag:args.includes('--force')?'w':'wx'});console.log(JSON.stringify({output,width:report.width,height:report.height,colours:palette.length,engine:report.engine}));
