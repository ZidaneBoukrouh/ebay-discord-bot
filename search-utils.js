const BLOCK_WORDS = [
  /\bsteam\s+(?:game\s+)?keys?\b/i,
  /\b(?:pc\s+)?games?\s+(?:keys?|codes?)\b/i,
  /\bfootball\s+manager\b/i,
  /\bdigital\s+(?:download|code)\b/i,
  /\b(?:ornament|decoration)\b/i,
  /\bpencil\s+case\b/i,
  /\bsunglasses\s+case\b/i,
  /\btablet\s+(?:case|cover|folio)\b/i,
  /\bphone\s+case\b/i,
];

const TITLE_RULES = {
  'graphics-card': title => /\b(?:graphics?\s+cards?|gpu|geforce|radeon|gtx|rtx)\b/i.test(title),
  gtx: title => /\bgtx(?:\s*[-]?\s*\d{3,4})?\b/i.test(title),
  'power-supply': title => /\b(?:power\s+supply|psu)\b/i.test(title),
  ssd: title => /\b(?:ssd|solid[\s-]state\s+drive)\b/i.test(title),
  'motherboard-cpu-bundle': title =>
    /\b(?:motherboard|mainboard)\b/i.test(title) && /\b(?:cpu|processor|ryzen|athlon|xeon|core\s+i[3579])\b/i.test(title),
  motherboard: title => /\b(?:motherboard|mainboard)\b/i.test(title),
  'desktop-pc': title =>
    /\b(?:desktop|tower|mini\s+pc|all[\s-]?in[\s-]?one|workstation|prodesk|thinkcentre|optiplex|elitedesk|ideacentre|nuc)\b/i.test(title) &&
    !/\b(?:pc|computer)\s+case\b/i.test(title),
  'gaming-pc': title =>
    /\b(?:gaming|gamer)\b/i.test(title) &&
    /\b(?:pc|computer|desktop|tower|rig)\b/i.test(title) &&
    !/\b(?:pc|computer)\s+case\b/i.test(title),
  'desktop-ram': title =>
    /\b(?:ram|memory|ddr[2345]|dimm)\b/i.test(title) && !/\b(?:so[\s-]?dimm|laptop)\b/i.test(title),
  cpu: title => /\b(?:cpu|processor|ryzen|athlon|xeon|core\s+i[3579]|core\s+ultra)\b/i.test(title),
  'pc-case': title => /\b(?:case|chassis|tower)\b/i.test(title),
};

function buildBrowseSearchParams(search, isSandbox, filter) {
  const params = { q: search.q, sort: 'newlyListed', limit: 30 };
  if (filter) params.filter = filter;
  if (!isSandbox && search.categoryId) params.category_ids = search.categoryId;
  return params;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isRelevantTitle(rule, title, blockWords = []) {
  if (BLOCK_WORDS.some(pattern => pattern.test(title))) return false;
  if (blockWords.some(word => new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i').test(title))) return false;
  return Boolean(TITLE_RULES[rule]?.(title));
}

module.exports = { buildBrowseSearchParams, isRelevantTitle };
