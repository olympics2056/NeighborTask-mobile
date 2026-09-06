import test from 'node:test'; import assert from 'node:assert/strict';
import { StaticPublicConnector, PublicJsonFeedConnector } from '../discovery/sources.mjs';
import { RuleBasedNeedClassifier, extractNeedFields } from '../discovery/classifier.mjs';

test('Draft 1: connector normalizes raw public candidates', async()=>{
  const connector=new StaticPublicConnector({id:'board',provider:'Community board'},[{externalId:'42',text:'I need someone to mow my lawn tomorrow in Naperville. Paying $30.'}]);
  const [candidate]=await connector.discover(); assert.equal(candidate.sourceId,'board'); assert.equal(candidate.externalId,'42'); assert.match(candidate.id,/^candidate_/);
});
test('Draft 1: recommendation is not actionable', async()=>{
  const classifier=new RuleBasedNeedClassifier(); const result=await classifier.classify({rawText:'Does anyone know a good plumber in Naperville?'});
  assert.equal(result.label,'recommendation'); assert.equal(result.actionable,false); assert.ok(result.confidence>=.8);
});
test('Draft 1: actionable request is classified and fields extracted', async()=>{
  const candidate={rawText:'I need someone to mow my lawn tomorrow in Naperville. Paying $30.'}; const result=await new RuleBasedNeedClassifier().classify(candidate); const fields=extractNeedFields(candidate);
  assert.equal(result.actionable,true); assert.equal(fields.category,'yard'); assert.equal(fields.helpType,'paid'); assert.equal(fields.compensation.amount,30); assert.equal(fields.time.label.toLowerCase(),'tomorrow'); assert.equal(fields.location.label,'Naperville');
});
test('Draft 1: feed connectors reject non-public or insecure sources', async()=>{
  await assert.rejects(()=>new StaticPublicConnector({id:'private',publicAccess:false},[{text:'Need help'}]).discover(),/publicly accessible/);
  await assert.rejects(()=>new PublicJsonFeedConnector({id:'feed',url:'http://example.com/feed'}).discover(),/HTTPS/);
});
