import crypto from 'node:crypto';

export const NEED_ORIGINS = ['external', 'native', 'partner'];
export const NEED_STATUSES = ['unclaimed', 'claimed', 'verified', 'open', 'matched', 'completed', 'expired', 'rejected'];
export const HELP_TYPES = ['volunteer', 'paid', 'either'];
export const CATEGORIES = ['yard','moving','cleaning','assembly','home_repair','pickup_delivery','pet','tech','elder_support','snow','other'];

const transitions = {
  unclaimed: new Set(['claimed','rejected','expired']),
  claimed: new Set(['verified','rejected','expired']),
  verified: new Set(['open','rejected','expired']),
  open: new Set(['matched','completed','expired','rejected']),
  matched: new Set(['open','completed','expired']),
  completed: new Set(), expired: new Set(), rejected: new Set(),
};

export function canTransition(from, to) { return Boolean(transitions[from]?.has(to)); }
export function transitionNeed(need, to, now = new Date().toISOString()) {
  if (!canTransition(need.status, to)) throw new Error(`Invalid need transition: ${need.status} -> ${to}`);
  return { ...need, status: to, updatedAt: now };
}

function s(v, n=500) { return String(v ?? '').trim().slice(0,n); }
function enumValue(v, allowed, fallback) { return allowed.includes(v) ? v : fallback; }
function finite(v, fallback=null) { const n=Number(v); return Number.isFinite(n) ? n : fallback; }

export function createNeed(input = {}) {
  const now = new Date().toISOString();
  const origin = enumValue(input.origin, NEED_ORIGINS, 'native');
  const status = origin === 'external' ? 'unclaimed' : 'verified';
  const lat = finite(input.location?.lat); const lng = finite(input.location?.lng);
  return {
    id: input.id || `need_${crypto.randomUUID()}`,
    origin,
    source: { provider: s(input.source?.provider || (origin === 'native' ? 'neighbortask' : 'public_web'),80), url: s(input.source?.url,500) || null, externalId: s(input.source?.externalId,160) || null },
    category: enumValue(input.category, CATEGORIES, 'other'),
    title: s(input.title,120) || 'Local help requested',
    description: s(input.description,2000),
    helpType: enumValue(input.helpType, HELP_TYPES, 'either'),
    compensation: input.compensation == null ? null : { amount: Math.max(0, finite(input.compensation.amount,0)), currency: s(input.compensation.currency || 'USD',8), unit: s(input.compensation.unit || 'total',20) },
    location: { label: s(input.location?.label,120), lat, lng, precision: enumValue(input.location?.precision,['city','neighborhood','approximate','exact'],'approximate') },
    time: { start: input.time?.start || null, end: input.time?.end || null, flexible: Boolean(input.time?.flexible) },
    urgency: enumValue(input.urgency,['low','normal','high','urgent'],'normal'),
    confidence: Math.min(1, Math.max(0, finite(input.confidence, origin === 'external' ? 0.5 : 1))),
    status,
    privacy: { exactAddressVisible: false, contactVisible: false, piiRedacted: input.privacy?.piiRedacted !== false },
    requester: { userId: input.requester?.userId || null, claimVerifiedAt: input.requester?.claimVerifiedAt || null },
    discovery: input.discovery ? { candidateId:s(input.discovery.candidateId,160)||null, classification:s(input.discovery.classification,80)||null, evidence:(input.discovery.evidence||[]).map(x=>s(x,160)).slice(0,10), contentFingerprint:s(input.discovery.contentFingerprint,128)||null } : null,
    dedupeKey: s(input.dedupeKey,240) || null,
    createdAt: input.createdAt || now,
    updatedAt: now,
    expiresAt: input.expiresAt || null,
  };
}

export function createHelperProfile(input = {}) {
  const now = new Date().toISOString();
  return {
    id: input.id || `helper_${crypto.randomUUID()}`,
    displayName: s(input.displayName,80) || 'Neighbor',
    home: { lat: finite(input.home?.lat), lng: finite(input.home?.lng), label: s(input.home?.label,120) },
    radiusMiles: Math.min(50, Math.max(0.25, finite(input.radiusMiles,3))),
    categories: [...new Set((input.categories || []).filter(x => CATEGORIES.includes(x)))],
    helpTypes: [...new Set((input.helpTypes || ['either']).filter(x => HELP_TYPES.includes(x)))],
    availability: (input.availability || []).map(x => ({ start: x.start || null, end: x.end || null })).slice(0,20),
    minimumHourly: Math.max(0, finite(input.minimumHourly,0)),
    reliability: Math.min(1, Math.max(0, finite(input.reliability,0.8))),
    verified: Boolean(input.verified),
    active: input.active !== false,
    createdAt: input.createdAt || now,
    updatedAt: now,
  };
}


export function publicNeedView(need) {
  return {
    id: need.id,
    origin: need.origin,
    category: need.category,
    title: need.title,
    description: need.description,
    helpType: need.helpType,
    compensation: need.compensation,
    location: { label: need.location.label, precision: need.location.precision === 'exact' ? 'approximate' : need.location.precision },
    time: need.time,
    urgency: need.urgency,
    confidence: need.confidence,
    status: need.status,
    source: { provider: need.source.provider, url: need.source.url },
    createdAt: need.createdAt,
    expiresAt: need.expiresAt,
  };
}
