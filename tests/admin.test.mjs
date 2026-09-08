import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createAdmin,passwordHash} from '../admin.mjs';
import {JsonStore} from '../domain/store.mjs';

async function fixture(t,options={}){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'nt-admin-test-'));
  const store=new JsonStore(path.join(dir,'db.json'));await store.init();
  const hash=await passwordHash('test-only-password-123');
  let clock=0;
  const handler=createAdmin({store,username:'admin',hash,secure:true,now:()=>clock,
    json:(res,status,data)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));},
    readJson:async req=>{let raw='';for await(const chunk of req)raw+=chunk;return JSON.parse(raw||'{}');},...options});
  const server=http.createServer(async(req,res)=>{try{await handler(req,res,new URL(req.url,'http://localhost'));}catch{res.writeHead(500);res.end('{}');}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(dir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;
  async function call(route,body,headers={}){const r=await fetch(base+'/api/admin/'+route,{method:body?'POST':'GET',headers:{'content-type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json(),headers:r.headers};}
  async function login(){const r=await call('login',{username:'admin',password:'test-only-password-123'});assert.equal(r.status,200);return {cookie:r.headers.get('set-cookie').split(';')[0],'x-csrf-token':r.data.csrf};}
  return {store,call,login,advance:ms=>clock+=ms,dir};
}

test('admin authentication, cookie protections, CSRF, origin, logout and expiry',async t=>{
  const f=await fixture(t);
  assert.equal((await f.call('dashboard')).status,401);
  assert.equal((await f.call('dashboard',null,{cookie:'nt_admin=forged'})).status,401);
  assert.equal((await f.call('login',{username:'admin',password:'wrong'})).status,401);
  assert.equal((await f.call('login',{username:'admin',password:'test-only-password-123'},{origin:'https://attacker.invalid'})).status,403);
  const r=await f.call('login',{username:'admin',password:'test-only-password-123'});
  assert.match(r.headers.get('set-cookie'),/HttpOnly; SameSite=Strict; Max-Age=3600; Secure/);
  const headers={cookie:r.headers.get('set-cookie').split(';')[0],'x-csrf-token':r.data.csrf};
  assert.equal((await f.call('dashboard',null,headers)).headers.get('cache-control'),'no-store');
  assert.equal((await f.call('logout',{}, {cookie:headers.cookie})).status,403);
  assert.equal((await f.call('logout',{}, {...headers,origin:'https://attacker.invalid'})).status,403);
  assert.equal((await f.call('logout',{},headers)).status,200);
  assert.equal((await f.call('session',null,headers)).status,401);
  const next=await f.login();f.advance(3600000);
  assert.equal((await f.call('session',null,next)).status,401);
});

test('admin login is disabled without configuration and rate-limited',async t=>{
  const disabled=await fixture(t,{hash:''});assert.equal((await disabled.call('login',{})).status,503);
  const f=await fixture(t);
  for(let i=0;i<5;i++)assert.equal((await f.call('login',{username:'admin',password:'bad'})).status,401);
  assert.equal((await f.call('login',{username:'admin',password:'test-only-password-123'})).status,429);
  f.advance(900000);await f.login();
});

test('admin moderation gates matching, preserves external state, and persists audit',async t=>{
  const f=await fixture(t);const headers=await f.login();
  const h=await f.store.addHelper({displayName:'Test Helper',categories:['yard'],home:{lat:41.75,lng:-88.15},verified:false});
  const {need}=await f.store.addNeed({title:'Yard help',category:'yard',location:{lat:41.75,lng:-88.15}});
  await f.store.transitionNeed(need.id,'open');
  assert.equal((await f.store.matches(need.id)).length,0);
  assert.equal((await f.call(`helpers/${h.id}`,{action:'approve',reason:''},headers)).status,400);
  assert.equal((await f.call(`helpers/${h.id}`,{action:'approve',reason:'Manual review'},headers)).status,200);
  assert.equal((await f.store.matches(need.id)).length,1);
  assert.equal((await f.call(`helpers/${h.id}`,{action:'suspend',reason:'Review complaint'},headers)).status,200);
  assert.equal((await f.store.matches(need.id)).length,0);
  await f.call(`helpers/${h.id}`,{action:'revoke',reason:'Not approved'},headers);
  assert.equal((await f.store.listHelpers())[0].active,false);
  const external=(await f.store.addNeed({origin:'external',title:'External'})).need;
  assert.equal((await f.call(`needs/${external.id}`,{action:'open',reason:'Cannot bypass claim'},headers)).status,400);
  assert.equal((await f.store.getNeed(external.id)).status,'unclaimed');
  assert.equal((await f.call(`needs/${external.id}`,{action:'reject',reason:'Not suitable'},headers)).status,200);
  assert.equal((await f.call(`needs/${need.id}`,{action:'expire',reason:'No longer needed'},headers)).status,200);
  const reloaded=new JsonStore(f.store.file);await reloaded.init();assert.equal(reloaded.state.adminAudit.length,5);
  const dashboard=await f.call('dashboard',null,headers);assert.equal(dashboard.data.audit.length,5);
  assert.equal('requester' in dashboard.data.needs[0],false);
});

test('corrupt storage is not overwritten; failed moderation rolls back and can retry',async t=>{
  const f=await fixture(t);const h=await f.store.addHelper({displayName:'Test'});
  const save=f.store.save.bind(f.store);f.store.save=async()=>{throw Error('disk failure');};
  await assert.rejects(f.store.adminAction('helpers',h.id,'approve','review','admin'),/disk failure/);
  assert.equal(f.store.state.helpers[0].verified,false);assert.equal(f.store.state.adminAudit.length,0);
  f.store.save=save;await f.store.adminAction('helpers',h.id,'approve','retry','admin');
  const corrupt=path.join(f.dir,'corrupt.json');await fs.writeFile(corrupt,'broken JSON');
  await assert.rejects(new JsonStore(corrupt).init());assert.equal(await fs.readFile(corrupt,'utf8'),'broken JSON');
});
