import http from "node:http";
import crypto from "node:crypto";

const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.NEIGHBORTASK_API_KEY || "";
const ALLOWED_FEED_URLS = String(process.env.ALLOWED_PUBLIC_FEED_URLS || "")
  .split(",").map(value => value.trim()).filter(Boolean);

const leads = [];
const submissions = [];
const tickets = [];

const priceRanges = {
  "House cleaning": ["$120–$160", "2–4 hours"],
  "Lawn care": ["$40–$70", "1–2 hours"],
  "Snow removal": ["$50–$90", "1–2 hours"],
  "Dog walking": ["$20–$30", "30–60 minutes"],
  "Furniture assembly": ["$45–$85/hr", "1–4 hours"],
  "Pickup / drop-off": ["$25–$50", "1–2 hours"],
  "Grocery shopping": ["$35–$65", "1–2 hours"],
  "Kids care": ["$18–$28/hr", "As requested"],
  "Light organizing": ["$60–$120", "2–3 hours"],
  "Community help": ["$25–$60", "1–2 hours"]
};

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "https://chatgpt.com",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer"
  });
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 100_000) throw new Error("Request too large");
  }
  return raw ? JSON.parse(raw) : {};
}

function authorized(req) {
  if (!API_KEY) return true;
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  return bearer === API_KEY || req.headers["x-api-key"] === API_KEY;
}

function redact(text = "") {
  return String(text)
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, "[email removed]")
    .replace(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, "[phone removed]")
    .replace(/\b\d{1,5}\s+[A-Za-z0-9.' -]+\s(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Court|Ct|Boulevard|Blvd)\b/gi, "[exact address removed]")
    .slice(0, 2000);
}

function safetyFor(service = "") {
  if (/kids|child|babysit/i.test(service)) return {level: "High", verification: "Background check"};
  if (/clean|assembly|organizing|indoor/i.test(service)) return {level: "Medium", verification: "Photo ID"};
  return {level: "Low", verification: "Standard platform checks"};
}

function keywordsMatch(item, keywords) {
  if (!keywords.length) return true;
  const haystack = `${item.title || ""} ${item.summary || ""} ${item.category || ""}`.toLowerCase();
  return keywords.some(word => haystack.includes(word.toLowerCase()));
}

function geographyMatch(item, geography) {
  if (!geography) return true;
  const location = String(item.neighborhood || "").toLowerCase();
  return location.includes(geography.toLowerCase()) || geography.toLowerCase().includes(location);
}

function normalizeLead(raw, source = "public_feed") {
  return {
    id: String(raw.id || raw.source_post_id || crypto.randomUUID()),
    source: redact(raw.source || source).slice(0, 80),
    sourceUrl: String(raw.sourceUrl || raw.public_url || "").slice(0, 500),
    title: redact(raw.title || "Community request").slice(0, 160),
    summary: redact(raw.summary || raw.excerpt || raw.text || ""),
    neighborhood: redact(raw.neighborhood || raw.generalized_location || "Area not provided").slice(0, 120),
    category: redact(raw.category || "Community help").slice(0, 80),
    publishedAt: raw.publishedAt || raw.published_at || new Date().toISOString(),
    status: raw.status || "DISCOVERED",
    verification: "Unverified public lead"
  };
}

async function searchConfiguredFeeds(query) {
  const items = [];
  const coverage = [];
  for (const feedUrl of ALLOWED_FEED_URLS) {
    try {
      const response = await fetch(feedUrl, {
        headers: {"Accept": "application/json", "User-Agent": "NeighborTask/1.1"}
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const rows = Array.isArray(payload) ? payload : (payload.items || []);
      const normalized = rows.map(row => normalizeLead(row, "public_feed"))
        .filter(item => keywordsMatch(item, query.keywords))
        .filter(item => geographyMatch(item, query.geography));
      items.push(...normalized);
      coverage.push({source: feedUrl, status: "searched", count: normalized.length});
    } catch (error) {
      coverage.push({source: feedUrl, status: "unavailable", count: 0, note: error.message});
    }
  }
  return {items, coverage};
}

function dedupe(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = item.sourceUrl || `${item.title}|${item.neighborhood}|${item.publishedAt}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "OPTIONS") return sendJson(res, 204, {});
    if (url.pathname.startsWith("/api/") && !authorized(req)) {
      return sendJson(res, 401, {error: "Unauthorized"});
    }

    if (req.method === "GET" && url.pathname === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        service: "NeighborTask Concierge API",
        connectors: {
          local: "active",
          publicFeeds: ALLOWED_FEED_URLS.length ? "configured" : "not-configured",
          nextdoor: process.env.NEXTDOOR_ACCESS_TOKEN ? "credentials-present-adapter-required" : "approval-or-credentials-required",
          facebookGroups: "disabled"
        }
      });
    }

    if (req.method === "POST" && url.pathname === "/api/public-needs/search") {
      const body = await readBody(req);
      const geography = redact(body.geography || "").trim();
      if (!geography) return sendJson(res, 400, {error: "geography is required"});
      const keywords = (Array.isArray(body.keywords) ? body.keywords : [])
        .map(value => redact(value).trim()).filter(Boolean).slice(0, 10);
      const requested = new Set(body.sources || ["local", "public_feed", "nextdoor"]);
      const limit = Math.min(50, Math.max(1, Number(body.limit || 20)));
      let items = [];
      const coverage = [];

      if (requested.has("local") || requested.has("partner")) {
        const local = leads.filter(item => keywordsMatch(item, keywords))
          .filter(item => geographyMatch(item, geography));
        items.push(...local);
        coverage.push({source: "local_and_partner_intake", status: "searched", count: local.length});
      }
      if (requested.has("public_feed")) {
        const feedResult = await searchConfiguredFeeds({geography, keywords});
        items.push(...feedResult.items);
        coverage.push(...feedResult.coverage);
        if (!ALLOWED_FEED_URLS.length) {
          coverage.push({source: "public_feed", status: "not-configured", count: 0});
        }
      }
      if (requested.has("nextdoor")) {
        coverage.push({
          source: "nextdoor",
          status: process.env.NEXTDOOR_ACCESS_TOKEN ? "adapter-required" : "approval-or-credentials-required",
          count: 0,
          note: "Only an approved Nextdoor API or sharing integration may be used."
        });
      }
      coverage.push({
        source: "facebook_groups",
        status: "disabled",
        count: 0,
        note: "Private or login-gated group harvesting is not permitted."
      });

      items = dedupe(items).slice(0, limit);
      return sendJson(res, 200, {
        ok: true,
        items,
        coverage,
        limitations: [
          "Results contain only configured and permitted sources.",
          "Use the GPT's Web Search separately for broader publicly indexed web results.",
          "Every result is an unverified lead until reviewed and consented."
        ]
      });
    }

    if (req.method === "POST" && url.pathname === "/api/import/public-link") {
      const body = await readBody(req);
      if (!body.sourceUrl || !body.text) return sendJson(res, 400, {error: "sourceUrl and text are required"});
      const parsed = new URL(body.sourceUrl);
      if (!["http:", "https:"].includes(parsed.protocol)) return sendJson(res, 400, {error: "Only public HTTP(S) links are accepted"});
      const lead = normalizeLead(body, body.source || "user_submitted_link");
      lead.status = "REDACTED";
      leads.unshift(lead);
      return sendJson(res, 201, {ok: true, item: lead});
    }

    if (req.method === "POST" && url.pathname === "/api/redact-classify") {
      const body = await readBody(req);
      if (!body.text) return sendJson(res, 400, {error: "text is required"});
      const safety = safetyFor(body.service || body.text);
      return sendJson(res, 200, {
        ok: true,
        redactedText: redact(body.text),
        classification: {category: body.service || "Community help", safety, requiresHumanReview: true}
      });
    }

    const reviewMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/review$/);
    if (req.method === "POST" && reviewMatch) {
      const lead = leads.find(item => item.id === decodeURIComponent(reviewMatch[1]));
      if (!lead) return sendJson(res, 404, {error: "Lead not found"});
      lead.status = "ADMIN_REVIEW";
      lead.reviewedAt = new Date().toISOString();
      return sendJson(res, 200, {ok: true, item: lead});
    }

    const consentMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/consent$/);
    if (req.method === "POST" && consentMatch) {
      const body = await readBody(req);
      const lead = leads.find(item => item.id === decodeURIComponent(consentMatch[1]));
      if (!lead) return sendJson(res, 404, {error: "Lead not found"});
      if (!body.explicitConfirmation) return sendJson(res, 400, {error: "Explicit confirmation is required"});
      lead.status = body.action === "record_received" ? "CUSTOMER_CONFIRMED" : "CONSENT_REQUESTED";
      lead.consentSource = redact(body.consentSource || "Not specified");
      lead.consentTimestamp = new Date().toISOString();
      return sendJson(res, 200, {ok: true, item: lead});
    }

    if (req.method === "POST" && (url.pathname === "/api/estimate" || url.pathname === "/api/intake")) {
      const body = await readBody(req);
      const required = ["service", "neighborhood", "date", "time", "details"];
      const missing = required.filter(key => !String(body[key] || "").trim());
      if (missing.length) return sendJson(res, 400, {error: `Missing: ${missing.join(", ")}`});
      const [priceRange, duration] = priceRanges[body.service] || ["$40–$120", "1–3 hours"];
      const safety = safetyFor(body.service);
      const submission = {
        id: `NT-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomInt(1000, 9999)}`,
        service: redact(body.service), neighborhood: redact(body.neighborhood),
        date: body.date, time: redact(body.time), details: redact(body.details),
        size: redact(body.size || ""), backgroundOnly: Boolean(body.backgroundOnly),
        safety, priceRange, duration, status: "ESTIMATE_PENDING_CONFIRMATION",
        createdAt: new Date().toISOString()
      };
      submissions.push(submission);
      return sendJson(res, 201, {
        ok: true, requestId: submission.id, priceRange, duration,
        estimate: `Estimated total ${priceRange}, depending on helper availability.`,
        verification: submission.backgroundOnly ? "Background-checked helper required" : safety.verification,
        nextStep: "Ready to confirm?"
      });
    }

    if (req.method === "POST" && (url.pathname === "/api/customer/confirm" || url.pathname === "/api/confirm")) {
      const body = await readBody(req);
      const required = ["requestId", "customerName", "phone", "email", "address", "city"];
      const missing = required.filter(key => !String(body[key] || "").trim());
      if (missing.length) return sendJson(res, 400, {error: `Missing: ${missing.join(", ")}`});
      if (!body.consent) return sendJson(res, 400, {error: "Booking consent is required"});
      const submission = submissions.find(item => item.id === body.requestId);
      if (!submission) return sendJson(res, 404, {error: "Estimate not found"});
      submission.customer = {
        name: String(body.customerName).trim().slice(0, 100),
        phone: String(body.phone).trim().slice(0, 30),
        email: String(body.email).trim().slice(0, 200),
        address: String(body.address).trim().slice(0, 250),
        city: String(body.city).trim().slice(0, 100)
      };
      submission.status = "CUSTOMER_CONFIRMED";
      submission.updatedAt = new Date().toISOString();
      return sendJson(res, 200, {ok: true, requestId: submission.id, status: submission.status});
    }

    if (req.method === "POST" && url.pathname === "/api/job-tickets") {
      const body = await readBody(req);
      if (!body.explicitConfirmation) return sendJson(res, 400, {error: "Explicit confirmation is required"});
      const submission = submissions.find(item => item.id === body.requestId);
      if (!submission || submission.status !== "CUSTOMER_CONFIRMED") {
        return sendJson(res, 400, {error: "A confirmed customer request is required"});
      }
      const ticket = {...submission, jobId: submission.id, status: "CUSTOMER_CONFIRMED"};
      tickets.push(ticket);
      return sendJson(res, 201, {
        ok: true,
        ticket: {
          jobId: ticket.jobId, service: ticket.service, neighborhood: ticket.neighborhood,
          date: ticket.date, time: ticket.time, scope: ticket.details,
          priceRange: ticket.priceRange, verification: ticket.safety.verification, status: ticket.status
        }
      });
    }

    const releaseMatch = url.pathname.match(/^\/api\/job-tickets\/([^/]+)\/release$/);
    if (req.method === "POST" && releaseMatch) {
      const body = await readBody(req);
      if (!body.explicitConfirmation) return sendJson(res, 400, {error: "Explicit confirmation is required"});
      const ticket = tickets.find(item => item.jobId === decodeURIComponent(releaseMatch[1]));
      if (!ticket) return sendJson(res, 404, {error: "Job ticket not found"});
      ticket.status = "RELEASED_FOR_MATCHING";
      ticket.updatedAt = new Date().toISOString();
      return sendJson(res, 200, {ok: true, jobId: ticket.jobId, status: ticket.status});
    }

    if (url.pathname.startsWith("/api/")) return sendJson(res, 404, {error: "API route not found"});
    res.writeHead(200, {"Content-Type": "text/plain; charset=utf-8"});
    res.end("NeighborTask Concierge API");
  } catch (error) {
    return sendJson(res, 500, {
      error: "Server error",
      detail: process.env.NODE_ENV === "development" ? error.message : undefined
    });
  }
});

server.listen(PORT, process.env.HOST || '127.0.0.1', () => console.log(`NeighborTask API running at http://localhost:${PORT}`));
