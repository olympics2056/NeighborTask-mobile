const ACTION_PATTERNS = [
  /\b(?:i|we)\s+(?:need|could use|am looking for|are looking for)\s+(?:someone|help|a person)\b/i,
  /\b(?:can|could|would)\s+(?:anyone|someone)\s+(?:help|assist|pick up|move|fix|walk|clean|mow|shovel)\b/i,
  /\blooking for someone to\b/i,
  /\bneed help (?:with|to|moving|cleaning|mowing|fixing)\b/i,
  /\b(?:paying|offering)\s+\$?\d+/i,
];
const RECOMMENDATION_PATTERNS = [
  /\b(?:recommend|recommendation|suggestions?)\b/i,
  /\b(?:does|can) anyone know (?:a|an|any|of)\b/i,
  /\bwho (?:do you|would you) recommend\b/i,
  /\breviews? (?:for|of)\b/i,
];
const CATEGORY_PATTERNS = [
  ['yard', /\b(?:yard|lawn|mow|branch|leaves|garden)\b/i], ['moving', /\b(?:move|moving|sofa|couch|dresser|furniture)\b/i],
  ['cleaning', /\b(?:clean|cleaning)\b/i], ['assembly', /\b(?:assemble|assembly|ikea)\b/i],
  ['home_repair', /\b(?:repair|fix|plumb|electric|handyman)\b/i], ['pickup_delivery', /\b(?:pick\s?up|delivery|deliver|errand|grocer)\b/i],
  ['pet', /\b(?:dog|cat|pet|walk)\b/i], ['tech', /\b(?:computer|wifi|phone|tech)\b/i],
  ['elder_support', /\b(?:senior|elder|older adult)\b/i], ['snow', /\b(?:snow|shovel|ice)\b/i],
];

function firstMatch(text, patterns, fallback = null) { return patterns.find(([, re]) => re.test(text))?.[0] ?? fallback; }
function round(n) { return Math.round(Math.max(0, Math.min(1, n)) * 100) / 100; }

export class ActionableNeedClassifier {
  async classify() { throw new Error('Classifier must implement classify()'); }
}

export class RuleBasedNeedClassifier extends ActionableNeedClassifier {
  async classify(candidate) {
    const text = `${candidate.title || ''}\n${candidate.rawText}`.trim();
    const recommendation = RECOMMENDATION_PATTERNS.some(re => re.test(text));
    const actionHits = ACTION_PATTERNS.filter(re => re.test(text)).length;
    const actionable = actionHits > 0 && !recommendation;
    const evidence = [actionHits ? `${actionHits} actionable phrase(s)` : 'no actionable phrase', recommendation ? 'recommendation language' : null].filter(Boolean);
    return { label: actionable ? 'actionable_request' : recommendation ? 'recommendation' : 'other', actionable, confidence:round(actionable ? .68 + .08 * Math.min(3, actionHits) : recommendation ? .88 : .55), evidence };
  }
}

export function extractNeedFields(candidate) {
  const text = `${candidate.title || ''}\n${candidate.rawText}`.trim();
  const money = text.match(/\$\s?(\d+(?:\.\d{1,2})?)(?:\s*(?:\/|per)\s*(hour|hr))?/i);
  const volunteer = /\b(?:volunteer|unpaid|free neighbor help|cannot pay)\b/i.test(text);
  const location = candidate.sourceLocation || text.match(/\b(?:in|near|around)\s+([A-Z][A-Za-z .'-]{2,40})(?=\s+(?:this|today|tomorrow|on|for|who|to)|[,.!?]|$)/)?.[1] || '';
  const timePhrase = text.match(/\b(today|tonight|tomorrow|this (?:morning|afternoon|evening|weekend)|(?:mon|tues|wednes|thurs|fri|satur|sun)day(?:\s+(?:morning|afternoon|evening))?)\b/i)?.[1] || null;
  const category = firstMatch(text, CATEGORY_PATTERNS, 'other');
  return {
    category,
    title: (candidate.title || candidate.rawText.split(/[.!?\n]/)[0] || 'Local help requested').trim().slice(0, 120),
    description: candidate.rawText,
    helpType: volunteer ? 'volunteer' : money ? 'paid' : 'either',
    compensation: money ? { amount:Number(money[1]), currency:'USD', unit:money[2] ? 'hour' : 'total' } : null,
    location:{ label:location.trim().slice(0,120), lat:Number.isFinite(candidate.metadata?.lat)?candidate.metadata.lat:null, lng:Number.isFinite(candidate.metadata?.lng)?candidate.metadata.lng:null, precision:location ? 'city' : 'approximate' },
    time:{ start:null, end:null, flexible:!timePhrase, label:timePhrase },
  };
}
