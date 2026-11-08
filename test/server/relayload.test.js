// RELAY-LOAD (2026-10-18, from play: "Server is kinda breaking down near oblivion gate cause so many ppl lol") - WHAT IS
// FILLING THE RELAY, READ BY THE OPERATOR: tools/relayLoad.mjs builds the Analytics Engine questions over the relay's own
// metrics points (server/src/relayScale.js RoomMetrics) and .github/workflows/relay-load.yml asks them by hand, writing
// nothing. bible/11-Multiplayer/Scale-Arc.md RELAY-LOAD; AUDIT PLAN-1000 lane A (its block under RELAY-LOAD there, and `01-Overview/Audit-Log.md`)
// widened every pin below to reach what its title claims.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DATASET, QUESTIONS, WINDOW_KINDS, WINDOW_HOURS_MAX, loadSql, loadTable } from '../../tools/relayLoad.mjs';
import { HOURS_MAX } from '../../tools/d1Load.mjs';
import { RoomMetrics } from '../../server/src/relayScale.js';

const src = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

/** What each alias of the questions is, as RoomMetrics writes its point: the column a sum or a value reads. */
const DOUBLE_OF = { sockets: 2, hellos: 3, busy: 4, poses: 7, sends: 8, refused: 12, room_full: 13, drops: 14, peak: 15 };

test('RELAY-LOAD the questions: each over the relay\'s own dataset and window, its columns exactly the aliases it selects, every alias the double RoomMetrics writes for it in EVERY question (a sum weighted by the sample, a row\'s value and a peak its room\'s own), the kind blob1; the kinds by their sends, the five-minute rows of the crowd\'s kinds over at most WINDOW_HOURS_MAX - every row of the span, never cut - the busiest rooms but the channels by their peak; the window whole hours 1 to a week, refused before the SQL; an answer drawn as its columns (mutants: the weight; a double moved in any question; a count unweighted; a column renamed; the IF; the orders; the limits; the span; the channels left in the crowds; the window\'s guard)', () => {
  assert.equal(DATASET, src('server/wrangler.toml').match(/\[\[analytics_engine_datasets\]\]\nbinding = "METRICS"\ndataset = "(\w+)"/)[1], 'the dataset the relay writes');
  assert.deepEqual(QUESTIONS.map(([n]) => n), ['kinds', 'windows', 'crowds', 'fulls', 'storage', 'levels', 'moves']);   // PIN MOVED (COST-2 part two): the cells by their node's level, and the directory's moves - test/server/cellmoves.test.js

  // THE DOUBLES ARE THE ONES ROOMMETRICS WRITES: a point flushed with every count its own value, read back by position
  let point = null;
  const m = new RoomMetrics(0);
  Object.assign(m.c, { hellos: 3, busy: 4, frames: 5, bytesIn: 6, poses: 7, sends: 8, bytesOut: 9, reads: 10, writes: 11, refusals: 12, full: 13, drops: 14, peak: 15 });
  m.flush({ writeDataPoint: (p) => { point = p; } }, 'world', 2, 'v', 1000, true);
  assert.equal(point.blobs[0], 'world', 'blob1 the kind');
  for (const [, k] of Object.entries(DOUBLE_OF)) assert.equal(point.doubles[k - 1], k, `double${k}`);
  assert.deepEqual([point.doubles[8], point.doubles[9], point.doubles[10]], [9, 10, 11], 'bytes out, reads, writes');

  for (const [name, , cols] of QUESTIONS) {
    const sql = loadSql(name, 3);
    assert.match(sql, new RegExp(`FROM ${DATASET} WHERE timestamp > NOW\\(\\) - INTERVAL '3' HOUR`));
    assert.match(sql, / FORMAT JSON$/);
    assert.deepEqual([...sql.matchAll(/ AS (\w+)/g)].map((x) => x[1]), cols, `${name}: its columns are what it selects`);
    assert.doesNotMatch(sql, /COUNT\(/, `${name}: a count is a sum of the sample`);
    for (const [sum] of sql.matchAll(/SUM\(.*? AS \w+/g)) assert.match(sum, /_sample_interval/, `${name}: ${sum} weighted by the sample`);
    assert.match(sql, /blob1 AS kind/, `${name}: the kind is blob1`);
    for (const [as, k] of Object.entries(DOUBLE_OF)) {
      if (!cols.includes(as)) continue;
      const want = as === 'peak' ? (name === 'crowds' ? 'double15 AS peak' : 'MAX(double15) AS peak') : name === 'crowds' ? `double${k} AS ${as}` : `SUM(double${k} * _sample_interval) AS ${as}`;
      assert.ok(sql.includes(` ${want}`) || sql.includes(`, ${want}`), `${name}: ${as} is double${k} (${want})`);
    }
  }
  const kinds = loadSql('kinds', 1);
  assert.ok(kinds.includes(', SUM(_sample_interval) AS room_windows,'), 'the room-windows a weighted count');
  assert.ok(kinds.includes('IF(SUM(double7 * _sample_interval) > 0, SUM(double8 * _sample_interval) / SUM(double7 * _sample_interval), 0.0) AS sends_per_pose'), 'sends over poses, and both arms of the IF a Double: the SQL API refuses a Double beside an Integer (HTTP 422, met live on 2026-10-18)');
  assert.ok(kinds.includes('SUM(double9 * _sample_interval) / 1000000 AS mb_out'));
  assert.ok(kinds.includes('SUM((double10 + double11) * _sample_interval) AS storage'));
  assert.match(kinds, /GROUP BY kind ORDER BY sends DESC LIMIT 40 FORMAT JSON$/);

  // THE FIVE-MINUTE ROWS: the crowd's kinds over the span, every row of it (twelve buckets an hour a kind, and the bucket
  // the window begins inside) - the span the asked hours, at most WINDOW_HOURS_MAX, said in the title
  assert.deepEqual([...WINDOW_KINDS], ['world', 'gate', 'chat']);
  assert.equal(WINDOW_HOURS_MAX, 24);
  for (const [h, span] of [[1, 1], [6, 6], [24, 24], [48, 24], [HOURS_MAX, 24]]) {
    const w = loadSql('windows', h);
    assert.ok(w.includes(`WHERE timestamp > NOW() - INTERVAL '${span}' HOUR AND blob1 IN ('world', 'gate', 'chat') GROUP BY bucket, kind`), `${h} h asked: ${span} h read`);
    assert.ok(w.endsWith(`ORDER BY bucket DESC, kind LIMIT ${12 * (span + 1) * 3} FORMAT JSON`), `${h} h: every row of ${span} h`);
  }
  assert.match(loadSql('windows', 1), /toStartOfInterval\(timestamp, INTERVAL '5' MINUTE\) AS bucket/);
  assert.match(QUESTIONS[1][1], /world, gate, chat; the last 24 hours at most/);
  const crowds = loadSql('crowds', 1);
  assert.ok(crowds.includes("WHERE timestamp > NOW() - INTERVAL '1' HOUR AND blob1 != 'chat' ORDER BY peak DESC LIMIT 40 FORMAT JSON"), 'the channels left out (their buses hold everyone), the forty busiest by peak');

  // FOES-FIRST and FOES-HOLD: the blobs past the doubles, each alias the blob RoomMetrics writes its count in - a point
  // flushed with every count its own value, read back by position - weighted by the sample through toUInt32, over the
  // points that carry the hold's blobs; the mean wait the waits over the frames sent, both arms of the IF a Double
  let bp = null;
  const bm = new RoomMetrics(0);
  Object.assign(bm.c, { frames: 1, hitDrops: 3, fullDrops: 4, fulls: 5, held: 6, heldSent: 7, heldGone: 8, heldMs: 9, beats: 10 });
  bm.flush({ writeDataPoint: (p) => { bp = p; } }, 'world', 2, 'v', 1000, true);
  const BLOB_OF = { hit_drops: 3, full_drops: 4, fulls: 5, held: 6, held_sent: 7, held_gone: 8, beats: 10 };
  for (const [as, k] of Object.entries(BLOB_OF)) assert.equal(bp.blobs[k - 1], String(k), `blob${k} RoomMetrics's`);
  assert.equal(bp.blobs[8], '9', 'blob9 the waits');
  const fulls = loadSql('fulls', 2);
  for (const [as, k] of Object.entries(BLOB_OF)) assert.ok(fulls.includes(`SUM(_sample_interval * toUInt32(blob${k})) AS ${as}`), `fulls: ${as} is blob${k}`);
  assert.ok(fulls.includes('IF(SUM(_sample_interval * toUInt32(blob7)) > 0, SUM(_sample_interval * toUInt32(blob9)) / SUM(_sample_interval * toUInt32(blob7)), 0.0) AS wait_ms'), 'the mean wait: the waits over the held frames sent');
  assert.ok(fulls.endsWith("WHERE timestamp > NOW() - INTERVAL '2' HOUR AND blob6 != '' GROUP BY kind ORDER BY fulls DESC LIMIT 40 FORMAT JSON"), 'the hold\'s points alone, by kind, the most full frames first');
  const storage = loadSql('storage', 2);
  assert.ok(storage.includes('blob1 AS kind, double11 AS writes, double10 AS reads, double2 AS room_sockets, double15 AS room_peak'), 'a room-window\'s writes and reads, the doubles RoomMetrics writes them in, and its sockets');
  assert.ok(storage.endsWith("WHERE timestamp > NOW() - INTERVAL '2' HOUR ORDER BY writes DESC LIMIT 40 FORMAT JSON"), 'every kind, the most writes first');

  for (const bad of ['0', String(HOURS_MAX + 1), '1.5', '-1', "1' HOUR; --", 'x']) {
    for (const [name] of QUESTIONS) assert.throws(() => loadSql(name, bad), /not a window/, `${name} ${bad}`);
  }
  assert.throws(() => loadSql('nope', 1), /no question/);
  const t = loadTable('crowds', { data: [{ stamp: '2026-10-18 14:35:00', kind: 'world', peak: 214, sockets: 198, hellos: 61, busy: 12, room_full: 0, drops: 340, poses: 52000, sends: 1210000 }] });
  assert.match(t, /\| stamp \| kind \| peak \| sockets \| hellos \| busy \| room_full \| drops \| poses \| sends \|/);
  assert.match(t, /\| 2026-10-18 14:35:00 \| world \| 214 \| 198 \| 61 \| 12 \| 0 \| 340 \| 52,000 \| 1,210,000 \|/);
  assert.match(loadTable('kinds', { data: [] }), /No points in the window\./);
  assert.throws(() => loadTable('kinds', { errors: [{ message: 'Authentication error' }] }), /carries no rows/);
});

// DFO-83 (2026-11-07): .github/workflows/relay-load.yml was removed as part of the inherited-operational-Actions
// cleanup, along with this file's test of its by-hand dispatch, token guard and metrics step - those were pure
// workflow-content assertions with nothing surviving independent of the deleted file.
