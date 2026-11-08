// ACC1-CI (2026-09-21): THE ACCOUNT SERVICE'S DEPLOY, PINNED.
//
// Mac: "The token provided allows you to take this on yourself. I am
// not needed at all."
//
// ACC1b shipped `server-account/` with a four-step list headed "WHAT A
// PERSON HAS TO DO ONCE, BY HAND", and the reason given was that CI
// cannot create resources - only deploy code to them. That was wrong,
// and DEPLOY-PROSE had just finished paying for the same class of
// mistake on the relay: a sentence typed BESIDE a fact rather than
// derived from it goes on being read long after it stops being true.
//
// So this file holds the new arrangement the way `relaydeploy.test.js`
// holds the relay's, and for the same reason: a workflow is executed by
// GitHub, not by node, so it is the one thing in this tree that cannot
// fail in a test run. What CAN be held is held here.
//
// THE PINS THAT MATTER MOST ARE THE TWO DESTRUCTIVE ONES:
//   - re-minting the signing pair invalidates every token in flight;
//   - applying 0002 twice errors, because `ALTER TABLE ADD COLUMN` has
//     no IF NOT EXISTS.
// Both are now properties of a tool rather than warnings in a comment,
// and both are asked here in the shape that would actually break.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { graph } from '../importGraph.mjs';   // ACC4: the deploy filter is held to the Worker's real import graph

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const rd = (p) => readFileSync(join(root, p), 'utf8');
const TOML = 'server-account/wrangler.toml';
const TOOL = 'tools/mintIdentityKeys.mjs';

// DFO-83 (2026-11-07): .github/workflows/account-deploy.yml was removed as part of the inherited-operational-Actions
// cleanup. Its own pins here (the sentinel substitution, the migration ledger vs. the workflow's own commands, the
// re-mint guard, the gate-key minting, the SHADOW-FANG wait, the pre-merge S3 retry, the pubkey cross-check, and the
// "nothing claims this is manual" dual check) went with it. What remains below is independent of that workflow: the
// migration prefixes, the key-minting tool itself, the Worker's entrypoint shape, its import graph, the config's own
// internal consistency, and the Worker's cold-start behavior.

test('ACC1-CI: the config\'s own migration binding points at the directory the migrations are really in, and the D1 binding is live', () => {
  const toml = rd(TOML);
  const dir = 'server-account/migrations';
  const files = readdirSync(join(root, dir)).filter((f) => f.endsWith('.sql')).sort();
  assert.ok(files.length >= 2, 'the migration set shrank - this pin is about there being more than one');

  const md = /^migrations_dir\s*=\s*"([^"]+)"/m.exec(toml);
  assert.ok(md, 'the binding no longer says where the migrations are');
  assert.equal(`server-account/${md[1]}`, dir,
    `migrations_dir points at ${md[1]}, but the migrations are in ${dir}`);

  // AND THE BINDING IS LIVE. ACC1b commented it out because the
  // database did not exist yet; it exists the moment the deploy runs,
  // so a commented binding now would mean a Worker deployed with no DB
  // at all, which answers 503 to every route.
  assert.match(toml, /^\[\[d1_databases\]\]/m, 'the D1 binding is still commented out');
  assert.match(toml, /^binding\s*=\s*"DB"/m, 'the binding is no longer named DB, which is what src/index.js reads');
});

test('MIGRATION-PREFIX (the arena\'s third merge of main, 2026-10-03): every migration\'s four-digit prefix is its own, and each is the one before it plus one', () => {
  // Two branches that each add migrations off the same main take the same
  // next numbers, and git merges them without a word - the files' NAMES
  // differ, so nothing conflicts. #547 shipped 0071_silver_ways.sql and
  // 0072_motherlodes.sql while the arena branch held 0071_home_layout.sql,
  // 0072_arena.sql and 0073_arena4b.sql; the naive merge of the two had two
  // 0071s and two 0072s and every test green. The ledger keys a migration
  // by its whole name, so both of a pair would apply - but in name order,
  // not the order the arcs were written in, and the number is the name
  // every note, pin and deploy line uses: a second 0071 is a branch that
  // was never renumbered past main. A merge renumbers its side's migrations
  // past main's (the arena's merges did, acct and migrations together);
  // this is the pin that makes forgetting it red.
  const dir = 'server-account/migrations';
  const files = readdirSync(join(root, dir)).filter((f) => f.endsWith('.sql')).sort();
  assert.deepEqual(files.filter((f) => !/^\d{4}_[a-z0-9_]+\.sql$/.test(f)), [], 'a migration not named NNNN_name.sql');
  const byPrefix = new Map();
  for (const f of files) byPrefix.set(f.slice(0, 4), [...(byPrefix.get(f.slice(0, 4)) ?? []), f]);
  const shared = [...byPrefix.values()].filter((fs) => fs.length > 1).map((fs) => fs.join(' + '));
  assert.deepEqual(shared, [], 'two migrations share a prefix - renumber the merged side\'s past the other\'s');
  const nums = [...byPrefix.keys()].map(Number);
  assert.equal(nums[0], 1, 'the first migration is not 0001');
  const gaps = nums.filter((n, i) => i > 0 && n !== nums[i - 1] + 1).map((n) => `${String(n).padStart(4, '0')} after ${String(nums[nums.indexOf(n) - 1]).padStart(4, '0')}`);
  assert.deepEqual(gaps, [], 'a migration is not the one before it plus one');
});

test('ACC1-CI: --pipe emits ONE pair, private first, and there is no way to ask for half', async () => {
  // Run the real tool. Two lines, in the documented order, and they
  // must actually be each other's halves - because the failure this
  // prevents is a service that signs with a key its own /v1/pubkey
  // disowns, which looks exactly like a forged token.
  const out = execFileSync('node', [join(root, TOOL), '--pipe'], { encoding: 'utf8' });
  const lines = out.split('\n').filter((l) => l !== '');
  assert.equal(lines.length, 2, `--pipe emitted ${lines.length} lines; the workflow reads exactly two`);
  const [priv, pub] = lines;

  const { subtle } = globalThis.crypto;
  const msg = new TextEncoder().encode('the two halves are one pair');
  const sk = await subtle.importKey('pkcs8', Buffer.from(priv, 'base64'), { name: 'Ed25519' }, false, ['sign']);
  const vk = await subtle.importKey('raw', Buffer.from(pub, 'base64url'), { name: 'Ed25519' }, false, ['verify']);
  const sig = await subtle.sign({ name: 'Ed25519' }, sk, msg);
  assert.ok(await subtle.verify({ name: 'Ed25519' }, vk, sig, msg),
    'the private half and the public half printed by ONE run are not a pair - the order may have flipped');

  // ORDER IS THE CONTRACT: the workflow reads private, then public. If
  // they swapped, the public half would be stored as the secret and
  // every token would be unsignable - so ask which is which rather
  // than trusting the shape.
  assert.ok(priv.length > pub.length, 'a PKCS8 private key is longer than a raw public key - these look swapped');

  // AND THERE IS NO SINGLE-HALF FLAG. Two calls would mint two
  // unrelated pairs. The tool deliberately offers no way to do it.
  const tool = rd(TOOL);
  assert.doesNotMatch(tool, /'--private'|'--public'/,
    'the tool offers a way to ask for one half alone, which mints two unrelated pairs across two calls');

  // ...and it still writes nothing to disk.
  assert.doesNotMatch(tool, /writeFile|appendFile|createWriteStream/, 'the key tool writes a key to disk');
});

test('AUDIT-ACC F2: the Worker entrypoint exports ONLY a handler, or workerd will not start', () => {
  // THE WORKER DID NOT BOOT. AUDIT-ACC stood it up in a real workerd
  // and it refused, before a single request:
  //
  //   Uncaught TypeError: Incorrect type for map entry 'ACCOUNT_VERSION':
  //   the provided value is not of type 'function or ExportedHandler'.
  //
  // In a module Worker EVERY named export of the entrypoint is read as
  // an entrypoint - a WorkerEntrypoint, a Durable Object, a Workflow -
  // and a plain string or Set is not one, so it is a hard startup
  // failure rather than something ignored. `src/index.js` exported four
  // constants and a test hook.
  //
  // NO NODE TEST COULD SEE IT, and that is the lesson worth keeping:
  // the pins IMPORTED those very names, so they proved the exports
  // existed while the runtime rejected them for existing. Importability
  // and deployability are different questions and the suite was only
  // ever asking the first one.
  const entry = rd('server-account/src/index.js');
  const named = [...entry.matchAll(/^export\s+(?!default\b)(\w+)\s+(\w+)/gm)];
  assert.deepEqual(named.map((m) => m[2]), [],
    `server-account/src/index.js has named exports (${named.map((m) => m[2]).join(', ')}) - workerd reads each as an entrypoint and refuses to start`);
  assert.match(entry, /^export default \{/m, 'the entrypoint no longer exports a handler at all');

  // THE RELAY IS THE CONTROL, and it is why this is a law rather than a
  // guess: server/src/index.js has deployed for months exporting
  // `default` and the `Room` Durable Object CLASS. A class is a legal
  // entrypoint; a constant is not. So the pin forbids named value
  // exports, not named exports outright.
  const relay = rd('server/src/index.js');
  assert.match(relay, /^export default \{/m);
  const relayNamed = [...relay.matchAll(/^export\s+(?!default\b)(\w+)\s+(\w+)/gm)];
  assert.ok(relayNamed.length > 0 && relayNamed.every((m) => m[1] === 'class'),
    'the relay entrypoint grew a non-class named export - the same startup failure is one deploy away');
});

test('ACC1-CI: the config and the code agree on the account service\'s own version', () => {
  const toml = rd(TOML);
  // ...and the value it would read is the one the code answers with.
  const inToml = /^ACCOUNT_VERSION\s*=\s*"([^"]+)"/m.exec(toml);
  const name = /^name\s*=\s*"([^"]+)"/m.exec(toml);
  assert.ok(inToml && name, 'the config no longer carries both a version and a name to read');
  // ...read from service.js since AUDIT-ACC F2 moved it there: the
  // entrypoint may export only a handler, so the constants live in
  // their own home and this pin follows them.
  const svc = rd('server-account/src/service.js');
  const inCode = /^export const ACCOUNT_VERSION = '([^']+)'/m.exec(svc);
  assert.ok(inCode, 'server-account/src/service.js no longer declares ACCOUNT_VERSION');
  assert.equal(inToml[1], inCode[1], 'the config and the code name different deploys - a deploy\'s verify step would never go green');
});

test('IMPORT-GRAPH1: the walk is what the bundler bundles - each Worker\'s graph is exactly the files esbuild bundles from its entry, a JSON table a leaf; the relay\'s order is the hash\'s (mutants: a re-export unread; a named re-export unread; a dynamic import unread; a table parsed; a package walked)', async () => {
  // test/importGraph.mjs parses each file - the regex it replaced stripped block comments before line comments, so a stray
  // `/*` in a line comment swallowed the account Worker's imports of nine files, and the filter above never asked for
  // them. Held here to the bundler itself: wrangler bundles with esbuild, so its inputs ARE the Worker.
  const { build } = await import('esbuild');
  for (const entry of ['server/src/index.js', 'server-account/src/index.js']) {
    const r = await build({ entryPoints: [entry], bundle: true, write: false, metafile: true, format: 'esm', platform: 'neutral', logLevel: 'silent', external: ['cloudflare:*', 'node:*'], loader: { '.json': 'json' } });
    const bundled = Object.keys(r.metafile.inputs).filter((f) => !f.includes('node_modules')).sort();
    assert.deepEqual([...graph(entry)].sort(), bundled, `${entry}: the walk and the bundle`);
  }
  const account = graph('server-account/src/index.js');
  for (const f of ['src/systems/party/partyScale.js', 'src/systems/books.js', 'src/formats/rscTable.js', 'src/systems/loot/lootThemes.js']) assert.ok(account.includes(f), `${f}: one of the nine the comment hid`);
  assert.ok(account.some((f) => f.endsWith('.json')), 'a JSON table the Worker imports is in the graph, a leaf');
  // every shape the walk reads, in one fixture: the stray `/*`, an import, a re-export, a literal dynamic import(), a
  // double-quoted specifier, a JSON leaf, a named re-export and a
  // built-in the bundler leaves outside (never walked) - in the order they are written; a block comment's text never walked
  const dir = 'test/fixtures/importgraph/';
  assert.deepEqual(graph(dir + 'entry.js'), ['entry.js', 'a.js', 'b.js', 'c.js', 'e.js', 'd.json', 'f.js'].map((f) => dir + f));
  const fx = await build({ entryPoints: [dir + 'entry.js'], bundle: true, write: false, metafile: true, format: 'esm', platform: 'neutral', logLevel: 'silent', external: ['node:*'], loader: { '.json': 'json' } });
  assert.deepEqual([...graph(dir + 'entry.js')].sort(), Object.keys(fx.metafile.inputs).sort(), 'the fixture: the walk and the bundle');
});

test('ACC2: the save bucket is bound the same way the database is, and the Worker really reads its binding name', () => {
  const toml = rd(TOML);
  // THE BINDING IS IN THE CONFIG: a Worker whose toml binds a bucket
  // that does not exist does not start.
  assert.match(toml, /^\[\[r2_buckets\]\]$/m, 'the save bucket is bound');
  const bucket = /^bucket_name\s*=\s*"([^"]+)"/m.exec(toml)?.[1];
  const binding = /^binding\s*=\s*"(SAVES)"/m.exec(toml)?.[1];
  assert.ok(bucket, 'and it has a name');
  assert.equal(binding, 'SAVES', 'under the name server-account/src/index.js reads (env.SAVES)');
  assert.match(rd('server-account/src/index.js'), /env\.SAVES/, 'which the Worker really reads');
});

test('INT1 (its audit): THE ACCOUNT WORKER LOADS WHERE A MODULE\'S URL IS NO URL - bundled as wrangler bundles it, `import.meta.url` undefined (a Worker need not have one), and imported: nothing the item law carries into the Worker reads it as it loads (the audit: comeSailAwayModels.js made its model URLs so, through the boats\' items - "TypeError: Invalid URL", the deploy\'s start refused)', async () => {
  const { build } = await import('esbuild');
  const r = await build({
    entryPoints: [fileURLToPath(new URL('../../server-account/src/index.js', import.meta.url))], bundle: true, format: 'esm', write: false,
    platform: 'neutral', define: { 'import.meta.url': 'undefined' }, logLevel: 'silent',
  });
  const dir = mkdtempSync(join(tmpdir(), 'worker-'));
  const file = join(dir, 'worker.mjs');
  writeFileSync(file, r.outputFiles[0].text);
  try {
    const m = await import(pathToFileURL(file).href);
    assert.equal(typeof m.default?.fetch, 'function', 'the Worker\'s fetch, loaded');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
