require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
const axios = require('axios');
const {
  buildBrowseSearchParams, matchSubSearch, categoryChannelNames,
  cheapestShippingCost, formatTotalPrice, quickBuyUrl, itemPriceValue, itemBidValue,
} = require('./search-utils');

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const TOKEN         = process.env.DISCORD_TOKEN;
const CHANNEL_ID    = process.env.CHANNEL_ID;
const CLIENT_ID     = process.env.EBAY_CLIENT_ID;
const CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;
const IS_SANDBOX    = (process.env.EBAY_ENV || 'sandbox') === 'sandbox';

const API_HOST   = IS_SANDBOX ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';
const TOKEN_URL  = `${API_HOST}/identity/v1/oauth2/token`;
const SEARCH_URL = `${API_HOST}/buy/browse/v1/item_summary/search`;

// eBay Browse API default quota is 5,000 calls/day. Each search below has its
// own pollMs; budget = sum of 86,400,000 / pollMs (checked at startup).
// PC Parts every 20s = 4,320/day + Desktop PC every 3 min = 480/day = 4,800/day.
// Each restart costs one extra call per search (seeding).
const DAILY_CALL_LIMIT = 5000;
const FOOTER_TEXT = IS_SANDBOX ? 'eBay SANDBOX (test data)' : 'eBay UK';

// Mirrors your eBay.co.uk links.
//   categoryId   <- _sacat (omit when _sacat=0)
//   maxPrice     <- _udhi
//   conditionId  <- LH_ItemCondition (3000 = Used, 1000 = New)
//   ukOnly       <- LH_PrefLoc=1
//   bestOffer    <- LH_BO=1 (Best Offer enabled)
//   freeShipping <- LH_FS=1
// Part categories use eBay UK leaf IDs; desktop searches remain uncategorized.


//const SEARCHES = [
//  { label: 'Graphics Card',            q: 'graphics card',          categoryId: '27386', titleRule: 'graphics-card', maxPrice: 300, conditionId: 3000, ukOnly: true },
//  { label: 'GTX',                      q: 'gtx',                    categoryId: '27386', titleRule: 'gtx',            maxPrice: 100, conditionId: 3000, ukOnly: true },
//  { label: 'Power Supply',             q: 'power supply',           categoryId: '42017', titleRule: 'power-supply',  maxPrice: 30, ukOnly: true, bestOffer: true },
//  { label: 'SSD',                      q: 'ssd',                    categoryId: '175669', titleRule: 'ssd',           maxPrice: 31,  ukOnly: true },
//  { label: 'Motherboard + CPU Bundle', q: 'motherboard cpu bundle', categoryId: '131511', titleRule: 'motherboard-cpu-bundle', maxPrice: 100, ukOnly: true },
//  { label: 'Motherboard',              q: 'motherboard',            categoryId: '1244', titleRule: 'motherboard',    maxPrice: 40,  conditionId: 3000, ukOnly: true },
//  { label: 'Desktop PC',               q: 'desktop pc',             titleRule: 'desktop-pc', maxPrice: 105 },
//  { label: 'Gaming PC',                q: 'gaming pc',              titleRule: 'gaming-pc', maxPrice: 600, ukOnly: true },
//  { label: 'Desktop RAM',              q: 'desktop ram',            categoryId: '170083', titleRule: 'desktop-ram',  maxPrice: 55, conditionId: 3000, ukOnly: true },
//  { label: 'CPU Processor',            q: 'cpu processor',          categoryId: '164', titleRule: 'cpu',            maxPrice: 100, conditionId: 3000, ukOnly: true, bestOffer: true },
//  { label: 'Ryzen',                    q: 'ryzen',                  categoryId: '164', titleRule: 'cpu',            maxPrice: 30,  conditionId: 3000, ukOnly: true },
//  { label: 'PC Case',                  q: 'pc case',                categoryId: '42014', titleRule: 'pc-case',      maxPrice: 50,  conditionId: 1000, ukOnly: true, freeShipping: true },
//];

// Combined searches: each entry is ONE API call. The top-level fields are sent
// to eBay (keep them as loose as every sub-search needs); each sub-search's own
// category / price / condition / Best Offer rules are checked locally.
// Inside eBay's (a, b, c) OR syntax quotes are ignored, plurals aren't matched
// ("graphics card" misses "Graphics Cards") and multi-word terms behave
// unpredictably - tested live 2026-11-09. Use SINGLE WORDS only in the list.
// The old "GTX" search is covered by Graphics Card (same category, cheaper cap).
const SEARCHES = [
  {
    label: 'PC Parts',
    pollMs: 20 * 1000, // ~1 new listing/min - poll fast
    q: '(gpu, gtx, rtx, geforce, radeon, nvidia, quadro, graphics, psu, supply, ssd, nvme, motherboard, mainboard, ram, ddr3, ddr4, ddr5, cpu, processor, ryzen)',
    categoryId: '58058', // Computers/Tablets & Networking
    maxPrice: 300,
    ukOnly: true,
    subSearches: [
      { label: 'Graphics Card',            channel: 'graphics-cards', categoryId: '27386',  titleRule: 'graphics-card',          maxPrice: 300, conditionId: 3000 },
      { label: 'Power Supply',             channel: 'power-supplies', categoryId: '42017',  titleRule: 'power-supply',           maxPrice: 30,  bestOffer: true },
      { label: 'SSD',                      channel: 'ssds',           categoryId: '175669', titleRule: 'ssd',                    maxPrice: 31 },
      { label: 'Motherboard + CPU Bundle', channel: 'motherboards',   categoryId: '131511', titleRule: 'motherboard-cpu-bundle', maxPrice: 100 },
      { label: 'Motherboard',              channel: 'motherboards',   categoryId: '1244',   titleRule: 'motherboard',            maxPrice: 40,  conditionId: 3000 },
      { label: 'Desktop RAM',              channel: 'ram',            categoryId: '170083', titleRule: 'desktop-ram',            maxPrice: 55,  conditionId: 3000 },
      { label: 'Ryzen',                    channel: 'cpus',           categoryId: '164',    titleRule: 'ryzen',                  maxPrice: 30,  conditionId: 3000 },
      { label: 'CPU Processor',            channel: 'cpus',           categoryId: '164',    titleRule: 'cpu',                    maxPrice: 100, conditionId: 3000, bestOffer: true },
    ],
  },
  {
    label: 'Desktop PC',
    pollMs: 3 * 60 * 1000, // ~0.1 new listings/min - slow poll is enough
    q: 'desktop pc',
    maxPrice: 105,
    subSearches: [
      { label: 'Desktop PC', channel: 'desktop-pcs', titleRule: 'desktop-pc', maxPrice: 105 },
    ],
  },
];
const MAX_RESULTS = 200; // must match the limit in buildBrowseSearchParams

// Every alert goes to CHANNEL_ID, and also to its sub-search's `channel`
// (found by name, or created under this Discord category on startup).
const DEALS_CATEGORY = 'eBay Deals';

// ─────────────────────────────────────────────────────────────────────────────

const seenIds = new Set();    // matched listings already alerted/seeded
const seenRawIds = new Set(); // every listing returned, for missed-listing detection
const client  = new Client({ intents: [GatewayIntentBits.Guilds] });
const sleep   = ms => new Promise(r => setTimeout(r, ms));

// ─── DISCORD CHANNELS ────────────────────────────────────────────────────────
let mainChannel = null;               // CHANNEL_ID: receives every alert
const categoryChannels = new Map();   // channel name -> channel, per category

async function getMainChannel() {
  if (mainChannel) return mainChannel;
  try {
    mainChannel = await client.channels.fetch(CHANNEL_ID);
  } catch (err) {
    console.error('❌ Cannot fetch Discord channel:', err.message);
  }
  return mainChannel;
}

// Find each category channel by name in the main channel's server, creating
// any that are missing (needs the bot to have Manage Channels). Failures are
// logged and alerts keep going to the main channel only.
async function setupCategoryChannels() {
  const names = categoryChannelNames(SEARCHES);
  const main = await getMainChannel();
  const guild = main && 'guild' in main ? main.guild : null;
  if (!names.length || !guild) return;

  try {
    const all = await guild.channels.fetch();
    const isNamed = (c, name, type) => c && c.type === type && c.name === name;

    let category = all.find(c => isNamed(c, DEALS_CATEGORY, ChannelType.GuildCategory)) || null;
    const missing = names.filter(n => !all.some(c => isNamed(c, n, ChannelType.GuildText)));
    if (!category && missing.length) {
      category = await guild.channels.create({ name: DEALS_CATEGORY, type: ChannelType.GuildCategory });
      console.log(`📁 Created category "${DEALS_CATEGORY}"`);
    }

    for (const name of names) {
      let channel = all.find(c => isNamed(c, name, ChannelType.GuildText));
      if (channel) {
        console.log(`   #${name}: found`);
      } else {
        channel = await guild.channels.create({ name, type: ChannelType.GuildText, parent: category?.id });
        console.log(`   #${name}: created`);
      }
      categoryChannels.set(name, channel);
    }
  } catch (err) {
    console.warn(`⚠️  Category channels unavailable (${err.message}). Give the bot the "Manage Channels" permission to create them. Alerts will go to the main channel only for now.`);
  }
}

async function sendTo(channel, payload) {
  if (!channel || !('send' in channel)) return;
  try {
    await channel.send(payload);
  } catch (err) {
    console.error(`❌ Discord send to #${channel.name || channel.id} failed:`, err.message);
  }
}

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
  // Without a buyingOptions filter eBay returns fixed-price listings only,
  // so auctions must be requested explicitly.
  f.push(s.bestOffer ? 'buyingOptions:{BEST_OFFER}' : 'buyingOptions:{FIXED_PRICE|AUCTION|BEST_OFFER}');
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
        // Price postage for delivery to the UK (domestic), not the default location.
        'X-EBAY-C-ENDUSERCTX': 'contextualLocation=country%3DGB',
      },
    });

    /** @type {any[]} */
    const summaries = response.data.itemSummaries || [];

    const items = summaries.map(i => {
      const priceValue    = itemPriceValue(i);
      const shippingCost  = cheapestShippingCost(i.shippingOptions);
      const buyingOptions = i.buyingOptions || [];
      return {
      id:           String(i.itemId),
      title:        String(i.title),
      price:        formatTotalPrice(priceValue, shippingCost),
      priceValue,
      shippingCost,
      bidPrice:     formatTotalPrice(itemBidValue(i), shippingCost),
      isAuction:    buyingOptions.includes('AUCTION'),
      hasBuyItNow:  buyingOptions.includes('FIXED_PRICE'),
      bidCount:     i.bidCount ?? 0,
      endDate:      i.itemEndDate || null,
      // Checkout link only works for Buy It Now listings.
      quickBuy:     buyingOptions.includes('FIXED_PRICE') ? quickBuyUrl(i.legacyItemId, i.itemId) : null,
      link:         String(i.itemWebUrl),
      img:          i.image && i.image.imageUrl ? String(i.image.imageUrl) : null,
      condition:    i.condition ? String(i.condition) : 'N/A',
      conditionId:  i.conditionId ? String(i.conditionId) : null,
      buyingOptions,
      categoryIds:  (i.categories || []).map(c => String(c.categoryId)),
      country:      i.itemLocation?.country || null,
      };
    });

    return { rawIds: items.map(i => i.id), items: items
      .map(item => ({ ...item, match: matchSubSearch(s, item) }))
      .filter(item => item.match) };
  } catch (err) {
    const detail = err.response?.data
        ? JSON.stringify(err.response.data)
        : err.message;
    console.error(`❌ "${s.label}" failed (${err.response?.status || 'no status'}): ${detail}`);
    return null; // null = failed, never treated as "no listings"
  }
}

// ─── POLLING ─────────────────────────────────────────────────────────────────
// Each search runs on its own timer. `busy` stops a slow run (e.g. many
// Discord sends) overlapping the next tick of the same search.
const busy = new Set();

async function checkSearch(s) {
  if (busy.has(s.label)) return;
  busy.add(s.label);
  try {
    await pollSearch(s);
  } catch (err) {
    console.error(`❌ "${s.label}" poll crashed:`, err.message);
  } finally {
    busy.delete(s.label);
  }
}

async function pollSearch(s) {
  console.log(`🔄 Checking ${s.label}... ${new Date().toLocaleTimeString('en-GB')}`);
  const channel = await getMainChannel();
  if (!channel) return;

  {
    const result = await searchEbay(s);
    if (!result) return;

    // If every one of the newest MAX_RESULTS listings is unseen, more new
    // listings arrived since the last poll than one page holds: some were missed.
    if (result.rawIds.length >= MAX_RESULTS && !result.rawIds.some(id => seenRawIds.has(id))) {
      console.warn(`⚠️  "${s.label}": a full page of ${MAX_RESULTS} new results - some listings may have been missed. Poll more often or split this search.`);
    }
    result.rawIds.forEach(id => seenRawIds.add(id));

    const fresh = result.items.filter(i => !seenIds.has(i.id));
    fresh.forEach(i => seenIds.add(i.id));

    for (const item of fresh.slice(0, 20)) { // max 20 alerts per API call per cycle
      const fields = [];
      if (item.isAuction) {
        const bid = item.bidPrice !== 'N/A' ? item.bidPrice : item.price;
        fields.push({ name: 'Current bid', value: `${bid} (${item.bidCount} bid${item.bidCount === 1 ? '' : 's'})`, inline: true });
        if (item.hasBuyItNow) fields.push({ name: 'Buy It Now', value: String(item.price), inline: true });
      } else {
        fields.push({ name: 'Price', value: String(item.price), inline: true });
      }
      fields.push(
        { name: 'Condition', value: String(item.condition), inline: true },
        { name: 'Search',    value: String(item.match.label), inline: true },
      );
      const endMs = item.endDate ? Date.parse(item.endDate) : NaN;
      if (item.isAuction && Number.isFinite(endMs)) {
        fields.push({ name: 'Ends', value: `<t:${Math.floor(endMs / 1000)}:R>`, inline: true });
      }
      const embed = new EmbedBuilder()
          .setTitle(item.title.slice(0, 256))
          .setURL(item.link)
          .setColor(0xe53238)
          .addFields(fields)
          .setFooter({ text: FOOTER_TEXT })
          .setTimestamp();
      if (item.img) embed.setThumbnail(item.img);

      const buttons = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setLabel('View listing').setStyle(ButtonStyle.Link).setURL(item.link),
      );
      if (item.quickBuy) {
        buttons.addComponents(
            new ButtonBuilder().setLabel('⚡ Quick Buy').setStyle(ButtonStyle.Link).setURL(item.quickBuy),
        );
      }

      const payload = { embeds: [embed], components: [buttons] };
      await sendTo(channel, payload);
      await sendTo(categoryChannels.get(item.match.channel), payload);
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

  console.log('📺 Setting up category channels...');
  await setupCategoryChannels();

  // Seed existing listings silently so you only get alerts for NEW ones
  for (const s of SEARCHES) {
    const result = await searchEbay(s);
    if (result) {
      result.items.forEach(i => seenIds.add(i.id));
      result.rawIds.forEach(id => seenRawIds.add(id));
    }
    await sleep(1000);
  }
  const subCount = SEARCHES.reduce((n, s) => n + s.subSearches.length, 0);
  const callsPerDay = Math.round(SEARCHES.reduce((n, s) => n + 86_400_000 / s.pollMs, 0));
  console.log(`✅ Seeded ${seenIds.size} existing listings. Watching ${subCount} searches in ${SEARCHES.length} API calls (~${callsPerDay}/day of ${DAILY_CALL_LIMIT}):`);
  for (const s of SEARCHES) console.log(`   ${s.label}: every ${s.pollMs / 1000}s`);
  if (callsPerDay > DAILY_CALL_LIMIT) {
    console.warn(`⚠️  Poll schedule needs ~${callsPerDay} calls/day, over the ${DAILY_CALL_LIMIT} limit - raise pollMs.`);
  }

  // Stagger start times so the searches don't all fire together.
  SEARCHES.forEach((s, i) => {
    setTimeout(() => setInterval(() => checkSearch(s), s.pollMs), i * 7000);
  });
});

client.on('error', err => console.error('Discord error:', err));

client.login(TOKEN).catch(err => {
  console.error('❌ Discord login failed:', err.message);
  process.exit(1);
});