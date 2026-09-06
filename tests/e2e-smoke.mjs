import assert from 'node:assert/strict'; import fs from 'node:fs/promises'; import os from 'node:os'; import path from 'node:path'; import { spawn } from 'node:child_process';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'nt-smoke-')); const appPort=3310, workflowPort=3311;
const child=spawn(process.execPath,['app-server.mjs'],{cwd:process.cwd(),env:{...process.env,PORT:String(appPort),WORKFLOW_PORT:String(workflowPort),NEIGHBORTASK_DATA_FILE:path.join(dir,'db.json'),SEED_DEMO:'true'},stdio:['ignore','pipe','pipe']});
let logs=''; child.stdout.on('data',x=>logs+=x); child.stderr.on('data',x=>logs+=x);
async function request(route,options={}){const response=await fetch(`http://127.0.0.1:${appPort}${route}`,options);const data=await response.json();return {status:response.status,data};}
async function wait(){for(let i=0;i<60;i++){try{const r=await request('/api/app-health');if(r.status===200)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw new Error(`App did not start\n${logs}`);}
try{
  await wait(); const health=await request('/api/app-health'); assert.equal(health.data.ok,true);
  const ingest=await request('/api/discovery/ingest',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({publicAccess:true,sourceId:'smoke-board',provider:'Public community board',sourceUrl:'https://example.org/public',candidates:[{externalId:'smoke-1',text:'I need someone to mow my yard tomorrow in Naperville. Call 630-555-1212. Paying $30.',location:'Naperville',lat:41.75,lng:-88.15},{externalId:'smoke-2',text:'Can anyone recommend a lawn company in Naperville?'}]})});
  assert.equal(ingest.status,200); assert.deepEqual(ingest.data.run,{...ingest.data.run,discovered:2,accepted:1,rejected:1,duplicates:0}); const accepted=ingest.data.results.find(x=>x.accepted); assert.equal(accepted.need.status,'unclaimed'); assert.doesNotMatch(accepted.need.description,/555-1212/); const id=accepted.need.id;
  const feed=await request('/api/needs?lat=41.751&lng=-88.15'); const listed=feed.data.needs.find(x=>x.id===id); assert.ok(listed); assert.ok(listed.distanceMiles<1); assert.equal(listed.matchable,false);
  const before=await request(`/api/needs/${id}/matches`); assert.equal(before.data.matches.length,0);
  const denied=await request(`/api/needs/${id}/claim`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'}); assert.equal(denied.status,400);
  const claimed=await request(`/api/needs/${id}/claim`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({explicitConfirmation:true,claimMethod:'signed_link'})}); assert.equal(claimed.data.need.status,'open');
  const after=await request(`/api/needs/${id}/matches`); assert.ok(after.data.matches.length>0); assert.equal(after.data.matches[0].helper.verified,true);
  console.log('E2E smoke: 10/10 checks passed');
} finally { child.kill('SIGTERM'); await new Promise(resolve=>{child.once('exit',resolve);setTimeout(resolve,1500).unref();}); await fs.rm(dir,{recursive:true,force:true}); }
