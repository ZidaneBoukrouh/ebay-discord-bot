const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBrowseSearchParams, isRelevantTitle } = require('../search-utils');

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
