// COST-0 (2026-10-24, the owner's bill: about $90 a day, $50 of it Durable Objects compute duration) - HOW MANY ROOMS
// ARE AWAKE, READ BY THE OPERATOR: tools/doActive.mjs walks Cloudflare's GraphQL schema to durableObjectsPeriodicGroups,
// builds its questions from what the schema says it has, and draws each day's objects awake, the always-awake count, the
// object-days and their cost; .github/workflows/do-active.yml runs it by hand, writing nothing. Over a fake endpoint in the
// real one's shape (test/fixtures/doActiveGraphql.mjs). bible/11-Multiplayer/Scale-Arc.md COST-0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GRAPHQL, DAYS_MAX, ALWAYS_ON_H, OBJECT_DAY_USD, HOUR_EDGES, activeDays, accountId, windowDays, typeQuery, introspect,
  schemaTable, readingPlan, dayFilters, objectsQuery, totalQuery, unitOf, bucketOf, reading, graphqlAsk, namespacesOf,
} from '../../tools/doActive.mjs';
import { fakeCloudflare, NS_ROOM, NS_GATE } from '../fixtures/doActiveGraphql.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const src = (p) => readFileSync(join(ROOT, p), 'utf8');
const ACCT = src('server/wrangler.toml').match(/^account_id\s*=\s*"([^"]+)"/m)[1];
const NOW = Date.parse('2026-10-24T15:00:00Z');

test('COST-0 the window and the law: whole days 1 to a week (empty: the week), the last whole UTC days before now, an account id of 32 hex, an object-day $0.135 (128 MB a day at $12.50 per million GB-s), the unit the one that puts the busiest object-day nearest a whole day without passing it, the histogram\'s edges (mutants: the window\'s guard; the day the window ends; the price; the unit\'s rule; an edge)', () => {
  assert.equal(DAYS_MAX, 7);
  assert.equal(activeDays(''), 7);
  assert.equal(activeDays(' 3 '), 3);
  for (const bad of ['0', '8', '1.5', '-1', 'x', '1; rm']) assert.throws(() => activeDays(bad), /not a window/, bad);
  assert.equal(accountId(ACCT), ACCT);
  assert.throws(() => accountId('"}) { x'), /not an account id/);
  assert.deepEqual(windowDays(3, NOW), ['2026-10-21', '2026-10-22', '2026-10-23'], 'whole days, oldest first, today left out');
  assert.equal(OBJECT_DAY_USD.toFixed(4), '0.1350');
  assert.equal(ALWAYS_ON_H, 22);
  assert.deepEqual([...HOUR_EDGES], [1, 2, 4, 8, 12, 16, 20, 22, 24]);
  assert.deepEqual([0, 1, 1.01, 2, 21.9, 22, 22.1, 24, 30].map(bucketOf), [0, 0, 1, 1, 7, 7, 8, 8, 8]);
  const us = unitOf(23.9 * 3600 * 1e6);
  assert.deepEqual([us.chosen.name, us.sure], ['microseconds', true]);
  assert.deepEqual(us.readings.map((r) => Math.round(r.hours * 10) / 10), [23.9, 23900]);
  assert.equal(unitOf(23.9 * 3600 * 1e3).chosen.name, 'milliseconds', 'read as microseconds the bus would sleep 99.9% of the day');
  assert.deepEqual([unitOf(30 * 3600 * 1e6).chosen.name, unitOf(30 * 3600 * 1e6).sure], ['microseconds', false], 'every reading past a day: unsure');
});

test('COST-0 the schema, walked: the root\'s query type, viewer, accounts, the dataset\'s group and each of its parts (an object\'s fields, a value null), its filter\'s fields, its orders and the account\'s settings - every name the schema\'s own; the plan built from it (the day filter, the page the settings allow, the order by active time, the namespace split), a cut window and every missing field named, the questions exact (mutants: a wrapper unwrapped wrong; the settings unread; the page size; the order; the per-object dimension; the total through the page)', async () => {
  const cf = fakeCloudflare();
  const ask = graphqlAsk('t', cf.fetch);
  const schema = await introspect(ask, ACCT);
  assert.equal(schema.group, 'AccountDurableObjectsPeriodicGroups');
  assert.deepEqual(schema.parts, { count: null, dimensions: ['date', 'datetimeHour', 'namespaceId', 'objectId'], sum: ['activeTime', 'cpuTime', 'inboundWebsocketMsgCount'], max: ['activeWebsocketConnections'] });
  assert.ok(schema.filters.includes('date') && schema.filters.includes('datetime_lt'));
  assert.ok(schema.orders.includes('sum_activeTime_DESC'));
  assert.deepEqual(schema.settings, { enabled: true, maxDuration: 259200, maxNumberOfFields: 30, maxPageSize: 3, notOlderThan: 2678400 });
  assert.equal(cf.asked[0], 'query { __schema { queryType { name } } }');
  assert.equal(cf.asked[1], typeQuery('Query'));
  assert.ok(cf.asked.includes(`query { viewer { accounts(filter: {accountTag: "${ACCT}"}) { settings { durableObjectsPeriodicGroups { enabled maxDuration maxNumberOfFields maxPageSize notOlderThan } } } } }`), 'the settings the schema has, by name');
  assert.match(schemaTable(schema), /\| sum \| activeTime, cpuTime, inboundWebsocketMsgCount \|\n/);
  assert.match(schemaTable(schema), /\| orderBy \(activeTime\) \| sum_activeTime_ASC, sum_activeTime_DESC \|/);

  const plan = readingPlan(schema, 7);
  assert.deepEqual(plan, { days: 7, cut: null, byDay: 'date', slice: 86400, pageSize: 3, order: 'sum_activeTime_DESC', namespace: true });
  assert.deepEqual(dayFilters(plan, '2026-10-23'), ['{date: "2026-10-23"}']);
  assert.equal(objectsQuery(ACCT, plan, '{date: "2026-10-23"}'), `query { viewer { accounts(filter: {accountTag: "${ACCT}"}) { g: durableObjectsPeriodicGroups(limit: 3, filter: {date: "2026-10-23"}, orderBy: [sum_activeTime_DESC]) { dimensions { objectId namespaceId } sum { activeTime } } } } }`);
  assert.equal(totalQuery(ACCT, plan, '{date: "2026-10-23"}'), `query { viewer { accounts(filter: {accountTag: "${ACCT}"}) { g: durableObjectsPeriodicGroups(limit: 3, filter: {date: "2026-10-23"}) { dimensions { namespaceId } sum { activeTime } } } } }`, 'the total never by object');
  // a schema with less: what is missing named, before any data is asked
  assert.throws(() => readingPlan({ ...schema, parts: { ...schema.parts, sum: ['cpuTime'] } }, 7), /lacks sum\.activeTime/);
  assert.throws(() => readingPlan({ ...schema, parts: { ...schema.parts, dimensions: ['date'] } }, 7), /lacks dimensions\.objectId/);
  assert.throws(() => readingPlan({ ...schema, filters: ['objectId'] }, 7), /lacks a filter by day/);
  assert.throws(() => readingPlan({ ...schema, settings: { ...schema.settings, maxDuration: 3600 } }, 7), /finer than a day \(maxDuration 3600 s\)/);
  // the spellings the schema offers instead, and a window the account no longer keeps
  const range = readingPlan({ ...schema, filters: ['date_geq', 'date_leq'], orders: [] }, 2);
  assert.deepEqual([range.byDay, range.order], ['date_range', null]);
  assert.deepEqual(dayFilters(range, '2026-10-23'), ['{date_geq: "2026-10-23", date_leq: "2026-10-23"}']);
  assert.doesNotMatch(objectsQuery(ACCT, range, '{}'), /orderBy/, 'an order the schema lacks is not asked');
  const hours = readingPlan({ ...schema, filters: ['datetime_geq', 'datetime_lt'], settings: { ...schema.settings, maxDuration: 43200 } }, 2);
  assert.deepEqual(dayFilters(hours, '2026-10-23'), ['{datetime_geq: "2026-10-23T00:00:00.000Z", datetime_lt: "2026-10-23T12:00:00.000Z"}', '{datetime_geq: "2026-10-23T12:00:00.000Z", datetime_lt: "2026-10-24T00:00:00.000Z"}'], 'a day in the slices the account allows');
  assert.deepEqual([readingPlan({ ...schema, settings: { ...schema.settings, notOlderThan: 4 * 86400 } }, 7).days, readingPlan({ ...schema, settings: { ...schema.settings, notOlderThan: 4 * 86400 } }, 7).cut], [3, 3], 'the whole days the account keeps');
  assert.equal(readingPlan({ ...schema, settings: { ...schema.settings, maxPageSize: 50_000 } }, 7).pageSize, 10_000, 'never past PAGE_MAX');
  assert.equal(readingPlan({ ...schema, parts: { ...schema.parts, dimensions: ['objectId'] } }, 7).namespace, false);
});

test('COST-0 the reading: the schema drawn first, then each day by namespace - its objects, its page cut, the objects awake past ALWAYS_ON_H, its object-days from the day\'s own total (never the cut page\'s) and their cost - the window\'s object-days a day beside the bill, the hours histogram of the object-days the pages hold, and the objects awake longest; the unit said; a schema that lacks the active time stops after the schema, drawn; a refusal names the token (mutants: the total from the page; the always-on bound; the cut unsaid; the namespace name; the histogram; the top order)', async () => {
  const cf = fakeCloudflare();
  let md = '';
  const r = await reading({ ask: graphqlAsk('t', cf.fetch), account: ACCT, days: 2, now: NOW, out: (s) => { md += s; }, namespaces: await namespacesOf('t', ACCT, cf.fetch) });
  assert.ok(md.startsWith('**What the account exposes (`durableObjectsPeriodicGroups`)**'), 'the schema first');
  assert.equal(r.unit.chosen.name, 'microseconds');
  assert.match(md, /the busiest object-day reads 86,040,000,000 - 23\.9 h as microseconds, 23,900 h as milliseconds\. Read as \*\*microseconds\*\*/);
  assert.match(md, /\| day \| namespace \| objects \| page cut \| awake > 22 h \| object_days \| duration \$ \|/);
  for (const day of ['2026-10-22', '2026-10-23']) {
    assert.ok(md.includes(`| ${day} | Room (daggerfall-relay) | 3 | yes (3) | 2 | 3 | $0.41 |`), `${day}: the Room's three objects on a cut page, two awake past 22 h, three object-days from the day's total`);
    assert.ok(md.includes(`| ${day} | AdmitGate (daggerfall-relay) | 0 | yes (3) | 0 | 0 | $0.01 |`), `${day}: the door's hour, from the total alone`);
  }
  assert.match(md, /Over the window: 6\.1 object-days, 3 a day - \$0\.41 a day at \$0\.135 an object-day/);
  assert.match(md, /\*\*Hours awake a day \(the 6 object-days the pages hold; a cut page leaves out the least awake\)\*\*/);
  assert.match(md, /\| 1-2 \| 2 \|\n/);
  assert.match(md, /\| 22-24 \| 4 \|\n/);
  assert.match(md, /\| 0-1 \| 0 \|\n/);
  const top = md.slice(md.indexOf('objects awake longest'));
  assert.ok(top.indexOf('`bus') < top.indexOf('`shard') && top.indexOf('`shard') < top.indexOf('`cell'), 'the longest awake first');
  assert.ok(top.includes(`| \`${'bus'.padEnd(64, '0')}\` | Room (daggerfall-relay) | 2 | 23.9 | 2 |`));
  assert.equal(Math.round(r.objectDays * 1000), Math.round(2 * (3 + 1 / 24) * 1000));
  assert.ok(cf.asked.filter((q) => q.includes('objectId namespaceId')).length === 2 && cf.asked.filter((q) => q.includes('dimensions { namespaceId } sum')).length === 2, 'a day: one page of objects and one total');

  // milliseconds: the same day read in the other unit
  let ms = '';
  await reading({ ask: graphqlAsk('t', fakeCloudflare({ unit: 1e-3 }).fetch), account: ACCT, days: 1, now: NOW, out: (s) => { ms += s; } });
  assert.match(ms, /Read as \*\*milliseconds\*\*/);
  assert.ok(ms.includes(`| 2026-10-23 | ${NS_ROOM} | 3 | yes (3) | 2 | 3 | $0.41 |`), 'the same day, the namespace by its id where its name was not read');

  // a schema without the active time: the schema drawn, then the stop
  let part = '';
  await assert.rejects(reading({ ask: graphqlAsk('t', fakeCloudflare({ drop: 'sum.activeTime' }).fetch), account: ACCT, days: 1, now: NOW, out: (s) => { part += s; } }), /lacks sum\.activeTime/);
  assert.match(part, /\*\*What the account exposes/);
  // the endpoint's own refusals
  await assert.rejects(graphqlAsk('t', fakeCloudflare({ refuse: 403 }).fetch)('query { x }'), /refused \(HTTP 403\) - the token needs Account Analytics: Read/);
  await assert.rejects(graphqlAsk('t', fakeCloudflare({ errors: /x/ }).fetch)('query { x }'), /not answered \(HTTP 200\): \[\{"message":"unknown field"\}\]/);
  assert.equal(GRAPHQL, 'https://api.cloudflare.com/client/v4/graphql');
  assert.deepEqual(await namespacesOf('t', ACCT, async () => ({ ok: false, status: 403, json: async () => ({ success: false }) })), new Map(), 'namespaces the token may not read: the ids stand');
  assert.equal((await namespacesOf('t', ACCT, cf.fetch)).get(NS_GATE), 'AdmitGate (daggerfall-relay)');
});

// DFO-83 (2026-11-07): .github/workflows/do-active.yml was removed as part of the inherited-operational-Actions
// cleanup, along with this file's test of its by-hand dispatch, token guard and reading step - those were pure
// workflow-content assertions with nothing surviving independent of the deleted file.
