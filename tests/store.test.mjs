import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs/promises'; import os from 'node:os'; import path from 'node:path';
import { JsonStore } from '../domain/store.mjs';

test('store deduplicates active external needs', async()=>{ const dir=await fs.mkdtemp(path.join(os.tmpdir(),'nt-')); const store=new JsonStore(path.join(dir,'db.json')); const a=await store.addNeed({origin:'external',dedupeKey:'same',title:'A'}); const b=await store.addNeed({origin:'external',dedupeKey:'same',title:'B'}); assert.equal(a.duplicate,false); assert.equal(b.duplicate,true); assert.equal((await store.listNeeds()).length,1); });
test('store will not transition external need directly to open', async()=>{ const dir=await fs.mkdtemp(path.join(os.tmpdir(),'nt-')); const store=new JsonStore(path.join(dir,'db.json')); const {need}=await store.addNeed({origin:'external'}); await assert.rejects(()=>store.transitionNeed(need.id,'open'),/Invalid need transition/); });
