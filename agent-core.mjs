import fs from 'node:fs/promises';
import { Agent, run, tool, webSearchTool, fileSearchTool } from '@openai/agents';
import { z } from 'zod';

const API_BASE = String(process.env.NEIGHBORTASK_API_BASE_URL || `http://127.0.0.1:${process.env.WORKFLOW_PORT || 3001}`).replace(/\/$/, '');
const API_KEY = process.env.NEIGHBORTASK_API_KEY || '';
const MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-sol';
const VECTOR_STORE_ID = process.env.OPENAI_VECTOR_STORE_ID || '';

async function callApi(path, { method = 'POST', body } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (API_KEY) headers['X-API-Key'] = API_KEY;
  const response = await fetch(`${API_BASE}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
  if (!response.ok) return JSON.stringify({ ok: false, status: response.status, ...payload });
  return JSON.stringify(payload);
}

const healthTool = tool({
  name: 'get_neighbortask_health',
  description: 'Check the NeighborTask workflow API and configured source availability.',
  parameters: z.object({}),
  execute: async () => callApi('/api/health', { method: 'GET' }),
});
const searchPublicNeedsTool = tool({
  name: 'search_public_needs',
  description: 'Search configured, permitted structured public-need sources. Results are unverified leads and include source coverage.',
  parameters: z.object({
    geography: z.string().max(120), keywords: z.array(z.string().max(60)).max(10).optional(),
    sources: z.array(z.enum(['local', 'partner', 'public_feed', 'nextdoor'])).optional(),
    freshnessHours: z.number().int().min(1).max(2160).optional(), limit: z.number().int().min(1).max(50).optional(),
  }),
  execute: async (args) => callApi('/api/public-needs/search', { body: args }),
});
const importPublicLinkTool = tool({
  name: 'import_public_link',
  description: 'Import a user-submitted permitted public link as an unverified lead, then redact/classify it. Do not use for private or login-gated content.',
  parameters: z.object({
    sourceUrl: z.string().url().max(500), text: z.string().max(5000), source: z.string().max(80).optional(),
    title: z.string().max(160).optional(), category: z.string().max(80).optional(), neighborhood: z.string().max(120).optional(), publishedAt: z.string().optional(),
  }),
  execute: async (args) => callApi('/api/import/public-link', { body: args }),
});
const redactClassifyTool = tool({
  name: 'redact_and_classify', description: 'Remove common personal data from supplied text and classify a possible local-service need.',
  parameters: z.object({ text: z.string().max(5000), service: z.string().max(80).optional() }),
  execute: async (args) => callApi('/api/redact-classify', { body: args }),
});
const adminReviewTool = tool({
  name: 'submit_for_admin_review', description: 'Move an existing discovered lead into admin review. Only use after the lead has been redacted and deduplicated.',
  parameters: z.object({ leadId: z.string().min(1) }),
  execute: async ({ leadId }) => callApi(`/api/leads/${encodeURIComponent(leadId)}/review`, { body: {} }),
});
const consentTool = tool({
  name: 'update_consent_status', description: 'Record consent outreach approval or requester consent. Never claim consent received unless explicitly provided.',
  parameters: z.object({ leadId: z.string().min(1), action: z.enum(['mark_requested', 'record_received']), consentSource: z.string().max(120).optional(), explicitConfirmation: z.boolean().optional() }),
  execute: async ({ leadId, ...body }) => callApi(`/api/leads/${encodeURIComponent(leadId)}/consent`, { body }),
});
const estimateTool = tool({
  name: 'create_estimate', description: 'Create a service estimate before collecting customer contact details.',
  parameters: z.object({ service: z.string().max(80), neighborhood: z.string().max(120), date: z.string(), time: z.string().max(80), details: z.string().max(2000), size: z.string().max(120).optional(), backgroundOnly: z.boolean().optional() }),
  execute: async (args) => callApi('/api/estimate', { body: args }),
});
const confirmCustomerTool = tool({
  name: 'confirm_customer', description: 'Attach protected customer contact details to an existing estimate after the customer explicitly agrees to proceed.',
  parameters: z.object({ requestId: z.string().min(1), customerName: z.string().max(100), phone: z.string().max(30), email: z.string().email().max(200), address: z.string().max(250), city: z.string().max(100), consent: z.literal(true) }),
  execute: async (args) => callApi('/api/customer/confirm', { body: args }),
});
const createJobTicketTool = tool({
  name: 'create_job_ticket', description: 'Create a protected job ticket from a customer-confirmed request. Requires explicit user confirmation in the current conversation.',
  parameters: z.object({ requestId: z.string().min(1), explicitConfirmation: z.literal(true) }),
  execute: async (args) => callApi('/api/job-tickets', { body: args }),
});
const releaseMatchingTool = tool({
  name: 'release_for_matching', description: 'Release a confirmed job ticket for helper matching. Requires explicit user confirmation in the current conversation.',
  parameters: z.object({ jobId: z.string().min(1), explicitConfirmation: z.literal(true) }),
  execute: async ({ jobId, explicitConfirmation }) => callApi(`/api/job-tickets/${encodeURIComponent(jobId)}/release`, { body: { explicitConfirmation } }),
});

let cachedAgent;
export async function getAgent() {
  if (cachedAgent) return cachedAgent;
  const instructions = await fs.readFile(new URL('./AGENT_INSTRUCTIONS.md', import.meta.url), 'utf8');
  const tools = [webSearchTool({ searchContextSize: 'medium' }), healthTool, searchPublicNeedsTool, importPublicLinkTool, redactClassifyTool, adminReviewTool, consentTool, estimateTool, confirmCustomerTool, createJobTicketTool, releaseMatchingTool];
  if (VECTOR_STORE_ID) tools.splice(1, 0, fileSearchTool(VECTOR_STORE_ID, { maxNumResults: 5 }));
  cachedAgent = new Agent({ name: 'NeighborTask Concierge', model: MODEL, instructions, tools });
  return cachedAgent;
}

export async function runAgentTurn(input, history = []) {
  const agent = await getAgent();
  const result = await run(agent, history.length ? [...history, { role: 'user', content: input }] : input);
  return { output: result.finalOutput ?? '', history: result.history ?? [] };
}
