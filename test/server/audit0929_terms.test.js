// AUDIT PRE-MERGE 0929 (2026-09-29, Mac: "Audit this") - TERMS1's half: a game from before the boxes told the truth,
// and a keyboard that survives the card's redraw. The record: bible/01-Overview/audits/Audit-PreMerge-0929.md.
//
// Each test failed on the unfixed tree for its finding's reason: a bare request answered `terms-unaccepted` - a word
// no game from before TERMS1 has a sentence for (T1) - and a card whose repaint left the focus on nothing (T3).
//
// DFO-83 (2026-11-07): T-CI and T2 audited the account-deploy.yml/deploy.yml smoke-test and deploy-wait machinery;
// both workflows were removed with the rest of the inherited operational Actions, and their contract tests went with them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { TERMS_VERSION, ACCEPTED } from '../../src/net/legalLaw.js';
import { AccountFlow, LOCAL_REFUSALS } from '../../src/ui/accountFlow.js';
import { accountCard } from '../../src/ui/enhanced/enhancedAccount.js';
import { REFUSALS, accountRefusalText } from '../../src/net/accountClient.js';
import worker from '../../server-account/src/index.js';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

// ── THE SERVICE ─────────────────────────────────────────────────────

const MIGRATIONS = readdirSync(new URL('server-account/migrations/', ROOT)).filter((f) => f.endsWith('.sql')).sort();
function service() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const f of MIGRATIONS) db.exec(read(`server-account/migrations/${f}`));
  const DB = {
    prepare(sql) {
      const stmt = db.prepare(sql); let args = [];
      const api = {
        bind(...a) { args = a; return api; },
        async first() { return stmt.get(...args) ?? null; },
        async all() { return { results: stmt.all(...args) }; },
        async run() { const r = stmt.run(...args); return { meta: { changes: Number(r.changes) } }; },
      };
      return api;
    },
  };
  const env = { DB, ACCOUNT_VERSION: 'test1', ALLOWED_ORIGIN: '*' };
  const call = async (path, body) => {
    const res = await worker.fetch(new Request(`https://accounts.invalid${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), env);
    return { status: res.status, body: await res.json() };
  };
  return { call, rows: () => db.prepare('SELECT * FROM players').all() };
}

test('AUDIT PRE-MERGE 0929 T1: a game from before the boxes is told it may need updating, in a word it already renders - it said "the account service had a problem" at every press, and the desktop app\'s reload brings back the same bundled game (mutants: the bare request answered terms-unaccepted; a half-ticked one answered not-found)', async () => {
  const { call, rows } = service();
  // what every build before TERMS1 sends (openGuest's `{ label }`)
  const old = await call('/v1/auth/guest', { label: null });
  assert.deepEqual([old.status, old.body], [400, { error: 'not-found' }]);
  assert.match(accountRefusalText(old.body.error), /The game may need updating\./, 'the sentence every shipped build carries for the word');
  assert.match(REFUSALS['not-found'], /may need updating/);
  // a half-ticked or malformed agreement is still the form's own refusal, and a dated one still stale
  assert.deepEqual((await call('/v1/auth/guest', { terms: TERMS_VERSION })).body, { error: 'terms-unaccepted' });
  assert.deepEqual((await call('/v1/auth/guest', { terms: null, privacy: null })).body, { error: 'terms-unaccepted' });
  assert.deepEqual((await call('/v1/auth/guest', { terms: '2000-01-01', privacy: '2000-01-01' })).body, { error: 'terms-stale' });
  assert.equal(rows().length, 0, 'a refused request wrote a row');
  assert.equal((await call('/v1/auth/guest', { label: 'x', ...ACCEPTED })).status, 200);
  // the stale sentence names the desktop app's way too - a reload there loads the same bundled game
  assert.match(REFUSALS['terms-stale'], /[Rr]eload the game \(or update the app\)/);
});

test('AUDIT PRE-MERGE 0929 T1: the form never sends the bare request the service now answers as an old game - a press with a box unticked asks nothing', async () => {
  const calls = [];
  const flow = AccountFlow({ io: { fetch: async (url) => { calls.push(url); throw new Error('asked'); } }, storage: { getItem: () => null, setItem() {}, removeItem() {} } });
  flow.go('register');
  flow.set('handle', 'Nystul'); flow.set('password', 'a good long one'); flow.set('confirm', 'a good long one');
  flow.agree('terms', true);
  assert.equal(await flow.submit(), false);
  assert.equal(flow.error, LOCAL_REFUSALS['privacy-unticked']);
  assert.equal(calls.length, 0);
});

// ── THE CARD ────────────────────────────────────────────────────────

/** The smallest document with a keyboard: a focus that follows `focus()`, and falls to the body when its node is taken
 *  off the card (as a browser's does). */
function focusDoc() {
  const doc = { activeElement: null, body: { tag: 'body' }, documentElement: { tag: 'html' } };
  doc.activeElement = doc.body;
  const mk = (tag) => {
    const n = {
      tag, className: '', type: null, value: '', checked: false, disabled: false, href: null, target: null, rel: null,
      selectionStart: null, selectionEnd: null, children: [], parent: null,
      append: (...kids) => { for (const k of kids.filter(Boolean)) { k.parent = n; n.children.push(k); } },
      focus() { if (!n.disabled) doc.activeElement = n; },
      setSelectionRange(a, b) { n.selectionStart = a; n.selectionEnd = b; },
      get all() { return [n, ...n.children.flatMap((c) => c.all)]; },
    };
    Object.defineProperty(n, 'textContent', {
      get() { return n._txt ?? null; },
      set(v) {
        n._txt = v;
        if (v === '') {
          if (n.children.some((c) => c.all.includes(doc.activeElement))) doc.activeElement = doc.body;
          n.children.length = 0;
        }
      },
    });
    return n;
  };
  doc.createElement = mk;
  return doc;
}

const cardWithKeys = (fetch = async () => { throw new Error('offline'); }) => {
  const doc = focusDoc();
  let card = null;
  const flow = AccountFlow({ io: { fetch }, storage: { getItem: () => null, setItem() {}, removeItem() {} }, onChange: () => card?.paint() });
  card = accountCard(doc, flow);
  flow.go('register');
  return { doc, flow, card, find: (pred) => card.root.all.find(pred) };
};

test('AUDIT PRE-MERGE 0929 T3: a keystroke that clears a refusal keeps its field and its caret - after "Type your username" the rest of "Nystul" went nowhere but its N (mutants: no focus kept; the caret dropped; the focus kept across a change of stage)', async () => {
  const { doc, flow, find } = cardWithKeys();
  await flow.submit();
  assert.equal(flow.error, LOCAL_REFUSALS['handle-empty']);
  let input = find((n) => n.acctKey === 'field:handle');
  input.focus();
  // the browser's order: the value and the caret move, then `input` fires
  input.value = 'N'; input.setSelectionRange(1, 1);
  input.oninput();
  assert.equal(flow.error, '', 'the keystroke cleared the refusal - and repainted the card');
  const now = doc.activeElement;
  assert.notEqual(now, input, 'the redraw built the field anew');
  assert.equal(now.acctKey, 'field:handle', `the keyboard fell to ${now.tag}`);
  assert.deepEqual([now.selectionStart, now.selectionEnd], [1, 1], 'the caret went back to the start');
  // the rest of the name lands in the field the keyboard is on
  for (const ch of 'ystul') { const f = doc.activeElement; f.value += ch; f.setSelectionRange(f.value.length, f.value.length); f.oninput(); }
  assert.equal(flow.values.handle, 'Nystul');
  // a new stage is a new card: nothing is focused into it
  flow.go('login');
  assert.equal(doc.activeElement, doc.body);
});

test('AUDIT PRE-MERGE 0929 T3: a tick that clears the boxes\' refusal keeps the box - its one answer left the next Tab on Username - and a press the redraw disabled gets the focus back after it (mutants: the box\'s key dropped; a disabled control focused; the kept focus forgotten while the press is out)', async () => {
  const { doc, flow, find } = cardWithKeys();
  flow.set('handle', 'Nystul'); flow.set('password', 'a good long one'); flow.set('confirm', 'a good long one');
  await flow.submit();
  assert.equal(flow.error, LOCAL_REFUSALS['terms-unticked']);
  const box = find((n) => n.acctKey === 'agree:terms');
  box.focus();
  box.checked = true; box.onchange();
  assert.equal(flow.error, '');
  assert.equal(doc.activeElement.acctKey, 'agree:terms', 'the tick left the box');
  assert.equal(doc.activeElement.checked, true);
  // the press: its button is disabled while the request is out, and has the focus back when it answers
  let answer;
  const { doc: d2, flow: f2, find: find2 } = cardWithKeys(() => new Promise((res) => { answer = res; }));
  f2.set('handle', 'Nystul'); f2.set('password', 'a good long one'); f2.set('confirm', 'a good long one');
  f2.agree('terms', true); f2.agree('privacy', true);
  const press = find2((n) => n.acctKey === 'act:submit');
  press.focus();
  const out = f2.submit();
  const busy = find2((n) => n.acctKey === 'act:submit');
  assert.equal(busy.disabled, true);
  assert.equal(d2.activeElement, d2.body, 'a disabled button holds no focus');
  answer({ ok: false, status: 400, json: async () => ({ error: 'handle-taken' }) });
  await out;
  assert.equal(f2.error, REFUSALS['handle-taken']);
  assert.equal(d2.activeElement.acctKey, 'act:submit', 'the press never had the keyboard back');
  assert.equal(d2.activeElement.disabled, false);
});
