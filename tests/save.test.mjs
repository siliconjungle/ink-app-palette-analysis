import test from 'node:test';import assert from 'node:assert/strict';import{saveAnalysis}from'../web/save.mjs';
test('an interrupted response recovers the committed report without a second write',async()=>{
 const calls=[];const result=await saveAnalysis(async(path,body)=>{calls.push({path,body});if(path==='/save')throw Error('Timeout');return{id:'study',reportId:'image'};},{id:'study'});
 assert.equal(result.reportId,'image');assert.deepEqual(calls.map(c=>c.path),['/save','/analyses/study']);assert.equal(calls.filter(c=>c.body).length,1);
});
test('a partially saved report preserves the original error and durable identity for explicit resume',async()=>{
 const original=Error('Timeout');await assert.rejects(saveAnalysis(async path=>{if(path==='/save')throw original;return{id:'study',reportId:null};},{id:'study'}),error=>error===original);
});
test('a successful save uses the returned report directly',async()=>{let calls=0;const result=await saveAnalysis(async()=>{calls++;return{analysis:{id:'study',reportId:'image'}};},{id:'study'});assert.equal(result.reportId,'image');assert.equal(calls,1);});
