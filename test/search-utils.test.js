const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBrowseSearchParams, isRelevantTitle, matchSubSearch } = require('../search-utils');

test('sends category_ids in production but omits it in sandbox', () => {
  const search = { q: 'pc case', categoryId: '42014' };
  assert.equal(buildBrowseSearchParams(search, false).category_ids, '42014');
  assert.equal(Object.hasOwn(buildBrowseSearchParams(search, true), 'category_ids'), false);
});

test('filters unrelated desktop and gaming search results', () => {
  assert.equal(isRelevantTitle('desktop-pc', 'Christmas tree desktop ornament'), false);
  assert.equal(isRelevantTitle('desktop-pc', 'Flower Desktop Vanity Mirror Pink Round Dressing Mirror'), false);
  assert.equal(isRelevantTitle('desktop-pc', 'Desktop PC Core i3 16GB RAM 256GB SSD'), true);
  assert.equal(isRelevantTitle('desktop-pc', 'Dell OptiPlex 3040 Micro PC 16GB RAM'), true);
  assert.equal(isRelevantTitle('gaming-pc', 'Steam key for PC game - Football Manager'), false);
  assert.equal(isRelevantTitle('gaming-pc', 'Turtle Beach Recon 70 Gaming Headset for PC'), false);
  assert.equal(isRelevantTitle('gaming-pc', 'Ergonomic Gaming Mouse Mat with Wrist Support'), false);
  assert.equal(isRelevantTitle('gaming-pc', 'Gaming PC case only, ATX chassis'), false);
  assert.equal(isRelevantTitle('gaming-pc', 'Gaming Desktop PC Ryzen 5 RTX 3060'), true);
  assert.equal(isRelevantTitle('gaming-pc', 'Gaming PC Ryzen 5 RTX 3060'), true);
});

test('filters accessory cases without rejecting a legitimate PC case title', () => {
  assert.equal(isRelevantTitle('pc-case', '1PC Sunglasses Case Protective Holder'), false);
  assert.equal(isRelevantTitle('pc-case', 'Pencil Case for School Supplies'), false);
  assert.equal(isRelevantTitle('pc-case', 'Tablet Cover Case for 10 inch tablet'), false);
  assert.equal(
    isRelevantTitle('pc-case', 'Fractal Design Meshify C, Midi Tower, PC, Black, ATX'),
    true,
  );
});

test('keeps valid component titles and rejects digital game listings', () => {
  assert.equal(isRelevantTitle('graphics-card', 'MSI GeForce RTX 4070 graphics card'), true);
  assert.equal(isRelevantTitle('cpu', 'AMD Ryzen 7 5800X CPU processor'), true);
  assert.equal(isRelevantTitle('ssd', 'Samsung 990 Pro NVMe SSD'), true);
  assert.equal(isRelevantTitle('graphics-card', 'Football Manager 2026 PC game digital code'), false);
});

test('applies custom blocked words only to the selected search and as whole words', () => {
  const gamingBlocks = ['CONTROLLER', 'HEADSET', 'MICROPHONE', 'ADAPTER', 'PS4', 'PS5',
    'XBOX', 'VINTAGE', 'CD', 'DVD', 'LAPTOP', 'REPAIR', 'TOOL', 'SWITCH', 'TV',
    'MONITOR', 'REMOTE', 'STREAMING', 'RECORDING'];
  const ramBlocks = ['SERVER'];

  for (const word of gamingBlocks) {
    assert.equal(isRelevantTitle('gaming-pc', `Gaming PC ${word} accessory`, gamingBlocks), false, word);
  }
  assert.equal(isRelevantTitle('desktop-ram', 'Server RAM 32GB DDR4', ramBlocks), false);
  assert.equal(isRelevantTitle('desktop-ram', 'Desktop RAM 32GB DDR4', ramBlocks), true);
  assert.equal(isRelevantTitle('gaming-pc', 'Gaming PC Ryzen 5 RTX 3060', gamingBlocks), true);
  assert.equal(isRelevantTitle('gaming-pc', 'Gaming PC CD-ROM drive included', ['CD']), false);
  assert.equal(isRelevantTitle('gaming-pc', 'Gaming PC with HDMI adapter', ['ADAPTER']), false);
  assert.equal(isRelevantTitle('gaming-pc', 'Gaming PC with upgraded RAM'), true);
});

test('combined search routes items to the first sub-search whose local filters pass', () => {
  const search = {
    subSearches: [
      { label: 'Ryzen',         categoryId: '164', titleRule: 'ryzen', maxPrice: 30,  conditionId: 3000 },
      { label: 'CPU Processor', categoryId: '164', titleRule: 'cpu',   maxPrice: 100, conditionId: 3000, bestOffer: true },
      { label: 'SSD',           categoryId: '175669', titleRule: 'ssd', maxPrice: 31 },
    ],
  };
  const item = over => ({
    title: 'AMD Ryzen 5 3600 CPU', priceValue: 25, conditionId: '3000',
    buyingOptions: ['FIXED_PRICE'], categoryIds: ['164', '175673', '58058'], country: 'GB', ...over,
  });

  assert.equal(matchSubSearch(search, item()).label, 'Ryzen');
  // Over the Ryzen cap: only matches CPU Processor when Best Offer is available.
  assert.equal(matchSubSearch(search, item({ priceValue: 60 })), null);
  assert.equal(matchSubSearch(search, item({ priceValue: 60, buyingOptions: ['FIXED_PRICE', 'BEST_OFFER'] })).label, 'CPU Processor');
  // Wrong condition or over every cap.
  assert.equal(matchSubSearch(search, item({ conditionId: '1000' })), null);
  assert.equal(matchSubSearch(search, item({ priceValue: 150, buyingOptions: ['BEST_OFFER'] })), null);
  // Category is enforced locally: a laptop mentioning an SSD is not an SSD listing.
  assert.equal(matchSubSearch(search, item({ title: 'Lenovo laptop 512GB SSD', categoryIds: ['177', '58058'] })), null);
  assert.equal(matchSubSearch(search, item({ title: 'Samsung 870 EVO SSD 500GB', categoryIds: ['175669', '165', '58058'] })).label, 'SSD');
  // Missing price never passes a price cap.
  assert.equal(matchSubSearch(search, item({ priceValue: NaN })), null);
});

test('requests the maximum page size so combined searches do not miss listings', () => {
  assert.equal(buildBrowseSearchParams({ q: 'x' }, false).limit, 200);
});

const { cheapestShippingCost, formatTotalPrice, quickBuyUrl } = require('../search-utils');

test('picks the cheapest stated postage cost', () => {
  assert.equal(cheapestShippingCost([{ shippingCost: { value: '4.99' } }, { shippingCost: { value: '2.50' } }]), 2.5);
  assert.equal(cheapestShippingCost([{ shippingCost: { value: '0.00' } }]), 0);
  assert.equal(cheapestShippingCost([{ shippingCostType: 'CALCULATED' }]), null);
  assert.equal(cheapestShippingCost(undefined), null);
});

test('formats price with postage included', () => {
  assert.equal(formatTotalPrice(45, 4.99), '£49.99');
  assert.equal(formatTotalPrice(45, 0), '£45.00');
  assert.equal(formatTotalPrice(45, null), '£45.00');
  assert.equal(formatTotalPrice(NaN, 3), 'N/A');
});

test('builds the quick buy checkout link from the item id', () => {
  const url = 'https://www.ebay.co.uk/bin/ctb?item=206685590078&quantity=1&fromPage=4429486&rev=0&fb=1';
  assert.equal(quickBuyUrl('206685590078', 'v1|206685590078|0'), url);
  assert.equal(quickBuyUrl(undefined, 'v1|206685590078|0'), url);
  assert.equal(quickBuyUrl(undefined, 'garbage'), null);
});

const { itemPriceValue } = require('../search-utils');

test('reads auction price from currentBidPrice when price is missing', () => {
  assert.equal(itemPriceValue({ price: { value: '45.00' } }), 45);
  assert.equal(itemPriceValue({ currentBidPrice: { value: '21.50' } }), 21.5);
  assert.ok(Number.isNaN(itemPriceValue({})));
});

const { itemBidValue } = require('../search-utils');

test('auction + Buy It Now: bid comes from currentBidPrice, price is the BIN price', () => {
  const summary = { price: { value: '52.69' }, currentBidPrice: { value: '10.79' } };
  assert.equal(itemBidValue(summary), 10.79);
  assert.equal(itemPriceValue(summary), 52.69);
  assert.ok(Number.isNaN(itemBidValue({ price: { value: '5' } })));
});

test('auction listings match sub-searches like fixed-price ones', () => {
  const search = { subSearches: [{ label: 'Graphics Card', categoryId: '27386', titleRule: 'graphics-card', maxPrice: 300, conditionId: 3000 }] };
  const auction = {
    title: 'SAPPHIRE Pulse Radeon RX Vega 56 Gaming 8gb Graphics Card', priceValue: 21.5, conditionId: '3000',
    buyingOptions: ['AUCTION'], categoryIds: ['27386', '58058'], country: 'GB',
  };
  assert.equal(matchSubSearch(search, auction).label, 'Graphics Card');
});
