import { sanitizeCandidate } from './privacy.mjs';
import { candidateDedupeKey, contentFingerprint, contentSimilarity } from './dedupe.mjs';
import { RuleBasedNeedClassifier, extractNeedFields } from './classifier.mjs';

export class DiscoveryEngine {
  constructor({ store, classifier = new RuleBasedNeedClassifier(), minimumConfidence = .65, similarityThreshold = .88 } = {}) {
    if (!store) throw new Error('DiscoveryEngine requires a store');
    this.store=store; this.classifier=classifier; this.minimumConfidence=minimumConfidence; this.similarityThreshold=similarityThreshold;
  }
  async process(candidate) {
    const sanitized=sanitizeCandidate(candidate); const dedupeKey=candidateDedupeKey(sanitized); const fingerprint=contentFingerprint(sanitized);
    const existing=await this.store.findCandidateDuplicate({ dedupeKey, fingerprint, candidate:sanitized, similarityThreshold:this.similarityThreshold });
    if (existing) return { accepted:false, reason:'duplicate', duplicateOf:existing.needId || existing.id, candidate:existing };
    const classification=await this.classifier.classify(sanitized);
    const record=await this.store.addRawCandidate({ ...sanitized, dedupeKey, fingerprint, classification, processingStatus:classification.actionable && classification.confidence>=this.minimumConfidence ? 'accepted' : 'rejected' });
    if (!classification.actionable) return { accepted:false, reason:classification.label, candidate:record, classification };
    if (classification.confidence < this.minimumConfidence) return { accepted:false, reason:'low_confidence', candidate:record, classification };
    const fields=extractNeedFields(sanitized);
    const result=await this.store.addNeed({ ...fields, origin:'external', source:{provider:sanitized.provider,url:sanitized.sourceUrl,externalId:sanitized.externalId}, confidence:classification.confidence, dedupeKey, privacy:{piiRedacted:true}, discovery:{candidateId:record.id,classification:classification.label,evidence:classification.evidence,contentFingerprint:fingerprint} });
    await this.store.linkCandidateToNeed(record.id,result.need.id);
    return { accepted:true, duplicate:result.duplicate, candidate:record, classification, need:result.need };
  }
  async run(connector) {
    const startedAt=new Date().toISOString(); const candidates=await connector.discover(); const results=[];
    for (const candidate of candidates) results.push(await this.process(candidate));
    return { source:connector.describe(), startedAt, completedAt:new Date().toISOString(), discovered:candidates.length, accepted:results.filter(x=>x.accepted&&!x.duplicate).length, rejected:results.filter(x=>!x.accepted).length, duplicates:results.filter(x=>x.reason==='duplicate'||x.duplicate).length, results };
  }
}
