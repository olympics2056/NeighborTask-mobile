import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { JsonStore } from './domain/store.mjs';
import { publicNeedWithDistance, parseViewer } from './domain/api-utils.mjs';
import { demoNeeds, demoHelpers } from './domain/seed.mjs';
import { DiscoveryEngine } from './discovery/engine.mjs';
import { createRawCandidate, StaticPublicConnector } from './discovery/sources.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const WORKFLOW_PORT = Number(process.env.WORKFLOW_PORT || 3001);
const sessions = new Map();
const store = new JsonStore(process.env.NEIGHBORTASK_DATA_FILE || path.join(__dirname, 'data', 'neighbortask.json'));
const discovery = new DiscoveryEngine({ store });
await store.init();
if (process.env.SEED_DEMO !== 'false') await store.seed({ needs: demoNeeds, helpers: demoHelpers });

function json(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 100_000) throw new Error('Request too large');
  }
  return raw ? JSON.parse(raw) : {};
}

async function serveStatic(urlPath, res) {
  const safePath = urlPath === '/' ? '/index.html' : urlPath;
  const fullPath = path.join(__dirname, 'public', path.normalize(safePath).replace(/^([.][.][/\\])+/, ''));
  if (!fullPath.startsWith(path.join(__dirname, 'public'))) return false;
  try {
    const data = await fs.readFile(fullPath);
    const ext = path.extname(fullPath).toLowerCase();
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=3600' });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

async function waitForWorkflow() {
  for (let i = 0; i < 40; i++) {
    try {
      const headers = {};
      if (process.env.NEIGHBORTASK_API_KEY) headers['X-API-Key'] = process.env.NEIGHBORTASK_API_KEY;
      const r = await fetch(`http://127.0.0.1:${WORKFLOW_PORT}/api/health`, { headers });
      if (r.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error('Internal workflow service failed to start.');
}

const childEnv = { ...process.env, HOST: '127.0.0.1', PORT: String(WORKFLOW_PORT), ALLOWED_ORIGIN: `http://localhost:${PORT}` };
const workflow = spawn(process.execPath, [path.join(__dirname, 'workflow-server.mjs')], { env: childEnv, stdio: ['ignore', 'inherit', 'inherit'] });
workflow.on('exit', code => { if (code && code !== 0) console.error(`Workflow server exited with code ${code}`); });

await waitForWorkflow();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || `localhost:${PORT}`}`);

    if (req.method === 'GET' && url.pathname === '/api/app-health') {
      return json(res, 200, { ok: true, app: 'NeighborTask', agent: Boolean(process.env.OPENAI_API_KEY), workflow: workflow.exitCode === null, modelVersion:'v3' });
    }

    if (req.method === 'GET' && url.pathname === '/api/needs') {
      const viewer = parseViewer(url);
      const status = url.searchParams.get('status') || undefined;
      const origin = url.searchParams.get('origin') || undefined;
      const needs = await store.listNeeds({ status, origin, limit: Number(url.searchParams.get('limit') || 50) });
      const visible = needs.filter(n => ['open','unclaimed'].includes(n.status)).map(n => publicNeedWithDistance(n, viewer));
      visible.sort((a,b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || (a.distanceMiles ?? 999) - (b.distanceMiles ?? 999));
      return json(res, 200, { ok:true, needs: visible });
    }

    if (req.method === 'POST' && url.pathname === '/api/needs') {
      const body = await readJson(req);
      const result = await store.addNeed({ ...body, origin:'native' });
      const opened = await store.transitionNeed(result.need.id, 'open');
      return json(res, 201, { ok:true, need: publicNeedWithDistance(opened,{lat:null,lng:null}) });
    }

    if (req.method === 'POST' && url.pathname === '/api/discovery/import') {
      const body = await readJson(req);
      const candidate=createRawCandidate({ ...body, text:body.text||body.description||body.title },{ id:body.source?.provider||'legacy_import', provider:body.source?.provider||'public_web', url:body.source?.url, publicAccess:true });
      const result=await discovery.process(candidate);
      if(!result.accepted)return json(res,result.reason==='duplicate'?200:422,{ok:false,reason:result.reason,classification:result.classification||null,duplicateOf:result.duplicateOf||null});
      return json(res, result.duplicate ? 200 : 201, { ok:true, duplicate:result.duplicate, classification:result.classification, need:publicNeedWithDistance(result.need,{lat:null,lng:null}) });
    }

    if (req.method === 'POST' && url.pathname === '/api/discovery/ingest') {
      const body=await readJson(req); if(body.publicAccess!==true)return json(res,400,{error:'Source must be explicitly confirmed as publicly accessible'});
      if(!Array.isArray(body.candidates)||body.candidates.length<1||body.candidates.length>100)return json(res,400,{error:'candidates must contain 1 to 100 items'});
      const connector=new StaticPublicConnector({id:body.sourceId||'manual_public',provider:body.provider||'public_web',url:body.sourceUrl||null,publicAccess:true},body.candidates);
      const run=await discovery.run(connector);
      return json(res,200,{ok:true,run:{source:run.source,startedAt:run.startedAt,completedAt:run.completedAt,discovered:run.discovered,accepted:run.accepted,rejected:run.rejected,duplicates:run.duplicates},results:run.results.map(x=>({accepted:x.accepted,reason:x.reason||null,duplicate:Boolean(x.duplicate),classification:x.classification||null,need:x.need?publicNeedWithDistance(x.need,{lat:null,lng:null}):null}))});
    }

    const claimMatch = url.pathname.match(/^\/api\/needs\/([^/]+)\/claim$/);
    if (req.method === 'POST' && claimMatch) {
      const id=decodeURIComponent(claimMatch[1]); const body=await readJson(req); const current=await store.getNeed(id);
      if(!current) return json(res,404,{error:'Need not found'});
      if(body.explicitConfirmation !== true || !String(body.claimMethod||'').trim()) return json(res,400,{error:'Explicit requester confirmation and claimMethod are required'});
      if(current.origin!=='external') return json(res,400,{error:'Only external needs require claim'});
      let next=await store.transitionNeed(id,'claimed'); next=await store.transitionNeed(id,'verified'); next=await store.transitionNeed(id,'open');
      return json(res,200,{ok:true,need:publicNeedWithDistance(next,{lat:null,lng:null})});
    }

    if (req.method === 'POST' && url.pathname === '/api/helpers') {
      const body=await readJson(req); const helper=await store.addHelper({...body,verified:false});
      return json(res,201,{ok:true,helper:{id:helper.id,displayName:helper.displayName,radiusMiles:helper.radiusMiles,categories:helper.categories,helpTypes:helper.helpTypes,verified:helper.verified}});
    }

    const matchRoute = url.pathname.match(/^\/api\/needs\/([^/]+)\/matches$/);
    if (req.method === 'GET' && matchRoute) {
      const matches=await store.matches(decodeURIComponent(matchRoute[1]),5); if(matches===null)return json(res,404,{error:'Need not found'});
      return json(res,200,{ok:true,matches:matches.map(m=>({score:m.score,distanceMiles:m.distanceMiles,reasons:m.reasons,helper:{id:m.helper.id,displayName:m.helper.displayName,verified:m.helper.verified}}))});
    }

    if (req.method === 'POST' && url.pathname === '/api/chat') {
      if (!process.env.OPENAI_API_KEY) return json(res, 503, { error: 'AI assistant is not configured. Core NeighborTask features still work.' });
      const body = await readJson(req);
      const message = String(body.message || '').trim();
      if (!message) return json(res, 400, { error: 'message is required' });
      if (message.length > 8000) return json(res, 400, { error: 'message is too long' });
      const { runAgentTurn } = await import('./agent-core.mjs');
      const sessionId = String(body.sessionId || crypto.randomUUID()).slice(0, 120);
      const prior = sessions.get(sessionId)?.history || [];
      const result = await runAgentTurn(message, prior);
      sessions.set(sessionId, { history: result.history, updatedAt: Date.now() });
      return json(res, 200, { ok: true, sessionId, message: result.output });
    }

    if (req.method === 'POST' && url.pathname === '/api/new-chat') {
      const body = await readJson(req);
      if (body.sessionId) sessions.delete(String(body.sessionId));
      return json(res, 200, { ok: true, sessionId: crypto.randomUUID() });
    }

    if (req.method === 'GET' && await serveStatic(url.pathname, res)) return;
    json(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error(error);
    json(res, 500, { error: 'Something went wrong', detail: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`NeighborTask app: http://localhost:${PORT}`);
  console.log(`Internal workflow API: http://127.0.0.1:${WORKFLOW_PORT}`);
});

function shutdown() {
  server.close(() => process.exit(0));
  workflow.kill('SIGTERM');
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
