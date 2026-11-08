// SERVER-POST (2026-10-08, Mac: "... First use is to utilize it for players being granted items.") and HOURS-FIRST
// ("... and each the gilded gun"): THE POST, SENT BY THE OPERATOR - tools/sendServerPost.mjs writes the statements for
// an operator to run by hand, and the post's first send, the Hourlock to the thirteen of the first clear, is migration
// 0094 - this file's statement, held to the tool's.
// DFO-83 (2026-11-07): .github/workflows/server-post.yml, which used to run the tool's statements by hand from a
// workflow_dispatch, was removed with the rest of the inherited operational workflows; its contract test went with it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { d1, standService } from '../accountDb.mjs';
import {
  postHandles, postBatch, postWords, postItem, sqlText, lookSql, sendSql, hoursFirstSql, hoursFirstHandles, HOURS_FIRST, HOURS_FIRST_RECORD, POST_ITEMS,
  POST_RECIPIENTS_MAX, tamrielPostSql, TAMRIEL_POST, TAMRIEL_POST_RECORD,
} from '../../tools/sendServerPost.mjs';
import { seatRealm } from '../realmSeat.mjs';
import { portalStones, isPortalStone } from '../../src/systems/gate/gateSpoils.js';
import { postBoxOf } from '../../server-account/src/post.js';
import { POST_SENDER, POST_BODY_MAX, POST_SUBJECT_MAX } from '../../src/net/postLaw.js';
import { mintHourlock, mintGilded, HOURLOCK_GUN_ERA, validGildedMarks } from '../../src/systems/gilded.js';

const ROOT = new URL('../../', import.meta.url);
const src = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const TOOL = fileURLToPath(new URL('tools/sendServerPost.mjs', ROOT));
const rows = (db, sql) => db._raw.prepare(sql).all().map((r) => ({ ...r }));
const player = (db, id, handle) => db._raw.prepare('INSERT INTO players (id, handle, handle_lc, guest_name, created_at, last_seen, registered_at) VALUES (?, ?, ?, ?, 1, 1, ?)')
  .run(id, handle, handle?.toLowerCase() ?? null, `Guest ${id}`, handle ? 1 : null);

test('SERVER-POST the tool: names a handle\'s shape, none twice, folded; a send\'s name its shape; the words within the post\'s bounds, \\n a line, no control character; an item only by name, minted by the game; every word a string with its quotes doubled; the command line prints the statement or nothing (mutants: a name unchecked; the bounds dropped; an item typed in)', () => {
  assert.deepEqual(postHandles(' Duck, duck ,ArtemisGodfrey '), ['duck', 'artemisgodfrey'], 'folded, and once');
  for (const bad of ['', ' , ', 'ab', 'Duck, 9lives', "x'; DROP TABLE players; --", 'a b']) assert.throws(() => postHandles(bad), /not a/, JSON.stringify(bad));
  assert.throws(() => postHandles(Array.from({ length: POST_RECIPIENTS_MAX + 1 }, (_, i) => `Player${i}`).join(',')), /not a list of names/);
  assert.equal(postBatch(' hours-first-hourlock '), 'hours-first-hourlock');
  for (const bad of ['', 'ab', 'Hours First', 'x\'y', '-lead', 'a'.repeat(49)]) assert.throws(() => postBatch(bad), /not a send's name/, JSON.stringify(bad));
  assert.deepEqual(postWords({ subject: ' Hello ', body: 'one\\ntwo' }), { subject: 'Hello', body: 'one\ntwo' });
  assert.throws(() => postWords({ subject: '', body: 'x' }), /not a subject/);
  assert.throws(() => postWords({ subject: 'x'.repeat(POST_SUBJECT_MAX + 1), body: 'x' }), /not a subject/);
  assert.throws(() => postWords({ subject: 'x', body: 'x'.repeat(POST_BODY_MAX + 1) }), /not a message/);
  assert.throws(() => postWords({ subject: 'x', body: 'bell\u0007' }), /control character/);
  assert.deepEqual(Object.keys(POST_ITEMS), ['none', 'hourlock']);
  assert.equal(postItem('none'), null);
  assert.deepEqual(JSON.parse(postItem('hourlock')), mintHourlock(), 'the Hourlock as its drop mints it');
  assert.throws(() => postItem('{"templateIndex":560}'), /not an item/);
  assert.equal(sqlText("Hour's First"), "'Hour''s First'");

  assert.equal(execFileSync(process.execPath, [TOOL, '--names', 'Duck,Terra'], { encoding: 'utf8' }), 'duck\nterra\n');
  assert.equal(execFileSync(process.execPath, [TOOL, '--look', 'Duck', 'b-one'], { encoding: 'utf8' }), `${lookSql('Duck', 'b-one')}\n`);
  assert.equal(execFileSync(process.execPath, [TOOL, '--sql', 'Duck', 'b-one', 'hourlock', 'Hi', 'A gift'], { encoding: 'utf8' }), `${sendSql({ handles: 'Duck', batch: 'b-one', item: 'hourlock', subject: 'Hi', body: 'A gift' })}\n`);
  assert.equal(execFileSync(process.execPath, [TOOL, '--migration', 'hours-first'], { encoding: 'utf8' }), `${hoursFirstSql()}\n`);
  for (const args of [['--sql', 'Duck', 'b-one', 'sword', 'Hi', 'x'], ['--sql', "x'; --", 'b-one', 'none', 'Hi', 'x'], ['--look', 'Duck'], ['--migration', 'nobody'], []]) {
    const r = spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8' });
    assert.equal(r.status, 1, args.join(' '));
    assert.equal(r.stdout, '', 'nothing for the workflow to run');
  }
});

test('SERVER-POST the send, over the real schema: one piece to each registered account the names find - never a guest, never another; the words and the item as the tool made them; RETURNING names what it wrote; the same send again writes nothing, another send is another piece; the dry run reads who holds it; a quote in the words is words (mutants: the send not once a name; a guest sent post; the item\'s record changed)', () => {
  const db = d1();
  player(db, 'p-duck', 'Duck'); player(db, 'p-terra', 'Terra'); player(db, 'p-other', 'Other'); player(db, 'p-guest', null);
  const o = { handles: 'duck, TERRA, Nobody', batch: 'gift-one', item: 'hourlock', subject: "Hour's First", body: "It's yours.\\nClaim it." };
  const wrote = rows(db, sendSql(o));
  assert.deepEqual(wrote.map((r) => r.to_id).sort(), ['p-duck', 'p-terra'], 'the names found, no other');
  const kept = rows(db, 'SELECT * FROM server_post ORDER BY to_id');
  assert.equal(kept.length, 2);
  for (const k of kept) {
    assert.match(k.id, /^[0-9a-f]{24}$/);
    assert.deepEqual([k.batch, k.sender, k.subject, k.body, k.read_at, k.claimed_at], ['gift-one', POST_SENDER, "Hour's First", "It's yours.\nClaim it.", null, null]);
    assert.deepEqual(JSON.parse(k.item), mintHourlock());
    assert.ok(Math.abs(k.sent_at - Date.now() / 1000) < 60, 'the database\'s own clock');
  }
  assert.notEqual(kept[0].id, kept[1].id);
  assert.deepEqual(rows(db, sendSql(o)), [], 'the same send twice sends once');
  assert.equal(rows(db, sendSql({ ...o, batch: 'gift-two', item: 'none' })).length, 2, 'another send is another piece');
  assert.equal(rows(db, "SELECT item FROM server_post WHERE batch = 'gift-two'")[0].item, null, 'a message alone');
  assert.deepEqual(rows(db, lookSql('Duck,Terra,Other,Nobody', 'gift-one')), [
    { handle: 'Duck', handle_lc: 'duck', sent: 1 }, { handle: 'Other', handle_lc: 'other', sent: 0 }, { handle: 'Terra', handle_lc: 'terra', sent: 1 },
  ], 'the dry run: who it finds, and who holds it');
  assert.equal(rows(db, "SELECT COUNT(*) AS n FROM server_post WHERE to_id = 'p-guest'")[0].n, 0, 'never a guest');
});

test('HOURS-FIRST THE FIRST SEND, migration 0094: the tool\'s own statement to the thirteen, holding the Hourlock - its names and its record FROZEN in the tool (an applied migration never runs again), every one of them holding the title, the record the mint\'s own; applied over the live accounts it sends each of the thirteen one piece and no one else, the box shows the gift by name, and applied again it sends nothing (mutants: a name missing from the send; the gun swapped; the send not once)', async () => {
  const mig = src('server-account/migrations/0094_hours_first_post.sql');
  const statement = mig.split('\n').filter((l) => !l.startsWith('--')).join('\n').trim();
  assert.equal(statement, hoursFirstSql(), 'the tool\'s statement, as it prints it');
  const first = postHandles(HOURS_FIRST.handles);
  assert.equal(first.length, 13);
  assert.deepEqual(first, HOURS_FIRST.handles.split(',').map((h) => h.toLowerCase()), 'thirteen names, each a handle');
  const titled = new Set(postHandles(hoursFirstHandles()));
  assert.ok(first.every((h) => titled.has(h)), 'every one sent the gun holds the title (HOURS_FIRST_HANDLES) - a name added there later is sent the gun by the workflow');
  // PIN MOVED (GUNS-UNFOUND): the Hourlock is a bow now - the thirteen's gun is its gun era's mint, lawful still
  assert.deepEqual(JSON.parse(HOURS_FIRST_RECORD), mintGilded(HOURLOCK_GUN_ERA), 'the frozen record is the gun era\'s mint - a change to it makes every unclaimed gift a forgery');
  assert.ok(validGildedMarks(JSON.parse(HOURS_FIRST_RECORD)), 'and an unclaimed gift stays lawful');
  assert.equal(HOURS_FIRST.item, 'hourlock');
  assert.equal(HOURS_FIRST.subject, "Hour's First");
  assert.ok(HOURS_FIRST.body.length <= POST_BODY_MAX);
  assert.match(src('server-account/migrations/0093_server_post.sql'), /CREATE TABLE IF NOT EXISTS server_post/, '0093 lays the table it writes into');

  const svc = await standService();
  const thirteen = [];
  for (const h of HOURS_FIRST.handles.split(',')) thirteen.push(await svc.registered(h));
  const other = await svc.registered('Bystander');
  svc.env.DB._raw.exec(mig);
  const pieces = rows(svc.env.DB, 'SELECT to_id, batch, item FROM server_post');
  assert.equal(pieces.length, 13, 'one each');
  assert.deepEqual(new Set(pieces.map((p) => p.to_id)), new Set(thirteen.map((t) => t.id)));
  assert.ok(pieces.every((p) => p.batch === 'hours-first-hourlock'));
  assert.ok(pieces.every((p) => JSON.stringify(JSON.parse(p.item)) === JSON.stringify(mintGilded(HOURLOCK_GUN_ERA))), 'the gilded gun, as its drop minted it then (PIN MOVED, GUNS-UNFOUND: its gun era)');
  const box = await postBoxOf({ db: svc.env.DB }, { id: thirteen[0].id });
  assert.deepEqual([box.post.length, box.post[0].subject, box.post[0].item, box.unread, box.unclaimed], [1, "Hour's First", { name: 'The Hourlock', rarity: 'gilded' }, 1, 1]);
  assert.equal((await postBoxOf({ db: svc.env.DB }, { id: other.id })).post.length, 0, 'no one else');
  svc.env.DB._raw.exec(mig);
  assert.equal(rows(svc.env.DB, 'SELECT COUNT(*) AS n FROM server_post')[0].n, 13, 'applied again, nothing more');
});

test('TAMRIEL-POST THE UPDATE\'S LETTER, migration 0188: the tool\'s own statement to every registered account, ten Portal Stones in one stack - its words and record FROZEN in the tool, the record the mint\'s own, every sentence a plain one; applied over the live accounts it sends each registered one a piece and no guest, the box shows the stones, a claim puts all ten in the realm character\'s record, and applied again it sends nothing (mutants: a guest sent it; the stones not ten; the send not once)', async () => {
  const mig = src('server-account/migrations/0188_tamriel_post.sql');
  const statement = mig.split('\n').filter((l) => !l.startsWith('--')).join('\n').trim();
  assert.equal(statement, tamrielPostSql(), 'the tool\'s statement, as it prints it');
  assert.equal(execFileSync(process.execPath, [TOOL, '--migration', 'tamriel'], { encoding: 'utf8' }), `${tamrielPostSql()}\n`);
  const stones = JSON.parse(TAMRIEL_POST_RECORD);
  assert.deepEqual(stones, portalStones(10), 'the frozen record is the mint\'s own');
  assert.ok(isPortalStone(stones) && stones.stackCount === 10, 'ten Portal Stones, one stack');
  assert.ok(TAMRIEL_POST.subject.length <= POST_SUBJECT_MAX && TAMRIEL_POST.body.length <= POST_BODY_MAX);
  assert.equal(TAMRIEL_POST.sender, 'DFO Team');
  assert.ok(TAMRIEL_POST.body.endsWith(`- ${TAMRIEL_POST.sender}`), 'signed by its sender');
  for (const sentence of TAMRIEL_POST.body.split(/(?<=[.!?:])\s+/)) assert.ok(sentence.split(/\s+/).length <= 25, `a plain sentence (PLAIN-TEXT): ${sentence}`);

  const svc = await standService();
  const ann = await svc.registered('Ann'), bob = await svc.registered('Bob');
  player(svc.env.DB, 'p-guest', null);
  svc.env.DB._raw.exec(mig);
  const pieces = rows(svc.env.DB, 'SELECT id, to_id, batch, sender, item FROM server_post');
  assert.deepEqual(new Set(pieces.map((p) => p.to_id)), new Set([ann.id, bob.id]), 'every registered account, once, and no guest');
  assert.equal(pieces.length, 2);
  assert.ok(pieces.every((p) => p.batch === TAMRIEL_POST.batch && p.sender === 'DFO Team' && p.item === TAMRIEL_POST_RECORD));
  const box = await postBoxOf({ db: svc.env.DB }, { id: ann.id });
  assert.deepEqual([box.post[0].from, box.post[0].subject, box.post[0].item?.name, box.unclaimed], ['DFO Team', TAMRIEL_POST.subject, 'Portal Stone', 1]);

  const R = await seatRealm(svc.env, ann.secret, 'Ann', { name: 'Ann', level: 5, goldPieces: 10, items: [] });
  const id = pieces.find((p) => p.to_id === ann.id).id;
  const r = await svc.call('/v1/post/claim', { id, character: R.id, realm: R.at() }, ann.secret);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.item, portalStones(10), 'the claim answers the stones');
  const row = svc.env.DB._raw.prepare('SELECT obj FROM realm_characters WHERE id = ?').get(R.id);
  const rec = JSON.parse(new TextDecoder().decode(svc.env.SAVES._map.get(row.obj)));
  assert.deepEqual(rec.items, [portalStones(10)], 'all ten in the character\'s record');
  svc.env.DB._raw.exec(mig);
  assert.equal(rows(svc.env.DB, 'SELECT COUNT(*) AS n FROM server_post')[0].n, 2, 'applied again, nothing more');
});
