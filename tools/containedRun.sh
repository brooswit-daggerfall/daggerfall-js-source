#!/usr/bin/env bash
# DFO-83 / DFO-11 containment design — NOT YET AUTHORIZED TO RUN.
#
# Checked in for independent static review only. Runs one repository command (lint, types, a
# test shard, a build, an eg-sweep course sweep, an intro-quality probe — anything already
# documented in a retained workflow) with:
#   1. an ENVIRONMENT ALLOWLIST — `bwrap --clearenv` starts the sandboxed process with NO
#      environment at all, then only the names below are re-added with `--setenv`, so any
#      credential-shaped variable this shell happened to inherit (a developer's export, an
#      org/environment-level secret, ...) is dropped by construction, not by trying to name and
#      unset it (a denylist would miss whatever we didn't think to name);
#   2. an ALLOWLISTED FILESYSTEM BOUNDARY built by `bwrap` (bubblewrap), not a hand-rolled
#      `unshare`/`mount` script (REVIEW FIX, DFO-83 52222: a prior draft here only replaced $HOME
#      with a fresh tmpfs inside a private mount namespace it assembled itself - a real
#      filesystem/mount boundary, but still "the real root minus $HOME", not an allowlist of only
#      what the command actually needs). bwrap instead starts from NOTHING and the sandboxed
#      process sees ONLY what is explicitly bound in below: the read-only system directories a
#      dynamically-linked `node`/`bash`/`git` needs to run at all (/usr, /bin, /lib, /lib64), a
#      fresh /proc and /dev bwrap constructs itself (not the host's), a fresh empty /tmp, the
#      repository checkout and the CI runner's scratch/tool-cache directories at their original
#      paths (all required - see "WHY EACH BIND EXISTS" below), and a fresh empty tmpfs standing
#      in for $HOME. Nothing else on the host - no other path, credential file, or mounted
#      secret - is reachable from inside the sandbox by any name, literal or discovered, because
#      nothing else was ever bound in. This also sidesteps a correctness problem the hand-rolled
#      version had to solve by hand (anchoring the checkout outside $HOME before masking it, then
#      binding the anchor back): bwrap resolves every `--bind SRC DEST` source against the real
#      host filesystem regardless of where it falls in the argument list, so `--tmpfs $HOME`
#      followed by `--bind $ROOT $ROOT` (with $ROOT nested under $HOME, as it is on GitHub-hosted
#      runners) correctly ends up with $ROOT visible and the rest of $HOME masked, with no
#      ordering trick of ours required - that is bwrap's own documented design, not an assumption;
#   3. a NETWORK-DENIED namespace (`--unshare-net`): no interface but loopback, so a request
#      toward any real external host fails at the kernel (ECONNREFUSED/ENETUNREACH), not a
#      best-effort stub. `--unshare-pid` additionally hides the host's own process tree (see
#      "CHILD-PROCESS CONFINEMENT" below - this is load-bearing for that claim, not decorative);
#   4. FAIL-CLOSED canaries before the real command runs: if a real external host still answers
#      (the network namespace did not take), if $HOME still resolves to the real filesystem
#      object (the tmpfs mount did not take), or if the checkout's own package.json is missing
#      (the bind-in did not take), this refuses to run the real command rather than proceed
#      unprotected.
#
# WHY EACH BIND EXISTS (none of these are "trust the rest of the host" - each is named because a
# specific caller below needs exactly it, verified by reading that caller, not assumed):
#   - /usr, /bin, /lib, /lib64 (read-only): the dynamic linker and shared libraries `node`, `bash`,
#     `npm`'s own shebang interpreter, and `git` (invoked by `npm run build`'s own `postbuild: git
#     checkout -- src/buildTag.js` hook - confirmed by reading package.json; this runs INSIDE the
#     sandbox because it is part of `npm run build`) need to execute at all. This is intentionally
#     a coarse, not a narrowly-enumerated, surface: naming the exact shared-library closure each
#     binary needs requires `ldd`-style introspection, which needs execution this pass does not
#     have. It is still read-only and contains no credential - the gap it leaves is breadth of the
#     toolchain surface, not a credential exposure, and is named as a residual below, not hidden.
#   - $RUNNER_TOOL_CACHE (read-only, if set): `actions/setup-node@v4` installs the pinned Node
#     under this directory (not under /usr) and prepends it to PATH - without binding this in,
#     `node`/`npm`/`npx` would not be found inside the sandbox at all. NOT independently verified
#     against the live runner image (no execution available) - named as a prerequisite below.
#   - $ROOT (the repository checkout, read-write): every wrapped command's own code and the files
#     it reads or writes (test-harness/ output, a generated src/firstVisitPins.js, dist/ from a
#     build) live here.
#   - $RUNNER_TEMP (read-write, if set): `tools/testShards.mjs --record` writes a shard's file
#     times here, and it is itself a subdirectory of $HOME on GitHub-hosted runners (see above).
#   - /proc, /dev, /tmp: bwrap's own freshly-constructed versions (not the host's), needed for
#     ordinary process operation (reading own PID's /proc entry, /dev/null, /dev/urandom, a scratch
#     /tmp some tools assume exists) - not a bind of anything the host itself put there.
#
# CHILD-PROCESS CONFINEMENT, stated accurately rather than assumed (REVIEW FIX, DFO-83 52222: the
# prior draft's header claimed "a child that itself calls `unshare` to leave the namespace is not
# something this script can prevent" - that claim is WRONG and is withdrawn here, not repeated.
# Namespaces nest: a child calling `unshare` from inside this sandbox creates a NEW namespace
# underneath the existing one, which is isolated from the HOST exactly as its parent is - it does
# not and cannot "unshare its way back out" to host networking or the host filesystem, because
# `unshare` only ever creates MORE isolation, never grants access to a different, already-existing
# namespace it wasn't given a handle to. The only real escape class is `setns()` into a DIFFERENT,
# pre-existing namespace (the host's) via an open file descriptor or a `/proc/<pid>/ns/*` path the
# sandboxed process can still see and has permission to use - and `--unshare-pid` here specifically
# forecloses the ordinary version of that: the sandboxed process's own /proc only shows its own
# (now-separate) process tree, so `/proc/1/ns/net` inside the sandbox is ITS OWN init's namespace,
# not the host's. Setns into the host's namespace from inside would need a file descriptor to it
# that was never passed in and a capability (CAP_SYS_ADMIN in the TARGET namespace's owning user
# namespace) the sandboxed process does not hold with respect to the host's. The residual risk is
# therefore not "a child can trivially re-exec its way out" (false, and no longer claimed) but a
# kernel or bwrap-itself vulnerability - a threat model every sandboxing approach shares, including
# a full container, and outside what any script-level design here can close.
#
# DEPENDENCY ACQUISITION vs. REPOSITORY LIFECYCLE EXECUTION (REVIEW FIX, DFO-83 52222 point 3):
# `npm ci` legitimately needs the real registry and real network, and stays outside this script
# for that reason, as before. But package.json's own top-level `"postinstall": "node
# scripts/firstVisitPins.mjs"` hook meant OUR repository's own code (not a third-party package's)
# ran automatically, uncontained, DURING that networked `npm ci` phase - the exact coupling this
# review comment asked to be separated. Fixed by removing that top-level postinstall script
# entirely (see package.json) rather than reaching for a blanket `npm ci --ignore-scripts`: reading
# every installed package's own lifecycle scripts first (not assumed) found `esbuild`'s own
# `postinstall` ("node install.js", which fetches ITS OWN platform-specific native binary) is the
# only one present in this tree today, and it is load-bearing - `npm run build` uses esbuild
# directly (via Vite and scripts/privateRelay.mjs), so suppressing ALL install scripts would
# silently break the build the first time it actually ran, which is exactly the "preserve
# necessary install behavior explicitly rather than silently omit it" failure mode this comment
# warned against. A third-party package fetching its own published native binary from its own
# trusted distribution channel, as a normal part of what "installing a dependency" means in the
# npm ecosystem, is not the same risk category DFO-11 is about (OUR repository code reaching a
# live Stripe endpoint) - so `npm ci` keeps running scripts, unwrapped, as before. What changed is
# narrower and verified: firstVisitPins.mjs no longer runs as part of that phase at all. It is
# still generated exactly as before, just always via the explicit "FIRST-VISIT pins" step each
# workflow already has (now load-bearing on every run, not only a cache-hit fallback - which is
# itself a simplification, since that step previously ran twice on a cache miss: once via
# postinstall during `npm ci`, once via itself) and via the Vite build plugin
# (firstVisitPinsPlugin) that already regenerates it independently at the start of every build -
# both of those paths run INSIDE this script already. Going further and denying `npm ci` itself
# the real $HOME/registry cache (which 52222 also asks for - "do not inherit real HOME/config" for
# dependency preparation) is explicitly NOT attempted here: distinguishing which of this project's
# other dependencies' install scripts are load-bearing (only esbuild's was checked exhaustively;
# the rest were read for an install/postinstall KEY, not for whether the logic behind it is
# load-bearing) from which are safe to suppress cannot be done reliably without either running
# `npm ci --ignore-scripts` to see what breaks (no execution authorized) or auditing every
# dependency's install-time logic by hand - named as an open prerequisite below, not guessed at.
#
# WHAT A GREP CANNOT PROVE (REVIEW FIX, DFO-83 52222, correcting 52217's methodology): an earlier
# comment on this ticket treated "no `import` of `http`/`https`/a fetch-named package" in
# scripts/firstVisitPins.mjs and tools/computationPin.mjs as proof neither has network access.
# That is withdrawn as proof. Re-checked here more broadly - for the global `fetch` (available in
# Node with no import at all), `child_process`/`exec`/`spawn` (could shell out to curl/wget/nc),
# `node:dns`/`node:net`/`node:tls`, `WebSocket`/`EventSource`, and dynamic `import()`/`require()`/
# `eval`/`new Function` (could load or construct something at runtime a static read would not
# show) - none of those appear in either file or their only local imports
# (tools/lib/isMain.mjs, tools/hostScope.mjs). But this is still a static read of source text, not
# a proof of runtime behavior, and is not relied on as one: the property this script actually
# guarantees is the network-namespace denial itself (`--unshare-net`, kernel-enforced, fails
# closed) - not any source-level audit of what a script "would" do. The audit is corroborating
# evidence; the namespace is the control.
#
# RESIDUAL / UNVERIFIED, named rather than assumed (none of this execution hold's no-probes rule
# can be worked around - each of these needs either running something or deeper manual audit than
# a bounded pass covers):
#   - bwrap's actual presence and whether unprivileged user namespaces are permitted is NOT
#     verified against the real GitHub-hosted `ubuntu-24.04`/`ubuntu-latest` runner image - only
#     against this local review sandbox (present here). If it is missing there, every wrapped step
#     would need a prior `apt-get install -y bubblewrap` (mirrors intro-quality.yml's existing
#     `which ffmpeg || apt-get install` pattern) - not added to the workflows in this pass, since
#     whether it is even needed is itself unverified; report this as an open prerequisite rather
#     than add an untested apt-get step speculatively.
#   - $RUNNER_TOOL_CACHE is bound in on a best-effort basis (`--ro-bind-try`); whether that is the
#     ONLY filesystem location this runner's PATH will reference for node/npm/npx is not
#     independently confirmed. A PATH entry outside every bound path fails LOUDLY ("command not
#     found") rather than silently permitting a hole, which is the correct failure direction even
#     though it is inconvenient - but it is a real way this could simply not run yet, not
#     necessarily a way it would run unsafely.
#   - whether `git checkout -- src/buildTag.js` (npm's own `postbuild` hook, which fires inside
#     this sandbox as part of `npm run build`) needs `~/.gitconfig`'s `safe.directory` entry (which
#     `actions/checkout@v4` sets, typically under $HOME) to avoid a "dubious ownership" refusal is
#     not confirmed either way - plausible it does not matter here (ownership is not mismatched on
#     a GitHub-hosted VM runner, only typically an issue under certain container/UID-remap setups),
#     but not tested.
#   - the /usr, /bin, /lib, /lib64 read-only bind is a coarse toolchain surface, not narrowed to
#     the exact binaries/libraries each wrapped command needs (see "WHY EACH BIND EXISTS" above).
#
# WHY THIS EXISTS (DFO-11 / DFO-83, 2026-11-07): the retained check.yml -> verify.yml workflow
# runs test/**/*.test.js via tools/testShards.mjs — the SAME set DFO-11's own full run stopped
# over a potential credential-bearing live Stripe request. Concretely: server-account/src/shop.js
# stripeCheckout(fetch, env, fields) calls the `fetch` IT IS GIVEN; server-account/src/index.js's
# SHOP_OPEN_ROUTES handler (the real Worker's own request path) hard-wires that to
# `(u, init) => globalThis.fetch(u, init)` — the real global fetch — with no isolation of its own.
# The ONLY thing that keeps a test exercising that path (e.g. test/server/shop_service.test.js's
# `press()`/`shopCheckout()` calls, driven end to end through the real Worker per that file's own
# header comment) from reaching https://api.stripe.com for real today is each test file's own
# `stripe()` helper monkeypatching `globalThis.fetch` before the call and restoring it after — a
# per-test-author CONVENTION, not a boundary. A test that forgets it (now or in a future PR) would
# make a real, credential-bearing request to Stripe's live API. This script is the proposed
# structural fix: block egress and inherited credential files at the OS level so that convention
# stops being load-bearing.
# None of the 5 retained workflows (check/verify/test-times/eg-sweep/intro-quality) declare a
# `secrets.*` env today (confirmed by reading them) — this script's allowlist and filesystem
# boundary are defense against what the invoking SHELL/RUNNER inherits regardless of that, which is
# DFO-11's actual concern.
#
# Callers: every retained workflow step that runs repository code is wired through this script —
# not just the eight test shards:
#   - check.yml's verify.yml: the FIRST-VISIT pins step, `npm run lint`, `npm run types`, each
#     test shard (`node tools/testShards.mjs <i>/8`), and `npm run build`.
#   - test-times.yml: the merge step (`node tools/testTimes.mjs --merge ...`).
#   - eg-sweep.yml: both sweep steps (the course sweep and the law9 walk).
#   - intro-quality.yml: the intro's own tests, the audio landmark check, the live probe, and the
#     review capture.
# It must NOT wrap `npm ci`, `npx playwright install --with-deps chromium`, or the `which ffmpeg
# || apt-get install` step — those legitimately need the real registry/CDN/package feed and stay
# in a separate, explicitly network-allowed preparation phase that runs BEFORE this script, never
# inside it.
#
# Usage (once this design is reviewed and the execution hold is explicitly released):
#   tools/containedRun.sh npm run lint
#   tools/containedRun.sh npm run types
#   tools/containedRun.sh node tools/testShards.mjs 1/1
#   tools/containedRun.sh npm run build
#   tools/containedRun.sh node tools/egSpanSolve.mjs --sweep --band 0 --seeds 25 --golden --part 1/1
#
# Prerequisite to verify before relying on this (not checked by running anything here): bwrap
# itself must be present and able to create user+mount+net+pid namespaces unprivileged on the
# actual runner image - see "RESIDUAL / UNVERIFIED" above. If bwrap is unavailable, this script
# refuses to run rather than fall back to a hand-rolled namespace equivalent (exit 98) - two prior
# hand-rolled attempts on this ticket each had a bug only caught by re-reading the logic, never by
# running it, which is why this pass stopped trying to hand-roll a replacement and requires the
# vetted tool instead of a third from-scratch attempt.

set -euo pipefail

if [ "${1-}" = "--inside-sandbox" ]; then
  shift
  # Already inside the bwrap sandbox below: namespaces applied, env cleared and reallowlisted,
  # filesystem assembled. Verify it actually took before running the real command.
  if timeout 2 bash -c 'exec 3<>/dev/tcp/1.1.1.1/443' 2>/dev/null; then
    echo "containedRun: a real external host answered from inside the sandbox - network isolation did not take; refusing to run: $*" >&2
    exit 97
  fi
  if [ "$(stat -c '%d:%i' "$HOME" 2>/dev/null || echo unknown)" = "${CONTAINED_RUN_REAL_HOME_ID:?CONTAINED_RUN_REAL_HOME_ID must be set by the parent}" ]; then
    echo "containedRun: \$HOME ($HOME) still resolves to the real filesystem object - credential isolation did not take; refusing to run: $*" >&2
    exit 96
  fi
  if [ ! -f "$CONTAINED_RUN_ROOT/package.json" ]; then
    echo "containedRun: $CONTAINED_RUN_ROOT/package.json is missing inside the sandbox - the repository checkout was not bound in correctly; refusing to run: $*" >&2
    exit 95
  fi
  unset CONTAINED_RUN_REAL_HOME_ID CONTAINED_RUN_ROOT
  exec "$@"
fi

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <command> [args...]" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

REAL_HOME="${HOME:?HOME must be set}"
REAL_HOME_ID="$(stat -c '%d:%i' "$REAL_HOME")"   # read-only; recorded for the fail-closed check above, nothing written
RUNNER_TEMP_DIR="${RUNNER_TEMP:-}"
RUNNER_TOOL_CACHE_DIR="${RUNNER_TOOL_CACHE:-}"

if ! command -v bwrap >/dev/null 2>&1; then
  echo "containedRun: 'bwrap' (bubblewrap) is not installed on this host - refusing to run without a verified allowlisted filesystem boundary: $*" >&2
  exit 98
fi

# Allowlist: only what the toolchain itself needs. Nothing credential-shaped is named, so nothing
# credential-shaped survives `--clearenv`. HOME keeps its real path STRING (tools that expect it
# to look like a normal home directory keep working); what changes is what that path resolves to
# inside the sandbox - a fresh, empty tmpfs (see the bind list below), not this list.
ALLOW_VARS=(PATH HOME LANG LC_ALL TERM TMPDIR PWD SHLVL USER LOGNAME CI NODE_OPTIONS NODE_ENV RUNNER_TEMP RUNNER_TOOL_CACHE)
ENV_ARGS=()
for v in "${ALLOW_VARS[@]}"; do
  [ -n "${!v+x}" ] && ENV_ARGS+=(--setenv "$v" "${!v}")
done
ENV_ARGS+=(--setenv CONTAINED_RUN_REAL_HOME_ID "$REAL_HOME_ID" --setenv CONTAINED_RUN_ROOT "$ROOT")

# Filesystem allowlist: nothing is visible unless bound in below. Order matters only in that a
# later entry nested under an earlier one wins there (bwrap's own documented behaviour) - which is
# exactly how $ROOT/$RUNNER_TEMP_DIR stay visible despite $REAL_HOME being masked, even though both
# are typically subdirectories of $HOME on GitHub-hosted runners, with no anchor-mount trick of
# ours required. See "WHY EACH BIND EXISTS" above for what each entry is for.
BIND_ARGS=(
  --ro-bind /usr /usr
  --ro-bind-try /bin /bin
  --ro-bind-try /lib /lib
  --ro-bind-try /lib64 /lib64
  --proc /proc
  --dev /dev
  --tmpfs /tmp
  --tmpfs "$REAL_HOME"
  --bind "$ROOT" "$ROOT"
)
if [ -n "$RUNNER_TEMP_DIR" ]; then
  mkdir -p "$RUNNER_TEMP_DIR"
  BIND_ARGS+=(--bind "$RUNNER_TEMP_DIR" "$RUNNER_TEMP_DIR")
fi
if [ -n "$RUNNER_TOOL_CACHE_DIR" ]; then
  BIND_ARGS+=(--ro-bind-try "$RUNNER_TOOL_CACHE_DIR" "$RUNNER_TOOL_CACHE_DIR")
fi

exec bwrap \
  --unshare-net \
  --unshare-pid \
  --die-with-parent \
  --clearenv \
  "${BIND_ARGS[@]}" \
  "${ENV_ARGS[@]}" \
  --chdir "$ROOT" \
  -- "$ROOT/tools/containedRun.sh" --inside-sandbox "$@"
