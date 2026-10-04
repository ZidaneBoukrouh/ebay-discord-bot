require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const { buildBrowseSearchParams, isRelevantTitle } = require('./search-utils');

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const TOKEN         = process.env.DISCORD_TOKEN;
const CHANNEL_ID    = process.env.CHANNEL_ID;
const CLIENT_ID     = process.env.EBAY_CLIENT_ID;
const CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;
const IS_SANDBOX    = (process.env.EBAY_ENV || 'sandbox') === 'sandbox';

const API_HOST   = IS_SANDBOX ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';
const TOKEN_URL  = `${API_HOST}/identity/v1/oauth2/token`;
const SEARCH_URL = `${API_HOST}/buy/browse/v1/item_summary/search`;

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const FOOTER_TEXT = IS_SANDBOX ? 'eBay SANDBOX (test data)' : 'eBay UK';

// Mirrors your eBay.co.uk links.
//   categoryId   <- _sacat (omit when _sacat=0)
//   maxPrice     <- _udhi
//   conditionId  <- LH_ItemCondition (3000 = Used, 1000 = New)
//   ukOnly       <- LH_PrefLoc=1
//   bestOffer    <- LH_BO=1 (Best Offer enabled)
//   freeShipping <- LH_FS=1
// Part categories use eBay UK leaf IDs; desktop searches remain uncategorized.
const SEARCHES = [
  { label: 'Graphics Card',            q: 'graphics card',          categoryId: '27386', titleRule: 'graphics-card', maxPrice: 300, conditionId: 3000, ukOnly: true },
  { label: 'GTX',                      q: 'gtx',                    categoryId: '27386', titleRule: 'gtx',            maxPrice: 100, conditionId: 3000, ukOnly: true },
  { label: 'Power Supply',             q: 'power supply',           categoryId: '42017', titleRule: 'power-supply',  maxPrice: 30, ukOnly: true, bestOffer: true },
  { label: 'SSD',                      q: 'ssd',                    categoryId: '175669', titleRule: 'ssd',           maxPrice: 31,  ukOnly: true },
  { label: 'Motherboard + CPU Bundle', q: 'motherboard cpu bundle', categoryId: '131511', titleRule: 'motherboard-cpu-bundle', maxPrice: 100, ukOnly: true },
  { label: 'Motherboard',              q: 'motherboard',            categoryId: '1244', titleRule: 'motherboard',    maxPrice: 40,  conditionId: 3000, ukOnly: true },
  { label: 'Desktop PC',               q: 'desktop pc',             titleRule: 'desktop-pc', maxPrice: 105 },
  { label: 'Gaming PC',                q: 'gaming pc',              titleRule: 'gaming-pc', maxPrice: 600, ukOnly: true },
  { label: 'Desktop RAM',              q: 'desktop ram',            categoryId: '170083', titleRule: 'desktop-ram',  maxPrice: 55, conditionId: 3000, ukOnly: true },
  { label: 'CPU Processor',            q: 'cpu processor',          categoryId: '164', titleRule: 'cpu',            maxPrice: 100, conditionId: 3000, ukOnly: true, bestOffer: true },
  { label: 'Ryzen',                    q: 'ryzen',                  categoryId: '164', titleRule: 'cpu',            maxPrice: 30,  conditionId: 3000, ukOnly: true },
  { label: 'PC Case',                  q: 'pc case',                categoryId: '42014', titleRule: 'pc-case',      maxPrice: 50,  conditionId: 1000, ukOnly: true, freeShipping: true },
];
// ─────────────────────────────────────────────────────────────────────────────

const seenIds = new Set();
const client  = new Client({ intents: [GatewayIntentBits.Guilds] });
const sleep   = ms => new Promise(r => setTimeout(r, ms));

// ─── OAUTH (cached app token) ────────────────────────────────────────────────
let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry - 60_000) return cachedToken;

  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const body  = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: 'https://api.ebay.com/oauth/api_scope',
  });

  const { data } = await axios.post(TOKEN_URL, body.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`,
    },
  });

  cachedToken = data.access_token;
  tokenExpiry = Date.now() + data.expires_in * 1000;
  return cachedToken;
}

// ─── SEARCH ──────────────────────────────────────────────────────────────────
function buildFilter(s) {
  if (IS_SANDBOX) return ''; // sandbox data is sparse test data
  const f = [];
  if (s.maxPrice)     f.push(`price:[..${s.maxPrice}]`, 'priceCurrency:GBP');
  if (s.conditionId)  f.push(`conditionIds:{${s.conditionId}}`);
  if (s.ukOnly)       f.push('itemLocationCountry:GB');
  if (s.bestOffer)    f.push('buyingOptions:{BEST_OFFER}');
  if (s.freeShipping) f.push('maxDeliveryCost:0', 'deliveryCountry:GB');
  return f.join(',');
}

async function searchEbay(s) {
  try {
    const token = await getToken();
    const filter = buildFilter(s);
    const params = buildBrowseSearchParams(s, IS_SANDBOX, filter);

    const response = await axios.get(SEARCH_URL, {
      params,
      headers: {
        Authorization: `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
      },
    });

    /** @type {any[]} */
    const summaries = response.data.itemSummaries || [];

    return summaries.map(i => ({
      id:        String(i.itemId),
      title:     String(i.title),
      price:     i.price ? `£${parseFloat(i.price.value).toFixed(2)}` : 'N/A',
      link:      String(i.itemWebUrl),
      img:       i.image && i.image.imageUrl ? String(i.image.imageUrl) : null,
      condition: i.condition ? String(i.condition) : 'N/A',
    })).filter(item => isRelevantTitle(s.titleRule, item.title));
  } catch (err) {
    const detail = err.response?.data
        ? JSON.stringify(err.response.data)
        : err.message;
    console.error(`❌ "${s.label}" failed (${err.response?.status || 'no status'}): ${detail}`);
    return null; // null = failed, never treated as "no listings"
  }
}

// ─── POLLING ─────────────────────────────────────────────────────────────────
async function checkForNewListings() {
  console.log(`🔄 Checking... ${new Date().toLocaleTimeString('en-GB')}`);
  let channel;
  try {
    channel = await client.channels.fetch(CHANNEL_ID);
  } catch (err) {
    console.error('❌ Cannot fetch Discord channel:', err.message);
    return;
  }

  for (const s of SEARCHES) {
    await sleep(1000 + Math.random() * 1000);
    const items = await searchEbay(s);
    if (!items) continue;

    const fresh = items.filter(i => !seenIds.has(i.id));
    fresh.forEach(i => seenIds.add(i.id));

    for (const item of fresh.slice(0, 10)) { // max 10 alerts per search per cycle
      const embed = new EmbedBuilder()
          .setTitle(item.title.slice(0, 256))
          .setURL(item.link)
          .setColor(0xe53238)
          .addFields([
            { name: 'Price',     value: String(item.price),     inline: true },
            { name: 'Condition', value: String(item.condition), inline: true },
            { name: 'Search',    value: String(s.label),        inline: true },
          ])
          .setFooter({ text: FOOTER_TEXT })
          .setTimestamp();
      if (item.img) embed.setThumbnail(item.img);

      try {
        if (channel && 'send' in channel) {
          await channel.send({ embeds: [embed] });
        }
      } catch (err) {
        console.error('❌ Discord send failed:', err.message);
      }
    }
    if (fresh.length) console.log(`   ${s.label}: ${fresh.length} new`);
  }
}

// ─── STARTUP ─────────────────────────────────────────────────────────────────
client.once('clientReady', async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  console.log(`🌍 eBay environment: ${IS_SANDBOX ? 'SANDBOX' : 'PRODUCTION'}`);

  try {
    await getToken();
    console.log('🔑 eBay OAuth token OK');
  } catch (err) {
    console.error('❌ eBay OAuth failed:', err.response?.data || err.message);
    console.error('   Check EBAY_CLIENT_ID / EBAY_CLIENT_SECRET match the EBAY_ENV (sandbox vs production).');
    process.exit(1);
  }

  // Seed existing listings silently so you only get alerts for NEW ones
  for (const s of SEARCHES) {
    const items = await searchEbay(s);
    if (items) items.forEach(i => seenIds.add(i.id));
    await sleep(1000);
  }
  console.log(`✅ Seeded ${seenIds.size} existing listings. Watching ${SEARCHES.length} searches...`);

  setInterval(checkForNewListings, POLL_INTERVAL_MS);
});

client.on('error', err => console.error('Discord error:', err));

client.login(TOKEN).catch(err => {
  console.error('❌ Discord login failed:', err.message);
  process.exit(1);
});