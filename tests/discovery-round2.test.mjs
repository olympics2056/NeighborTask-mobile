import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs/promises'; import os from 'node:os'; import path from 'node:path';
import { redactPii } from '../discovery/privacy.mjs'; import { candidateDedupeKey, contentSimilarity } from '../discovery/dedupe.mjs';
import { createRawCandidate } from '../discovery/sources.mjs'; import { DiscoveryEngine } from '../discovery/engine.mjs'; import { JsonStore } from '../domain/store.mjs';
async function setup(){ const dir=await fs.mkdtemp(path.join(os.tmpdir(),'nt-discovery-')); return new JsonStore(path.join(dir,'db.json')); }

test('Draft 2: PII is redacted before persistence', async()=>{
  const store=await setup(); const engine=new DiscoveryEngine({store}); const candidate=createRawCandidate({text:'I need someone to move a couch tomorrow. Call (630) 555-1212 or me@example.com. Meet at 123 Main Street.',location:'Naperville'},{id:'board',provider:'board'});
  const result=await engine.process(candidate); assert.equal(result.accepted,true); const saved=(await store.listRawCandidates())[0]; assert.doesNotMatch(saved.rawText,/555-1212|me@example|123 Main/i); assert.deepEqual(saved.metadata.piiTypes.sort(),['email','phone','street_address']); assert.doesNotMatch(result.need.description,/555-1212|me@example|123 Main/i);
});
test('Draft 2: stable source identifiers deduplicate repeated candidates', async()=>{
  const store=await setup(); const engine=new DiscoveryEngine({store}); const input={externalId:'post-7',text:'I need someone to clean my garage tomorrow.',location:'Naperville'}; const source={id:'board',provider:'Board'};
  const first=await engine.process(createRawCandidate(input,source)); const second=await engine.process(createRawCandidate({...input,text:'I need someone to clean my garage tomorrow please.'},source)); assert.equal(first.accepted,true); assert.equal(second.accepted,false); assert.equal(second.reason,'duplicate'); assert.equal((await store.listNeeds()).length,1);
});
test('Draft 2: near-identical cross-source content is deduplicated', async()=>{
  const store=await setup(); const engine=new DiscoveryEngine({store,similarityThreshold:.75}); await engine.process(createRawCandidate({text:'I need someone to help move my large sofa this weekend in Naperville.'},{id:'one',provider:'one'}));
  const again=await engine.process(createRawCandidate({text:'Need someone to help move my large sofa this weekend in Naperville!'},{id:'two',provider:'two'})); assert.equal(again.reason,'duplicate');
});
test('Draft 2: recommendation is retained for audit but never persisted as a need', async()=>{
  const store=await setup(); const engine=new DiscoveryEngine({store}); const result=await engine.process(createRawCandidate({text:'Can anyone recommend a good lawn company in Naperville?'},{id:'board',provider:'board'}));
  assert.equal(result.accepted,false); assert.equal(result.reason,'recommendation'); assert.equal((await store.listNeeds()).length,0); assert.equal((await store.listRawCandidates()).length,1);
});
test('Draft 2: dedupe utilities produce stable keys and similarity',()=>{ const a={provider:'X',externalId:'ABC',rawText:'Need help moving today'}; assert.equal(candidateDedupeKey(a),candidateDedupeKey({...a,rawText:'changed'})); assert.ok(contentSimilarity(a,{rawText:'I need help moving today'})>.5); assert.equal(redactPii('email a@b.com').redacted,true); });
