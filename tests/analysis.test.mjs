import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {brightness,saturation,extractPalette,DB32,REGIONS,validateOptions,pngPalette} from '../web/analysis.mjs';
import {renderOriginal,SOURCE_PATHS} from '../web/runner.mjs';
const {LuaFactory}=createRequire(import.meta.url)('../web/vendor/wasmoon/index.js');
const sources=await Promise.all(SOURCE_PATHS.map(path=>readFile(new URL('../web/'+path,import.meta.url),'utf8')));
const wasmURI=resolve('web/vendor/wasmoon/glue.wasm');

test('palette extraction preserves exact pixel colours and ignores transparent RGB',()=>{
 const pixels=Uint8ClampedArray.from([255,0,0,255,0,255,0,255,255,0,0,128,0,0,255,0]);
 const result=extractPalette(pixels,16);assert.deepEqual(result.palette,[[255,0,0],[0,255,0]]);assert.equal(result.uniqueColors,2);assert.equal(result.quantized,false);assert.equal(result.visiblePixels,3);assert.ok(Math.abs(result.counts[0]-(1+128/255))<1e-12);
 assert.throws(()=>extractPalette(new Uint8ClampedArray(4),16),/visible pixels/);
});
test('photographic palettes reduce deterministically to the requested bound',()=>{
 const pixels=Uint8ClampedArray.from(Array.from({length:1000},(_,i)=>[i%256,i*17%256,i*31%256,255]).flat());
 const a=extractPalette(pixels,16),b=extractPalette(pixels,16);assert.deepEqual(a,b);assert.ok(a.palette.length<=16);assert.equal(a.quantized,true);assert.ok(a.palette.every(rgb=>rgb.every(n=>Number.isInteger(n)&&n>=0&&n<=255)));
});
test('brightness and selectable saturation measures match the unmodified Lua library',async()=>{
 const lua=await new LuaFactory(wasmURI).createEngine({enableProxy:false});
 try{
  await lua.doString(sources[1]);
  const colors=[[0,0,0],[255,255,255],[255,0,0],[127,0,255],[55,97,141],...DB32];
  const entries=colors.map(rgb=>{const args=rgb.join(',');return `{db.getBrightness(${args}),db.getPurity(${args}),db.getSaturationHSV(${args}),db.getSaturationHSL(${args})}`;});
  const values=await lua.doString('return {'+entries.join(',')+'}');
  colors.forEach((rgb,index)=>{assert.ok(Math.abs(values[index][0]-brightness(rgb))<1e-10);['purity','hsv','hsl'].forEach((mode,j)=>assert.ok(Math.abs(values[index][j+1]-saturation(rgb,mode))<1e-10,`${mode}: ${rgb}`));});
 }finally{lua.global.close();}
});
test('original renderer draws the complete chart sheet for 2, 16, 32 and 256 colours',async()=>{
 const runs=[];
 for(const palette of [[[0,0,0],[255,255,255]],DB32.slice(0,16),DB32,Array.from({length:256},(_,i)=>[i,i*73%256,i*151%256])]){
  const start=Date.now();const report=await renderOriginal({LuaFactory,wasmURI,sources,palette});
  assert.equal(report.width,640);assert.equal(report.height,432);assert.equal(report.indices.length,640*432);
  const valid=new Set(palette.map(c=>c.join(',')));for(let i=0;i<report.rgba.length;i+=4)assert.ok(valid.has(Array.from(report.rgba.subarray(i,i+3)).join(',')));
  for(const region of REGIONS.slice(1)){const [x,y,w,h]=region.box;assert.ok(x>=0&&y>=0&&x+w<=640&&y+h<=432,region.name);}
  runs.push({colors:palette.length,width:report.width,height:report.height,sha256:createHash('sha256').update(report.rgba).digest('hex'),elapsedMs:Date.now()-start});
 }
 await mkdir('.local',{recursive:true});await writeFile('.local/renderer-check.json',JSON.stringify({observedAt:new Date().toISOString(),engine:'Unmodified DBToolbox V2.21 source',runs},null,2)+'\n');
});
test('settings reject invalid numerical ranges',()=>{assert.throws(()=>validateOptions({saturations:[255,-1,32]}),/Saturation/);assert.throws(()=>validateOptions({closeLow:101}),/Brightness/);assert.throws(()=>validateOptions({saturation:'made-up'}),/Unknown/);});

test('indexed PNG order is preserved without adding unused padded colours',()=>{
 const pixels=Uint8ClampedArray.from([255,255,255,255,0,0,0,255]);
 const result=extractPalette(pixels,16,[[0,0,0],[255,255,255],[0,0,0],[255,0,0]]);
 assert.deepEqual(result.palette,[[0,0,0],[255,255,255]]);assert.equal(result.palette.length,2);
 const bytes=Buffer.alloc(8+12+6);Buffer.from('89504e470d0a1a0a','hex').copy(bytes);bytes.writeUInt32BE(6,8);bytes.write('PLTE',12);Buffer.from([0,0,0,255,255,255]).copy(bytes,16);
 assert.deepEqual(pngPalette(bytes),[[0,0,0],[255,255,255]]);
 assert.equal(pngPalette(new Uint8Array(10)),null);
});
