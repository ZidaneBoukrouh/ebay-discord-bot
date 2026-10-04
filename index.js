require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');

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

// maxPrice in GBP; condition: 'USED' | 'NEW' | undefined; binOnly: Buy It Now only
const SEARCHES = [
  { label: 'Graphics Card',            q: 'graphics card',          maxPrice: 300, condition: 'USED' },
  { label: 'GTX',                      q: 'GTX',                    maxPrice: 100, condition: 'USED' },
  { label: 'Power Supply',             q: 'power supply PSU',       maxPrice: 30,  binOnly: true },
  { label: 'Motherboard + CPU Bundle', q: 'motherboard cpu bundle', maxPrice: 100 },
  { label: 'Motherboard',              q: 'motherboard',            maxPrice: 40,  condition: 'USED' },
  { label: 'Desktop PC',               q: 'desktop pc',             maxPrice: 105 },
  { label: 'Desktop RAM',              q: 'desktop ram ddr4',       maxPrice: 40,  condition: 'USED' },
  { label: 'CPU Processor',            q: 'cpu processor',          maxPrice: 40,  condition: 'USED', binOnly: true },
  { label: 'Ryzen',                    q: 'ryzen',                  maxPrice: 30,  condition: 'USED' },
  { label: 'PC Case',                  q: 'pc case',                maxPrice: 50,  condition: 'NEW' },
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
  // Sandbox data is sparse test data, so skip filters there
  if (IS_SANDBOX) return '';
  const f = [];
  if (s.maxPrice) f.push(`price:[..${s.maxPrice}]`, 'priceCurrency:GBP');
  if (s.condition) f.push(`conditions:{${s.condition}}`);
  if (s.binOnly) f.push('buyingOptions:{FIXED_PRICE}');
  f.push('itemLocationCountry:GB');
  return f.join(',');
}

async function searchEbay(s) {
  try {
    const token = await getToken();
    const params = { q: s.q, sort: 'newlyListed', limit: 30 };
    const filter = buildFilter(s);
    if (filter) params.filter = filter;

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
    }));
  } catch (err) {
    const detail = err.response?.data
        ? JSON.stringify(err.response.data)
        : err.message;
    console.error(`❌ "${s.label}" failed (${err.response?.status || 'no status'}): ${detail}`);
    return null; // null = failed, so we never treat failures as "no listings"
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