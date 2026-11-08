// AUDIT AURUM-SPEND (2026-10-31, the owner: "Can we also do a deep comprehensive audit across everything to ensure perfection
// before we ship this?"): the money and spending lane's findings. F5 a debt left out of "need"; F6 an aurum-short refusal
// kept the old balance. tools/mutants/audit_aurum_spend.json.
// DFO-84 (2026-11-08): F1, F2 and F4 pinned how a legacy MONEY order's refund/dispute/chargeback interacted with an
// Aurum-paid credit or mark, each driven through Stripe's webhook (shop.js shopWebhook, fulfilOrder, revokeOrder,
// restoreOrder) - all now removed with the rest of the Stripe integration, so those three findings no longer have
// a path to exercise and are removed with it.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SHOP_WARES, shopWareById } from '../../src/net/shopLaw.js';
import { aurumCardOf, aurumDailyOf, aurumPriceOf } from '../../src/net/aurumLaw.js';
import { shopWareState } from '../../src/ui/enhanced/enhancedShop.js';
import { passItemState } from '../../src/ui/enhanced/enhancedPass.js';
import { AccountFlow } from '../../src/ui/accountFlow.js';
import { SESSION_KEY } from '../../src/net/accountClient.js';

const NOW = Date.UTC(2026, 10, 18, 12);

// ── THE CLIENT ──
const DAY = Math.floor(NOW / 86_400_000);
const WARES = aurumDailyOf(DAY, () => true);
const shopCard = () => ({ on: true, wares: SHOP_WARES.filter((w) => w.alone).map((w) => (w.cash ? { id: w.id, sale: true, held: false, buy: `https://accounts.invalid/v1/shop/buy?t=${w.key}`, cents: w.cents }
  : { id: w.id, sale: true, held: false, price: WARES.includes(w.id) ? aurumPriceOf(w.id) : w.price, deal: WARES.includes(w.id) })), featured: [] });
const aurum = (balance) => aurumCardOf({ open: true, balance, daily: { until: (DAY + 1) * 86_400_000, wares: WARES.map((id) => ({ id, held: false })) }, week: { until: 1, deeds: {} } });


test('AUDIT AURUM-SPEND F5, F6: with a debt, "need" is the price and the debt; an aurum-short refusal reads the account again, so the panel stops offering Buy (mutants: the debt left out, the refusal not read again)', async () => {
  const base = { stage: 'in', account: { handle: 'Owing', kind: 'linked' }, wardrobe: { titles: [], glyphs: [], auras: [], icons: [], effectsHeld: { kill: [], portal: [], mount: [] } }, shop: shopCard(), busy: false, aurum: aurum(-3500),
    pass: { season: 's1', open: true, stage: 0, tracks: { free: true, premium: false }, bought: [], today: 0, dayMax: 100, spent: { free: 0, premium: 0 }, challenges: [] } };
  const icon = /** @type {any} */ (shopWareById('icon:whitegold'));
  const st = /** @type {any} */ (shopWareState(base, icon));
  assert.deepEqual([st.state, st.need], ['short', st.price + 3500]);
  const ps = /** @type {any} */ (passItemState(base, 's1', 'glyph:cog', NOW));
  assert.equal(ps.need, ps.price + 3500);
  let balance = 1450, reads = 0, answer = null;
  const card = () => ({ open: true, balance, daily: { until: (DAY + 1) * 86_400_000, wares: WARES.map((id) => ({ id, held: false })) }, week: { until: 1, deeds: {} } });
  const acct = () => ({ account: { id: 'a1', name: 'Aelwyn', kind: 'linked', handle: 'Aelwyn' }, wardrobe: { titles: [], glyphs: [], auras: [], icons: [] }, devices: [], shop: shopCard(), aurum: card() });
  const fetch = async (url) => { const p = new URL(url).pathname; if (p === '/v1/account') { reads++; return Response.json(acct()); } if (p === '/v1/aurum/buy') return answer(); return Response.json({ ok: true }); };
  const m = new Map([[SESSION_KEY, JSON.stringify({ id: 'a1', name: 'Aelwyn', kind: 'linked', sessionId: 's1', secret: 'sec' })]]);
  const flow = AccountFlow({ io: { fetch, base: 'https://accounts.invalid' }, storage: { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) } });
  await flow.start();
  const ware = /** @type {any} */ (shopWareById('mount:spectral'));
  balance = 200;
  answer = () => Response.json({ error: 'aurum-short', balance: 200 }, { status: 409 });
  const r0 = reads;
  await flow.buyWare(ware.id, ware.price);
  assert.ok(reads > r0, 'read again');
  assert.deepEqual([flow.aurum.balance, shopWareState(flow, ware).state], [200, 'short']);
});
