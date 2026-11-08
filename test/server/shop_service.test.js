// SHOP (2026-10-28, the owner: "A new glyph panel alongside the timer and mailbox that will be used for our monetization
// shop ... When purchased are granted to the player and their mailbox"; bible/06-Systems/Shop.md).
// DFO-84 (2026-11-08): the service's money side - the card's Stripe-sealed Buy link, the confirm page, the press that
// opened Stripe's checkout, and Stripe's signed webhook granting the ware and the receipt - is removed; Stripe never
// takes a payment for this game again. What is left here is what was never Stripe-specific: the wares' own law (prices,
// bits, categories), what owning one unlocks (titles/auras/glyphs), and the CLIENT's own card validator (shopLaw.js
// shopCardOf, aliased `clientCard` below) which still has to cope with whatever shape a card arrives in. A fourth test
// is new: it pins the server's own shopCardOf (server-account/src/shop.js) to the post-removal shape - `on` always
// false, a pack's `buy` always null, no Stripe secret ever read and no request ever reaching outside this service.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shopCardOf } from '../../server-account/src/shop.js';
import { titlesHeld, aurasHeld, glyphsOf, equipRefusal, auraRefusal } from '../../server-account/src/titles.js';
import {
  SHOP_PRICE_CAP, SHOP_AURUM_CAP, SHOP_AURUM_PER_DOLLAR, SHOP_WARES, shopHeldOf, shopKeysOf, shopOnSaleOf,
  shopCardOf as clientCard, shopPriceText, SHOP_BITS_ALL, shopVocabularyOk, shopOwns,
} from '../../src/net/shopLaw.js';

const AFTER = 1_900_000_000;
const row = (o = {}) => ({ id: 'acct-buyer', handle: 'Buyer', created_at: AFTER, registered_at: AFTER, ...o });

// ── THE LAW ─────────────────────────────────────────────────────────

test('SHOP: the wares at the owner\'s and the sheet\'s prices, the owner\'s nine each a bit of its own, the rest held by id, each in the vocabulary; SHOP_ON_SALE names only wares sold alone (mutants: a price moved; two bits shared; a key off the vocabulary; a bundle\'s own ware let on sale)', () => {
  // STOREFRONT (PIN MOVED, bible/06-Systems/Storefront.md section 2): the sheet's rows by section - each [id, price, bit,
  // section, pre-alpha, tier, sold alone]; the owner's nine keep their bits, every ware since is held by its id.
  // PASS-PANELS (PIN MOVED): no pass, booster or Seasonal Collector - a season's tracks are bought with Aurum
  // AURUM-ONLY (PIN MOVED, the owner: "nothing should cost money money anymore"; "$1 = 100 Aurum"): each ware's price in
  // Aurum, its old dollar price to the whole dollar - a pack's alone in US cents, the one thing money once bought
  // (DFO-84: and can no longer buy at all)
  assert.deepEqual(SHOP_WARES.map((w) => [w.id, w.cash ? w.cents : w.price, w.bit, w.category, w.preAlpha, w.tier, w.alone]), [
    ['kill:ashen', 500, 0, 'kills', false, 'standard', true],
    ['kill:voidrend', 1000, 0, 'kills', false, 'premium', true],
    ['kill:pyre', 1500, 0, 'kills', false, 'exclusive', true],
    ['portal:runic', 800, 0, 'portals', false, 'standard', true],
    ['portal:daedric', 1300, 0, 'portals', false, 'premium', true],
    ['portal:aetheric', 2000, 0, 'portals', false, 'exclusive', true],
    ['mount:spectral', 1000, 0, 'mounts', false, 'standard', true],
    ['mount:dawnfire', 1500, 0, 'mounts', false, 'premium', true],
    ['mount:warhorse', 2500, 0, 'mounts', false, 'exclusive', true],
    ['title:genesis', 500, 1, 'names', true, null, true],
    ['glyph:origin', 200, 2, 'names', true, null, true],
    ['title:dawnbringer', 400, 0, 'names', false, 'standard', true],
    ['title:voidwalker', 700, 0, 'names', false, 'premium', true],
    ['title:eternalchampion', 1000, 0, 'names', false, 'exclusive', true],
    ['glyph:oblivion', 300, 0, 'names', false, null, false],
    ['glyph:gatesigil', 300, 0, 'names', false, null, false],
    ['aura:eternal', 2000, 4, 'auras', true, null, true],
    ['aura:dominion', 1500, 0, 'auras', false, null, false],
    // ARMORY (PIN MOVED, bible/04-Characters/Aura-Armory.md section 4): the Aura Armory's Eternal line - the set whole at $20
    // (the owner: "The store set should be $20"), and a piece a slot at $6 - AURUM-ONLY, 2,000 and 600 Aurum
    ['armory:eternalset', 2000, 256, 'armory', true, null, true],
    ['armory:eternalhalo', 600, 8, 'armory', true, null, true],
    ['armory:eternalsigil', 600, 16, 'armory', true, null, true],
    ['armory:eternalarmlets', 600, 32, 'armory', true, null, true],
    ['armory:eternalgreaves', 600, 64, 'armory', true, null, true],
    ['armory:eternaledge', 600, 128, 'armory', true, null, true],
    ['bundle:daedricchampion', 2800, 0, 'bundles', false, 'exclusive', true],
    ['bundle:portalmaster', 2000, 0, 'bundles', false, 'premium', true],
    ['bundle:lordofoblivion', 3000, 0, 'bundles', false, 'exclusive', true],
    // AURUM (PIN MOVED, bible/06-Systems/Aurum.md): the icons, and the Aurum's packs in cents
    ['icon:gatefire', 300, 0, 'icons', false, 'premium', true], ['icon:aurbis', 400, 0, 'icons', false, 'exclusive', true],
    ['icon:elderscroll', 300, 0, 'icons', false, 'premium', true], ['icon:azurastar', 300, 0, 'icons', false, 'premium', true],
    ['icon:redmountain', 400, 0, 'icons', false, 'exclusive', true], ['icon:hourglass', 300, 0, 'icons', false, 'standard', true],
    ['icon:sanguinerose', 200, 0, 'icons', false, 'standard', true], ['icon:whitegold', 200, 0, 'icons', false, 'standard', true],
    ['aurum:500', 499, 0, 'aurum', false, 'standard', true], ['aurum:1100', 999, 0, 'aurum', false, 'standard', true],
    ['aurum:2400', 1999, 0, 'aurum', false, 'premium', true], ['aurum:3900', 2999, 0, 'aurum', false, 'exclusive', true],
  ]);
  assert.deepEqual(SHOP_WARES.filter((w) => w.cash).map((w) => w.id), SHOP_WARES.filter((w) => w.kind === 'aurum').map((w) => w.id), 'AURUM-ONLY: a pack was the one thing money bought');
  assert.ok(SHOP_WARES.every((w) => (w.cash ? w.price === 0 && w.cents > 0 : w.cents === 0 && w.price > 0)), 'a ware has one price, in its one currency');
  // AUDIT-STOREFRONT II (the owner, 2026-10-29: "the most expensive anything should be is $30"): no ware over the cap -
  // AURUM-ONLY, a pack in cents and any other ware in Aurum at $1 = 100 Aurum, each a whole dollar's worth
  assert.equal(SHOP_PRICE_CAP, 3000);
  assert.equal(SHOP_AURUM_PER_DOLLAR, 100);
  assert.equal(SHOP_AURUM_CAP, 3000);
  for (const w of SHOP_WARES) {
    if (w.cash) assert.ok(w.cents <= SHOP_PRICE_CAP, `${w.id}: ${shopPriceText(w.cents)} - over the cap`);
    else assert.ok(w.price <= SHOP_AURUM_CAP && w.price % SHOP_AURUM_PER_DOLLAR === 0, `${w.id}: ${w.price} Aurum`);
  }
  assert.ok(SHOP_WARES.filter((w) => w.cash).every((w) => !shopOwns(SHOP_BITS_ALL, w.id)), 'a pack is never owned, whatever the row holds');
  assert.deepEqual(SHOP_WARES.filter((w) => w.aurum).map((w) => [w.id, w.aurum]), [['aurum:500', 500], ['aurum:1100', 1100], ['aurum:2400', 2400], ['aurum:3900', 3900]]);
  assert.equal(SHOP_BITS_ALL, 511);
  assert.ok(shopVocabularyOk());
  assert.deepEqual(shopHeldOf(5), ['title:genesis', 'aura:eternal']);
  assert.deepEqual(shopHeldOf(512), [], 'a bit no ware has holds nothing');
  for (const bad of [null, undefined, '', -1, 1.5, 'x']) assert.deepEqual(shopHeldOf(bad), []);
  assert.deepEqual(shopKeysOf(7, 'glyph'), ['origin']);
  assert.deepEqual(shopOnSaleOf(' aura:eternal , nope:x,title:genesis,glyph:oblivion'), ['title:genesis', 'aura:eternal'], 'in the wares\' order, unknown words and a bundle\'s own ware dropped');
  assert.deepEqual(shopOnSaleOf(''), []);
  assert.equal(shopPriceText(500), '$5.00');
  assert.equal(shopPriceText(2000), '$20.00');
});

test('SHOP: a ware bought is held off the row\'s bits - the title, the glyph true of the account, the aura - and may be worn; a guest\'s row holds none (mutants: the handle guard dropped; a kind read as another)', () => {
  const bought = row({ shop_wares: 7 });
  assert.ok(titlesHeld(bought, {}).includes('genesis'));
  assert.ok(aurasHeld(bought, {}).includes('eternal'));
  assert.ok(glyphsOf(bought, {}, AFTER).includes('origin'));
  assert.equal(equipRefusal('genesis', bought, {}), null);
  assert.equal(auraRefusal('eternal', bought, {}), null);
  const one = row({ shop_wares: 2 });
  assert.ok(!titlesHeld(one, {}).includes('genesis') && glyphsOf(one, {}, AFTER).includes('origin') && !aurasHeld(one, {}).includes('eternal'));
  const guest = row({ handle: null, shop_wares: 7 });
  assert.ok(!titlesHeld(guest, {}).includes('genesis') && !aurasHeld(guest, {}).includes('eternal') && !glyphsOf(guest, {}, AFTER).includes('origin'));
  assert.equal(equipRefusal('genesis', row(), {}), 'not-held');
});

test('SHOP: the card the client reads keeps only the shop\'s own wares and https links, and offers no Buy for a ware held or off sale; AURUM-ONLY, a link a pack\'s alone and an item\'s price in Aurum, never past its own (PIN MOVED: the packs the linked wares) (mutants: a link kept off sale; an http link; an item linked)', () => {
  assert.equal(clientCard(null), null);
  const c = clientCard({ on: true, wares: [
    { id: 'aurum:500', sale: true, held: false, buy: 'https://x/v1/shop/buy?t=1', cents: 499 },
    { id: 'aurum:1100', sale: false, held: false, buy: 'https://x/2' },
    { id: 'aurum:2400', sale: true, held: false, buy: 'http://x/3' },
    { id: 'title:founder', sale: true, held: false, buy: 'https://x/4' },
    { id: 'aurum:500', sale: true, held: false, buy: 'https://x/5' },
    { id: 'title:genesis', sale: true, held: false, buy: 'https://x/6', price: 500 },
    { id: 'kill:pyre', sale: true, held: false, price: 1125, deal: true },
    { id: 'kill:ashen', sale: true, held: false, price: 9999, deal: 'yes' },
  ] });
  assert.deepEqual(c.wares.map((w) => [w.id, w.buy]), [['aurum:500', 'https://x/v1/shop/buy?t=1'], ['aurum:1100', null], ['aurum:2400', null], ['title:genesis', null], ['kill:pyre', null], ['kill:ashen', null]], 'one row a ware, off sale no link, an http link none, an item none');
  assert.deepEqual(c.wares.filter((w) => !w.id.startsWith('aurum:')).map((w) => [w.id, w.price, w.deal]), [['title:genesis', 500, false], ['kill:pyre', 1125, true], ['kill:ashen', 500, false]], 'an item\'s price never past its own, a deal only so said');
  assert.equal(clientCard({ on: true, wares: [{ id: 'aurum:500', sale: true, held: true, buy: 'https://x/3' }] }).wares[0].buy, null, 'held, no Buy');
  assert.equal(clientCard({ on: false, wares: [{ id: 'aurum:500', sale: true, held: false, buy: 'https://x/1' }] }).wares[0].buy, null);
});

// ── DFO-84: THE CARD WITHOUT STRIPE ──────────────────────────────────

test('SHOP, DFO-84: the server\'s own card is always `on: false`, reads no Stripe secret and asks no outside service - a pack is told (so the window can still say "sold out") but never carries a Buy link, and an item still prices in Aurum as before (mutants: `on` true; a pack given a link; an outbound fetch; an item\'s price lost)', async () => {
  let fetched = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (...a) => { fetched++; return realFetch(...a); };
  try {
    const nowS = Math.floor(Date.now() / 1000);
    // no Stripe secret anywhere in env - startup/login and this card never needed one
    const card = await shopCardOf({ id: 'p', handle: 'NoStripe' }, { SHOP_ON_SALE: SHOP_WARES.filter((w) => w.alone).map((w) => w.id).join(',') }, { nowS });
    assert.equal(card.on, false, 'there is no way left to pay');
    assert.ok(card.wares.length > 0, 'items still price in Aurum and are still told');
    for (const w of card.wares) assert.equal(w.buy ?? null, null, `${w.id}: no link was ever reachable`);
    const items = card.wares.filter((w) => !w.id.startsWith('aurum:'));
    assert.ok(items.length > 0 && items.every((w) => typeof w.price === 'number' && w.price > 0), 'AURUM-ONLY pricing is untouched');
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(fetched, 0, 'reading the card never reaches outside this service');
});
