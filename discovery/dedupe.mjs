import crypto from 'node:crypto';

function normalize(value) { return String(value ?? '').toLowerCase().replace(/https?:\/\/\S+/g,' ').replace(/[^a-z0-9$]+/g,' ').trim().replace(/\s+/g,' '); }
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
export function candidateDedupeKey(candidate) {
  if (candidate.externalId) return `external:${normalize(candidate.provider)}:${normalize(candidate.externalId)}`;
  if (candidate.sourceUrl) return `url:${hash(normalize(candidate.sourceUrl))}`;
  return `text:${hash(normalize(`${candidate.title || ''} ${candidate.rawText}`))}`;
}
export function contentFingerprint(candidate) { return hash(normalize(`${candidate.title || ''} ${candidate.rawText}`)); }
function tokens(value) { return new Set(normalize(value).split(' ').filter(x=>x.length>2)); }
export function contentSimilarity(a,b) {
  const left=tokens(`${a.title||''} ${a.rawText||a.description||''}`), right=tokens(`${b.title||''} ${b.rawText||b.description||''}`);
  if (!left.size || !right.size) return 0; let common=0; for(const token of left) if(right.has(token)) common++;
  return common/(left.size+right.size-common);
}
