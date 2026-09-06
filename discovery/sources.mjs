import crypto from 'node:crypto';

function clean(value, max = 4000) { return String(value ?? '').trim().slice(0, max); }

export function createRawCandidate(input = {}, source = {}) {
  const text = clean(input.text || input.description || input.title);
  if (!text) throw new Error('Candidate text is required');
  const sourceUrl = clean(input.url || source.url, 1000) || null;
  return {
    id: input.id || `candidate_${crypto.randomUUID()}`,
    sourceId: clean(source.id || input.sourceId, 100),
    provider: clean(source.provider || input.provider || 'public_web', 80),
    externalId: clean(input.externalId, 200) || null,
    sourceUrl,
    title: clean(input.title, 300) || null,
    rawText: text,
    publishedAt: input.publishedAt || null,
    discoveredAt: input.discoveredAt || new Date().toISOString(),
    sourceLocation: clean(input.location, 200) || null,
    metadata: { ...(input.metadata && typeof input.metadata === 'object' ? input.metadata : {}), lat:Number.isFinite(Number(input.lat))?Number(input.lat):null, lng:Number.isFinite(Number(input.lng))?Number(input.lng):null },
  };
}

export class DiscoveryConnector {
  constructor({ id, provider, url = null, publicAccess = true } = {}) {
    if (!id) throw new Error('Connector id is required');
    this.id = clean(id, 100); this.provider = clean(provider || id, 80); this.url = url;
    this.publicAccess = publicAccess === true;
  }
  describe() { return { id:this.id, provider:this.provider, url:this.url, publicAccess:this.publicAccess }; }
  async discover() { throw new Error('Connector must implement discover()'); }
}

export class StaticPublicConnector extends DiscoveryConnector {
  constructor(config = {}, candidates = []) { super(config); this.candidates = candidates; }
  async discover() {
    if (!this.publicAccess) throw new Error('Only publicly accessible sources are allowed');
    return this.candidates.map(candidate => createRawCandidate(candidate, this));
  }
}

export class PublicJsonFeedConnector extends DiscoveryConnector {
  constructor(config = {}, { fetchImpl = fetch } = {}) { super(config); this.fetchImpl = fetchImpl; }
  async discover() {
    if (!this.publicAccess) throw new Error('Only publicly accessible sources are allowed');
    const url = new URL(this.url);
    if (url.protocol !== 'https:') throw new Error('Public feed connector requires HTTPS');
    if (url.username || url.password) throw new Error('Authenticated feed URLs are not allowed');
    const response = await this.fetchImpl(url, { headers:{ Accept:'application/json', 'User-Agent':'NeighborTask-Discovery/1.0' }, signal:AbortSignal.timeout(8000), redirect:'error' });
    if (!response.ok) throw new Error(`Public feed returned ${response.status}`);
    if (!String(response.headers.get('content-type') || '').includes('json')) throw new Error('Public feed must return JSON');
    const payload = await response.json();
    const items = Array.isArray(payload) ? payload : payload.items;
    if (!Array.isArray(items)) throw new Error('Public feed must contain an items array');
    return items.slice(0, 100).map(candidate => createRawCandidate(candidate, this));
  }
}
