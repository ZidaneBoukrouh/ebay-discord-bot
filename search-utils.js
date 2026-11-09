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
    /\b(?:desktop\s+(?:pc|computer)|(?:pc|computer)\s+desktop|tower\s+(?:pc|computer)|mini\s+pc|all[\s-]?in[\s-]?one\s+(?:pc|computer)|(?:prodesk|thinkcentre|optiplex|elitedesk|ideacentre|nuc))\b/i.test(title) &&
    !/\b(?:pc|computer)\s+case\b/i.test(title),
  'gaming-pc': title =>
    /\b(?:gaming|gamer)\s+(?:desktop\s+)?(?:pc|computer|desktop|tower|rig)\b/i.test(title) &&
    !/\b(?:pc|computer)\s+case\b/i.test(title),
  'desktop-ram': title =>
    /\b(?:ram|memory|ddr[2345]|dimm)\b/i.test(title) && !/\b(?:so[\s-]?dimm|laptop)\b/i.test(title),
  ryzen: title => /\bryzen\b/i.test(title),
  cpu: title => /\b(?:cpu|processor|ryzen|athlon|xeon|core\s+i[3579]|core\s+ultra)\b/i.test(title),
  'pc-case': title => /\b(?:case|chassis|tower)\b/i.test(title),
};

function buildBrowseSearchParams(search, isSandbox, filter) {
  const params = { q: search.q, sort: 'newlyListed', limit: 200 };
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

// One API call can serve several "sub-searches". The API call carries only the
// loosest shared filters; each sub-search's own category, price, condition,
// Best Offer and location rules are checked here against the item summary.
// Sub-searches are tried in order and the first match labels the alert, so put
// more specific rules (e.g. Ryzen <= 30) before broader ones (CPU <= 100).
function passesSubSearch(sub, item) {
  if (sub.categoryId && !item.categoryIds.includes(String(sub.categoryId))) return false;
  if (sub.maxPrice != null && !(item.priceValue <= sub.maxPrice)) return false;
  if (sub.conditionId && String(item.conditionId) !== String(sub.conditionId)) return false;
  if (sub.bestOffer && !item.buyingOptions.includes('BEST_OFFER')) return false;
  if (sub.ukOnly && item.country !== 'GB') return false;
  return isRelevantTitle(sub.titleRule, item.title, sub.blockWords);
}

function matchSubSearch(search, item) {
  return (search.subSearches || []).find(sub => passesSubSearch(sub, item)) || null;
}

// Item price from a Browse API summary. Auctions usually carry no `price`,
// only `currentBidPrice` (the starting bid until someone bids).
function itemPriceValue(summary) {
  const p = summary?.price || summary?.currentBidPrice;
  return p ? parseFloat(p.value) : NaN;
}

// Cheapest postage among a Browse API item summary's shippingOptions.
// Returns 0 for free postage, or null when no option states a cost
// (e.g. collection only, or calculated postage the API didn't price).
function cheapestShippingCost(shippingOptions) {
  const costs = (shippingOptions || [])
    .map(o => (o && o.shippingCost ? parseFloat(o.shippingCost.value) : NaN))
    .filter(c => Number.isFinite(c));
  return costs.length ? Math.min(...costs) : null;
}

// Alert price: item price plus cheapest postage (postage not stated counts as 0).
function formatTotalPrice(priceValue, shippingCost) {
  if (!Number.isFinite(priceValue)) return 'N/A';
  return `£${(priceValue + (shippingCost || 0)).toFixed(2)}`;
}

// eBay's checkout ("Buy It Now") link. Needs the legacy numeric item id; the
// Browse API itemId looks like "v1|206685590078|0", so fall back to parsing it.
function quickBuyUrl(legacyItemId, itemId) {
  const id = legacyItemId || String(itemId || '').split('|')[1];
  if (!id || !/^\d+$/.test(id)) return null;
  return `https://www.ebay.co.uk/bin/ctb?item=${id}&quantity=1&fromPage=4429486&rev=0&fb=1`;
}

module.exports = {
  buildBrowseSearchParams, isRelevantTitle, matchSubSearch,
  cheapestShippingCost, formatTotalPrice, quickBuyUrl, itemPriceValue,
};
