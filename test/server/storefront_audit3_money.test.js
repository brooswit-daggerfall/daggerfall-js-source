// AUDIT-STOREFRONT III (lane A, 2026-10-30; bible/01-Overview/audits/Audit-Storefront.md): THE MONEY, at ec9ab3de0. Each
// case drives the real Worker on node:sqlite: the Folios shut with Aurum, a limited ware's window shut mid-day, and a
// find's answer naming its day.
// DFO-84 (2026-11-08): A4 (a dispute's words in any order), A5 (a ware Aurum paid for kept through a money refund), A6
// (the money page an Aurum buy leaves open) and the pack's-words half of A7 all drove Stripe's webhook, a refund or
// closeStale's session-expiry call - every one of those paths is removed with the rest of the Stripe integration, so
// those findings no longer have anything left to exercise and are removed with it.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { standService } from '../accountDb.mjs';
import { dailySaleOf } from '../../server-account/src/aurum.js';
import { shopDemand } from '../../server-account/src/staffShop.js';
import { SHOP_WARES } from '../../src/net/shopLaw.js';
import { passSeasonById } from '../../src/net/battlePassLaw.js';
import { utcDay } from '../../src/net/marksLaw.js';

const ON = { SHOP_ON_SALE: SHOP_WARES.filter((w) => w.alone).map((w) => w.id).join(','), PASS_OPEN: 'on', AURUM_OPEN: 'on' };
async function stand(env = ON) {
  const s = await standService(env);
  const raw = s.env.DB._raw;
  const ask = (who, path, body) => s.fetch(`https://accounts.invalid${path}`, body === undefined
    ? { headers: { authorization: `Bearer ${who.secret}` } }
    : { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${who.secret}` }, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, body: await r.json() }));
  const give = (who, aurum) => raw.prepare("INSERT INTO aurum_ledger (account, kind, ref, amount, day, at) VALUES (?, 'cache', ?, ?, 0, 0)").run(who.id, `t${Math.random()}`, aurum);
  const spent = (who) => raw.prepare('SELECT COUNT(*) AS n FROM aurum_ledger WHERE account = ? AND amount < 0').get(who.id).n;
  return { ...s, raw, ask, give, spent };
}

test('AUDIT-STOREFRONT III A1: Aurum shut (or a developer\'s alone) shuts the Folios\' unlock and buys too, as the window reads it - nothing spent (mutants: the Folios\' gate asking PASS_OPEN alone)', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: passSeasonById('s1').fromMs + 5 * 86_400_000 });
  for (const AURUM_OPEN of ['off', 'dev']) {
    const s = await stand({ ...ON, AURUM_OPEN });
    const me = await s.registered(`Shut${AURUM_OPEN}`);
    s.give(me, 3000);
    const unlock = await s.ask(me, '/v1/pass/unlock', { season: 's1' });
    const buy = await s.ask(me, '/v1/pass/buy', { season: 's1', grant: 'glyph:cog' });
    assert.deepEqual([unlock.status, unlock.body.error, buy.status, buy.body.error], [409, 'pass-closed', 409, 'pass-closed'], AURUM_OPEN);
    assert.equal(s.spent(me), 0, `${AURUM_OPEN}: no Aurum spent`);
  }
});

test('AUDIT-STOREFRONT III A3: a limited ware is a daily ware only on a UTC day its window holds whole - a window shutting mid-day sells it that day for neither (mutants: the window read at the day\'s first instant)', () => {
  const env = { ...ON, SHOP_FEATURED: 'mount:warhorse 2026-11-09T00:00Z 2026-11-12T18:00Z limited' };
  const sale = dailySaleOf(env), day = (d) => utcDay(Date.UTC(2026, 10, d, 12) / 1000);
  assert.deepEqual([9, 10, 11, 12, 13].map((d) => sale.eligible('mount:warhorse', day(d))), [true, true, true, false, false]);
});

test('AUDIT-STOREFRONT III B4: a find\'s answer names the UTC day its `today` counts, asked again too; one not yet answered says its day and no `today` (mutants: the day left off)', async (t) => {
  const at = passSeasonById('s1').fromMs + 3 * 86_400_000 + 3_600_000;
  t.mock.timers.enable({ apis: ['Date'], now: at });
  const s = await stand();
  const me = await s.seated('Finder');   // a find is a seated character's (the progression route)
  const first = await s.ask(me, '/v1/pass/find', { source: 'foe', rid: '0123456789abcdef' });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.day, utcDay(at / 1000));
  const again = await s.ask(me, '/v1/pass/find', { source: 'foe', rid: '0123456789abcdef' });
  assert.deepEqual([again.body.repeat, again.body.day, again.body.today], [true, utcDay(at / 1000), first.body.today]);
  s.raw.prepare('INSERT INTO pass_asks (account, rid, day) VALUES (?, ?, ?)').run(me.id, 'fedcba9876543210', utcDay(at / 1000));
  const pending = await s.ask(me, '/v1/pass/find', { source: 'foe', rid: 'fedcba9876543210' });
  assert.deepEqual([pending.body.repeat, pending.body.day, pending.body.today], [true, utcDay(at / 1000), undefined]);
});

test('AUDIT-STOREFRONT III A7: the staff demand lists no daily wares for a day before the rotation ran (mutants: the first day\'s wares lent to the days before it)', async () => {
  const s = await stand();
  const d = await shopDemand(s.env.DB, s.env, Date.UTC(2026, 9, 2, 12) / 1000, 4);
  assert.deepEqual(d.days.map((r) => r.daily.length), [0, 0, 5, 5], '29 and 30 September none; 1 and 2 October five');
});
