const RULES = [
  ['email', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email removed]'],
  ['phone', /(?<!\d)(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g, '[phone removed]'],
  ['street_address', /\b\d{1,6}\s+(?:[NSEW]\.?\s+)?[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,4}\s+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Court|Ct|Boulevard|Blvd|Way|Place|Pl)\b\.?/gi, '[exact address removed]'],
  ['social_handle', /(^|\s)@[A-Za-z0-9_]{2,30}\b/g, '$1[handle removed]'],
];

export function redactPii(value) {
  let text=String(value ?? ''); const types=[];
  for (const [type, pattern, replacement] of RULES) {
    pattern.lastIndex=0; if (pattern.test(text)) types.push(type); pattern.lastIndex=0; text=text.replace(pattern,replacement);
  }
  return { text, redacted:types.length>0, types:[...new Set(types)] };
}

export function sanitizeCandidate(candidate) {
  const body=redactPii(candidate.rawText); const title=redactPii(candidate.title || '');
  return { ...candidate, rawText:body.text, title:title.text || null, metadata:{ ...(candidate.metadata || {}), piiRedacted:body.redacted||title.redacted, piiTypes:[...new Set([...body.types,...title.types])] } };
}
