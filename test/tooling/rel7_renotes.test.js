// REL7 (2026-10-03, Mac: "I need you to do this auto") - A PUBLISHED
// RELEASE'S NOTES, READ AGAIN. app-v0.1.5767 went out saying "Fixes and
// improvements.": #547's notes had lived in a PATCH-NOTES file REL6
// deleted, and its description gained them a minute after the publish job
// had read it. A published release is never re-cut (AUDIT INSTALL L3-2),
// but its TEXT can be written again: editing a merged pull request's
// description (or dispatching .github/workflows/release-notes.yml with a
// tag) has `desktopRelease.mjs renotes` read the notes of the pull requests
// between the previous release and that tag again - main's script, the
// tag's history - and put them above GitHub's generated list; the
// release's body is patched, no file of it touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { renotedBody, composeReleaseNotes, GENERATED_LIST_RE, NO_NOTES_TEXT } from '../../scripts/desktopRelease.mjs';

const require = createRequire(import.meta.url);
const { playerNotes } = require('../../app/lib/launcherState.cjs');
const rd = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

const LIST = "## What's Changed\n* SILVER-WAYS by @o in https://x/pull/547\n\n\n**Full Changelog**: https://x/compare/a...b";

test('REL7: a release\'s body with its notes written again - the new notes above GitHub\'s list, the list kept, the launcher reading exactly the notes', () => {
  const notes = composeReleaseNotes([{ text: '# Patch Notes: Silver\n\n- Raids pay silver.' }]);
  const old = `${NO_NOTES_TEXT}\n\n\n${LIST}`;
  const body = renotedBody(old, notes);
  assert.equal(body, `# Patch Notes: Silver\n\n- Raids pay silver.\n\n\n${LIST}`);
  assert.equal(playerNotes(body), '# Patch Notes: Silver\n\n- Raids pay silver.', 'the news is the notes, never the list');
  assert.equal(renotedBody(old.replace(/\n/g, '\r\n'), notes), body, 'a body GitHub hands back with CRLF');
  assert.equal(renotedBody(`# Patch Notes: Old\n\n- Gone.\n\n${LIST}`, notes), body, 'old notes are replaced, not kept above the new');
  assert.equal(renotedBody('Fixes and improvements.\n', notes), notes, 'a body with no list is replaced whole');
  assert.equal(renotedBody(null, notes), notes);
  assert.equal(renotedBody(`x\n\n**Full Changelog**: https://x`, notes), `${notes}\n\n**Full Changelog**: https://x`, 'a release with no pull requests listed has only the changelog line');
  // the cut is the launcher's own: one place a player's news ends
  const launcher = rd('app/lib/launcherState.cjs');
  const theirs = /const GENERATED_RE = (\/.*\/m);/.exec(launcher)?.[1];
  assert.equal(String(GENERATED_LIST_RE), theirs, 'app/lib/launcherState.cjs GENERATED_RE and this cut must move together');
});

test('REL7: the renotes command, spawned as release-notes.yml spawns it - from main\'s checkout, the pull requests up to the TAG and no further, the notes off gh; a missing tag or a failed read leaves the release as it is', { skip: process.platform === 'win32' && 'a shell script stands in for gh' }, () => {
  const repo = mkdtempSync(join(tmpdir(), 'rel7-cli-'));
  const bin = mkdtempSync(join(tmpdir(), 'rel7-gh-'));
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  const script = fileURLToPath(new URL('../../scripts/desktopRelease.mjs', import.meta.url));
  let n = 0;
  const commit = (msg) => { writeFileSync(join(repo, `${n++}.txt`), `${msg}\n`); git('add', '-A'); git('commit', '-q', '-m', msg); };
  const merge = (pr, branch) => {
    git('checkout', '-q', '-b', branch);
    commit(`${branch} work`);
    git('checkout', '-q', 'main');
    git('merge', '--no-ff', '-q', '-m', `Merge pull request #${pr}: ${branch}`, branch);
  };
  try {
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'p@example.invalid');
    git('config', 'user.name', 'p');
    git('config', 'commit.gpgsign', 'false');
    commit('one');
    git('tag', 'app-v0.1.1');
    merge(547, 'silver');
    merge(548, 'rel6');
    git('tag', 'app-v0.1.2');
    merge(549, 'later');   // main has moved on past the release: its merges are the NEXT release's
    writeFileSync(join(bin, 'gh'), [
      '#!/bin/sh',
      'here=$(dirname "$0")',
      '[ -f "$here/fail" ] && { echo "gh: Server Error (HTTP 502)" >&2; exit 1; }',
      'f="$here/$(basename "$2").json"',
      '[ -f "$f" ] || { echo "gh: Not Found (HTTP 404)" >&2; exit 1; }',
      'cat "$f"',
      '',
    ].join('\n'));
    chmodSync(join(bin, 'gh'), 0o755);
    // #547's notes, written on its description after the release was cut; #548 has none for players
    writeFileSync(join(bin, '547.json'), JSON.stringify({ merged_at: 'x', author_association: 'OWNER', body: '## Patch notes: Silver\n\n### Raids\n- 30 silver.\n\n## Summary\n- for reviewers' }));
    writeFileSync(join(bin, '548.json'), JSON.stringify({ merged_at: 'x', author_association: 'OWNER', body: '## Patch notes\n\n<!-- Nothing for players. -->\n\n## What changed\n- the pipeline' }));
    writeFileSync(join(bin, '549.json'), JSON.stringify({ merged_at: 'x', author_association: 'OWNER', body: '## Patch notes: Later\n\n- Not this release.' }));
    const current = join(bin, 'current-body.md');
    writeFileSync(current, `${NO_NOTES_TEXT}\n\n\n${LIST}`);
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_REPOSITORY: 'o/r' };
    const renotes = (tag) => spawnSync(process.execPath, [script, 'renotes', tag, current], { cwd: repo, env, encoding: 'utf8' });
    const ok = renotes('app-v0.1.2');
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(ok.stdout, `# Patch Notes: Silver\n\n## Raids\n- 30 silver.\n\n\n${LIST}`, 'main checked out, #549 after the tag never reaches it');
    const missing = renotes('app-v0.1.9');
    assert.equal(missing.status, 1, 'a tag this checkout does not have: nothing is written');
    assert.equal(missing.stdout, '');
    assert.match(missing.stderr, /the release is left as it is: no tag app-v0\.1\.9 in this checkout/);
    writeFileSync(join(bin, 'fail'), '');
    const down = renotes('app-v0.1.2');
    assert.equal(down.status, 1, 'GitHub down: the step fails and the release keeps its notes');
    assert.equal(down.stdout, '', 'nothing reaches release-notes.md');
    assert.match(down.stderr, /the notes could not be read - the release is left as it is: gh: Server Error \(HTTP 502\)/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(bin, { recursive: true, force: true });
  }
});

// DFO-83 (2026-11-07): REL7's workflow test (the by-hand/on-description-edit wiring of
// .github/workflows/release-notes.yml) was removed with the workflow itself. That workflow used
// `pull_request_target` and was the specific hazard flagged for the inherited-operational-Actions cleanup -
// opening a pull request that deleted it could still have run old main's copy. The `desktopRelease.mjs renotes`
// logic it called is still covered by the test above.
