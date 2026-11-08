// D1-NEAR (2026-10-12, from play: "I notice a lot of UI elements that utilize the server (like searching players, the
// guild menu, etc) take an insane amount of time to load") - THE ACCOUNT WORKER RUNS BESIDE ITS DATABASE'S PRIMARY, BY
// NAME. SCALE1 left it to Smart Placement, which on 2026-10-12 ran it in Sydney while the primary stands in western
// North America: every statement on the primary paid the Pacific, ~150-180 ms each, thirteen or fourteen of them for a
// look at the Guild tab. bible/11-Multiplayer/Scale-Arc.md D1-NEAR.
//
// DFO-83 (2026-11-07): this file's other half - the deploy's own report of where the Worker answers from, run as
// account-deploy.yml's step as the runner ran it (test/d1nearStep.mjs, and its own pins in test/bible/audit_d1near.test.js)
// - was removed with that workflow. The placement config it was reporting on is unchanged and still pinned below.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname;
const src = (p) => readFileSync(join(ROOT, p), 'utf8');

/** A TOML table's keys and their string values, its comments and blank lines dropped, up to the next table. */
function tomlTable(toml, name) {
  const lines = toml.split('\n');
  const at = lines.findIndex((l) => l.trim() === `[${name}]`);
  assert.ok(at >= 0, `no [${name}] table`);
  const out = {};
  for (const l of lines.slice(at + 1)) {
    const t = l.trim();
    if (t.startsWith('[')) break;
    if (!t || t.startsWith('#')) continue;
    const kv = /^([A-Za-z_][\w-]*)\s*=\s*"([^"]*)"\s*(?:#.*)?$/.exec(t);
    assert.ok(kv, `[${name}] holds a line this pin cannot read: ${t}`);
    out[kv[1]] = kv[2];
  }
  return out;
}

/** Every .md under a directory, by path. */
const markdownUnder = (dir) => readdirSync(join(ROOT, dir), { recursive: true }).map(String).filter((f) => f.endsWith('.md')).map((f) => join(dir, f));

/** The three sentences SCALE1, SCALE4d and SCALE4g wrote and nothing measured: Smart Placement running the Worker near,
 *  or beside, its database. A QUOTE of them stands as history (a double-quoted span is read as one, and dropped). */
const SMART_NEAR = /Smart Placement runs the (?:account )?Worker (?:near|beside)|Under Smart Placement,? the (?:account )?Worker runs (?:near|beside)|runs under Smart Placement,? (?:near|beside)/i;
const unquoted = (s) => s.replace(/"[^"\n]*"/g, '""');

test('D1-NEAR the placement: the account Worker\'s one [placement] table names its region alone - the region the record names - never `mode = "smart"`; the comment above it is D1-NEAR\'s own; and none of the three sentences that took Smart Placement\'s word stands on any page of the bible outside a quote (mutants: SCALE1\'s smart placement back; the Worker placed in Sydney; the table dropped; SCALE1\'s comment back; SCALE1\'s sentence back on the record\'s page)', () => {
  const toml = src('server-account/wrangler.toml');
  assert.equal(toml.match(/^\[placement\]$/gm)?.length ?? 0, 1, 'one [placement] table');
  const placement = tomlTable(toml, 'placement');
  // `region` alone: `mode`, `host` and `hostname` are Cloudflare's other kinds of placement, each exclusive of it -
  // Smart Placement is the one that ran the Worker in Sydney
  assert.deepEqual(placement, { region: 'aws:us-west-1' });
  for (const l of toml.split('\n')) if (!l.trim().startsWith('#')) assert.doesNotMatch(l, /^\s*mode\s*=\s*"smart"/, 'no live line asks for Smart Placement');
  // NO PAGE SAYS IT ANY MORE - the claim three records leaned on, retired where it stood; a quote of it is history
  const standing = markdownUnder('bible').filter((f) => SMART_NEAR.test(unquoted(src(f))));
  assert.deepEqual(standing, [], 'a page of the bible still says Smart Placement runs the account Worker beside its database');
  assert.ok(SMART_NEAR.test('Smart Placement runs the Worker near its database.'), 'the pin reads SCALE1\'s own sentence');
  assert.ok(!SMART_NEAR.test(unquoted('SCALE1 wrote "Smart Placement runs the Worker near its database."')), 'and lets a quote of it stand');
});
