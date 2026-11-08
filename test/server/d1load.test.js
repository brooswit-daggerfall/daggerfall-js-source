// D1-LOAD (2026-10-11, from play: the account service stayed slow after SEAT-CAP and SEAT-LEASE; the owner: "do
// whatever is the most detailed. I dont want band aid fixes") - WHAT IS FILLING THE ONE DATABASE, READ BY THE OPERATOR:
// tools/d1Load.mjs builds the Analytics Engine questions over the service's own metrics points (metrics.js) and
// .github/workflows/d1-load.yml asks them by hand, beside D1's query insights, writing nothing.
// bible/01-Overview/bugs/Field-Bugs-2026-10-11h.md D1-LOAD.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DATASET, HOURS_MAX, QUESTIONS, loadHours, loadSql, loadTable } from '../../tools/d1Load.mjs';
import { standService, T0 } from '../accountDb.mjs';
import { confirmedSeats, SEAT_ROWS_KEPT_S, SEAT_ROWS_SQL, SEAT_JUDGED_SQL } from '../../server-account/src/townSeats.js';
import { HOT_TABLES, tablesBlob } from '../../server-account/src/metrics.js';
import { titheAt } from '../../server-account/src/seatHolding.js';
import { settleWeek, settleDueOnce } from '../../server-account/src/seatTurning.js';
import { seatReportText, seatWeekOf, seatWeekStartMs } from '../../src/net/townSeatLaw.js';

const src = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('D1-LOAD the questions: each over the service\'s own dataset and window, every count and sum weighted by the sample, the D1 wait (double5) in seconds most first, the minute row, the clock\'s jobs, the errors, the rows written by route and tables (COST-0: blob5 the tables a request wrote, double8-11 the hot tables\' own); the window whole hours 1 to a week, anything else refused before it reaches the SQL; an answer drawn as its columns, none said so, a refusal thrown (mutants: the weight; the wait\'s double; the order; the window\'s guard; the empty answer; the tables\' blob; a hot table\'s double; the written rows\' order; the points that wrote)', () => {
  assert.equal(DATASET, src('server-account/wrangler.toml').match(/\[\[analytics_engine_datasets\]\]\nbinding = "METRICS"\ndataset = "(\w+)"/)[1], 'the dataset the service writes');
  assert.deepEqual(QUESTIONS.map(([n]) => n), ['routes', 'minutes', 'cron', 'errors', 'written']);
  for (const [name] of QUESTIONS) {
    const sql = loadSql(name, 3);
    assert.match(sql, new RegExp(`FROM ${DATASET} WHERE timestamp > NOW\\(\\) - INTERVAL '3' HOUR`));
    assert.match(sql, / FORMAT JSON$/);
    for (const [sum] of sql.matchAll(/SUM\(.*? AS \w+/g)) assert.match(sum, /_sample_interval/, `${name}: ${sum} weighted by the sample`);
  }
  const routes = loadSql('routes', 1);
  assert.match(routes, /SUM\(double5 \* _sample_interval\) \/ 1000 AS d1_wait_s/, 'the D1 wait is double5, in seconds');
  assert.match(routes, /SUM\(double3 \* _sample_interval\) AS statements/);
  assert.match(routes, /ORDER BY d1_wait_s DESC/);
  assert.match(loadSql('minutes', 1), /toStartOfInterval\(timestamp, INTERVAL '1' MINUTE\) AS minute/);
  assert.match(loadSql('cron', 1), /AND blob2 = 'CRON'/, 'the clock\'s points (cron.js: `CRON` its method)');
  assert.match(loadSql('errors', 1), /NOT startsWith\(blob3, '2'\)/);
  // COST-0: the rows written - blob5 the tables a request wrote (metrics.js tablesBlob), each hot table its own double in
  // HOT_TABLES' order (metrics.js writes them after its seven), weighted, over the points that wrote, the most first
  const written = loadSql('written', 2);
  assert.ok(written.startsWith('SELECT blob1 AS route, blob5 AS tables, SUM(_sample_interval) AS requests, SUM(double4 * _sample_interval) AS rows_written, '), written);
  HOT_TABLES.forEach((t, i) => assert.ok(written.includes(`SUM(double${8 + i} * _sample_interval) AS ${t}`), `${t} is double${8 + i}`));
  assert.ok(written.endsWith("WHERE timestamp > NOW() - INTERVAL '2' HOUR AND double4 > 0 GROUP BY route, tables ORDER BY rows_written DESC LIMIT 40 FORMAT JSON"), written);
  assert.deepEqual([...written.matchAll(/ AS (\w+)/g)].map((x) => x[1]), QUESTIONS.find(([n]) => n === 'written')[2], 'its columns are what it selects');
  assert.equal(tablesBlob({ sessions: 1, players: 3 }), 'players:3 sessions:1', 'blob5 as metrics.js writes it');
  assert.equal(loadHours(''), 1);
  assert.equal(loadHours(' 24 '), 24);
  assert.equal(loadHours(String(HOURS_MAX)), HOURS_MAX);
  for (const bad of ['0', String(HOURS_MAX + 1), '1.5', '-1', "1' HOUR; --", 'x']) assert.throws(() => loadSql('routes', bad), /not a window/, bad);
  assert.throws(() => loadSql('nope', 1), /no question/);
  const t = loadTable('routes', { data: [{ route: '/v1/heartbeat', method: 'POST', requests: '1200', d1_wait_s: '340.55', statements: 4800, rows_read: 0, rows_written: 2, p95_ms: 812.33 }] });
  assert.match(t, /\| route \| method \| requests \| d1_wait_s \| statements \| rows_read \| rows_written \| p95_ms \|/);
  assert.match(t, /\| \/v1\/heartbeat \| POST \| 1,200 \| 340\.6 \| 4,800 \| 0 \| 2 \| 812\.3 \|/);
  assert.match(loadTable('cron', { data: [] }), /No points in the window\./);
  assert.throws(() => loadTable('routes', { errors: [{ message: 'Authentication error' }] }), /carries no rows/);
});

// DFO-83 (2026-11-07): .github/workflows/d1-load.yml was removed as part of the inherited-operational-Actions
// cleanup, along with this file's test of its by-hand dispatch, inputs, insights step and metrics step - those
// were pure workflow-content assertions with nothing surviving independent of the deleted file.

const ENV = { SEATS_OPEN: 'on' };
const ANTICLERE = { key: 3021, name: 'Anticlere', region: 21, tier: 'palace', pixel: [402, 151] };
const seatRead = (sql) => sql === SEAT_ROWS_SQL || sql === SEAT_JUDGED_SQL;   // LEAN-WITNESS (PIN MOVED): the rows the law judges by are a read of them
/** The service with Anticlere confirmed and held by a guild, its seat witness reads counted (`c.n`). */
async function heldSeat() {
  const svc = await standService(ENV);
  const raw = svc.env.DB._raw;
  for (const w of [await svc.guest(), await svc.guest(), await svc.guest()]) {
    raw.prepare("INSERT INTO world_witness (kind, key, account, report, region, at) VALUES ('seat', ?, ?, ?, ?, ?)").run(String(ANTICLERE.key), w.id, seatReportText(ANTICLERE), ANTICLERE.region, T0 - 86400);
  }
  raw.prepare("INSERT INTO guilds (id, name, name_key, tag, ranks, founded_at) VALUES ('g1', 'Holders', 'holders', 'HO', '[]', 1)").run();
  raw.prepare("INSERT INTO town_seat_holds (key, guild_id, region, tier, since_week, standing, tithe, at) VALUES (?, 'g1', ?, 'palace', 1, 50, 5, 1)").run(ANTICLERE.key, ANTICLERE.region);
  const base = svc.env.DB;
  const c = { n: 0, sql: [] };
  const db = Object.create(base);
  db.prepare = (sql) => { if (seatRead(sql)) c.n++; c.sql.push(sql); return base.prepare(sql); };
  db.batch = (l) => base.batch(l);
  return { svc, raw, db, c };
}

test('D1-LOAD THE SEATS\' WITNESS ROWS ARE READ ONCE A MINUTE FOR EVERY CALLER: a market sale\'s Tithe in a held seat\'s region - which read all of them on every sale from the moment its first Charter was held - a standings and a pledge share the isolate\'s kept rows; a minute on, read again; the Turning reads the table as it stands (mutants: the default kept; the Turning fresh)', async () => {
  const { db, c } = await heldSeat();
  const t1 = await titheAt(db, T0, ANTICLERE.region, ANTICLERE.pixel);
  assert.deepEqual([t1?.key, t1?.guild, t1?.pct], [ANTICLERE.key, 'g1', 5], 'the Tithe is the holder\'s');
  assert.equal(c.n, 1);
  for (let i = 0; i < 20; i++) await titheAt(db, T0 + i, ANTICLERE.region, ANTICLERE.pixel);
  assert.equal((await confirmedSeats(db, T0 + 30)).has(ANTICLERE.key), true);
  assert.equal(c.n, 1, 'twenty sales and a standings inside the minute: the one read');
  await titheAt(db, T0 + SEAT_ROWS_KEPT_S, ANTICLERE.region, ANTICLERE.pixel);
  assert.equal(c.n, 2, 'a minute on: read again');
  await settleWeek(db, seatWeekOf(T0 * 1000) - 1, T0 + SEAT_ROWS_KEPT_S + 1);   // inside the minute the rows were kept
  assert.equal(c.n, 3, 'the Turning: the table as it stands, whatever this isolate kept');
});

test('D1-LOAD THE LEASE IS READ BEFORE IT IS ASKED OF THE WRITER: while another holds it, a caller that finds the week due reads the lease and answers pending with no write; one whose read raced the other\'s take (it read the lease free) is still held off by the write\'s own WHERE (mutants: the read; the WHERE)', async () => {
  const { db, raw, c } = await heldSeat();
  const W = seatWeekOf(T0 * 1000);
  const atS = Math.floor(seatWeekStartMs(W + 1) / 1000) + 60;
  raw.prepare("INSERT INTO town_seat_settling (id, holder, until) VALUES (1, 'another', ?)").run(atS + 30);
  c.sql.length = 0;
  assert.deepEqual(await settleDueOnce(db, atS), { settled: 0, pending: true });
  assert.deepEqual(c.sql.filter((q) => /^\s*(INSERT|UPDATE|DELETE)/i.test(q)), [], 'no write asked while the lease is held');
  // a racer: its read answered before the other's take landed
  const racer = Object.create(db);
  racer.prepare = (sql) => (/^SELECT until FROM town_seat_settling/.test(sql) ? { bind: () => ({ first: async () => null }), first: async () => null } : db.prepare(sql));
  racer.batch = (l) => db.batch(l);
  assert.deepEqual(await settleDueOnce(racer, atS), { settled: 0, pending: true }, 'the write\'s WHERE holds it off');
  assert.equal(raw.prepare('SELECT holder FROM town_seat_settling').get().holder, 'another', 'the lease still the other\'s');
});
