// @ts-check
// SHOP (2026-10-28, the owner: "A new glyph panel alongside the timer and mailbox that will be used for our monetization
// shop ... with a strict disclaimer that all proceeds go towards development costs"; bible/06-Systems/Shop.md): THE
// SHOP'S SIDE OF THE SERVICE. What a ware is lives in src/net/shopLaw.js.
// DFO-84 (2026-11-08): the money side - Stripe checkout, its webhook, refunds and the sealed Buy ticket - is removed.
// Nothing here takes a payment or holds a Stripe secret any more; AURUM-ONLY already meant money ever bought only the
// Aurum packs (aurum.js buyWare sells every other ware), so this file now answers only the card's Aurum-priced rows -
// a pack's own row carries no link and no price, because there is no way left to buy one.
import {
  SHOP_WARES,
  shopOwns,
  shopOnSaleOf,
  shopFeaturedOf,
  shopFeaturedNow,
  shopSellable,
  shopDropped,
} from '../../src/net/shopLaw.js';
import { aurumSwitchOf } from '../../src/net/aurumLaw.js'; // AURUM: its packs are sold while it is open to every account
import { dailyWaresAt, aurumPriceAt } from './aurum.js'; // AURUM-ONLY: a ware's Aurum price on the card, today's deals
import { holdsAll } from './titles.js'; // ADMIN-ALL: an admin holds every ware, so is sold none

/** THE DISCLAIMER, in English: the service's pages (what few remain) and the window say it through the text core (a pin
 *  holds the two equal). */
export const SHOP_PROCEEDS = 'All proceeds go to the costs of developing DFO Online.';
/** And what a ware is - and is not. */
export const SHOP_COSMETIC = 'Every item is cosmetic. It gives no power in the game.';

const registered = (/** @type {any} */ p) => typeof p?.handle === 'string' && !!p.handle;

/** The wares on sale now (SHOP_ON_SALE in wrangler.toml - the owner ends a sale by taking an id off). */
export const shopOnSale = (/** @type {any} */ env) => shopOnSaleOf(env?.SHOP_ON_SALE);
/** STOREFRONT: the featured schedule (SHOP_FEATURED in wrangler.toml - the owner's launch windows, limited or not). */
export const shopFeatured = (/** @type {any} */ env) => shopFeaturedOf(env?.SHOP_FEATURED);
/** AURUM: an Aurum pack is sold only while Aurum is open to every account (AURUM_OPEN 'on') - Aurum nobody can spend
 *  is no sale. */
const aurumShut = (/** @type {any} */ env, /** @type {any} */ w) =>
  w?.kind === 'aurum' && aurumSwitchOf(env?.AURUM_OPEN) !== 'on';
/** STOREFRONT: whether a ware is sold at `nowS` (shopLaw.js shopSellable: on sale, inside a limited window). */
export const shopSoldNow = (/** @type {any} */ env, /** @type {any} */ w, /** @type {number} */ nowS) =>
  shopSellable(w, shopOnSale(env), shopFeatured(env), nowS * 1000) && !aurumShut(env, w);
/** STOREFRONT: THE CAROUSEL'S WARES at `nowS`, in order: the schedule's featured wares in its order - each sold now (a
 *  ware featured but off sale is not shown). PASS-PANELS: the pass sells nothing for money, so it leads it no more. */
export function shopCarousel(/** @type {any} */ env, /** @type {number} */ nowS) {
  /** @type {string[]} */ const ids = [];
  for (const e of shopFeaturedNow(shopFeatured(env), nowS * 1000)) if (!ids.includes(e.id)) ids.push(e.id);
  return ids.filter((id) => shopSoldNow(env, /** @type {any} */ (SHOP_WARES.find((w) => w.id === id)), nowS));
}

/** ADMIN-ALL: does this account hold a ware - bought, or as an admin every ware but a pack of Aurum, a currency and never
 *  held (titles.js holdsAll). The card asks it, so an admin is sold nothing it holds. */
export const shopHolds = (/** @type {any} */ player, /** @type {any} */ env, /** @type {any} */ w) =>
  shopOwns(player, w.id) || (!w.cash && holdsAll(player, env));

/**
 * THE SHOP'S CARD in the account read: `{ on, wares }`. DFO-84: `on` is always false and a pack (`w.cash`) always
 * carries `buy: null` - there is no longer a way to pay, so no page is ever opened. AURUM-ONLY: any other ware's
 * `price` this account's (a giver's share; a quarter off on its deal day, `deal`).
 */
export async function shopCardOf(/** @type {any} */ player, /** @type {any} */ env, { nowS }) {
  const schedule = shopFeatured(env),
    live = shopFeaturedNow(schedule, nowS * 1000),
    deals = dailyWaresAt(env, nowS);
  const wares = [];
  for (const w of SHOP_WARES) {
    if (!w.alone) continue; // STOREFRONT: a ware sold only in a bundle has no row of its own
    const isHeld = registered(player) && shopHolds(player, env, w),
      onSale = shopSoldNow(env, w, nowS) || deals.includes(w.id); // ARMORY: a set's pieces, or the set's through its pieces; STOREFRONT: a bundle's wares; ADMIN-ALL
    if (!isHeld && !onSale && (!shopDropped(w, schedule, nowS * 1000) || aurumShut(env, w))) continue; // AUDIT-STOREFRONT S2: nothing upcoming is told; AURUM: no pack while Aurum is shut
    const feat = onSale ? live.find((e) => e.id === w.id) : null; // AUDIT-STOREFRONT S9: a window's end only beside a sale
    const win = feat ? { until: feat.toMs, limited: feat.limited } : {};
    if (!w.cash) {
      // AURUM-ONLY: no link - the window buys it for Aurum (aurum.js buyWare) at this account's price
      const at = isHeld ? null : aurumPriceAt(registered(player) ? player : null, w, deals);
      wares.push({
        id: w.id,
        sale: onSale,
        held: isHeld,
        price: at?.price ?? w.price,
        ...(at?.deal ? { deal: true } : {}),
        ...win,
      });
      continue;
    }
    // DFO-84: a pack is told (it may still be owed its place on the card for a day it is told), but never buyable
    wares.push({ id: w.id, sale: onSale, held: false, buy: null, cents: w.cents, ...win });
  }
  return { on: false, wares, featured: shopCarousel(env, nowS) };
}
