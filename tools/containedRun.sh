#!/usr/bin/env bash
# DFO-83 / DFO-11 containment design — NOT YET AUTHORIZED TO RUN.
#
# Checked in for independent static review only. Two modes, same boundary:
#   tools/containedRun.sh <command>                    network DENIED (default) - repository and
#                                                       dependency LIFECYCLE code (lint, types, a
#                                                       test shard, a build, a sweep, `npm rebuild`).
#   tools/containedRun.sh --allow-network <command>     network ALLOWED - the ONE step that needs
#                                                       it (`npm ci --ignore-scripts`, acquisition
#                                                       only, no lifecycle scripts). See "DEPENDENCY
#                                                       ACQUISITION vs. LIFECYCLE EXECUTION" below
#                                                       for why both modes share this one script.
# Both modes apply:
#   1. an ENVIRONMENT ALLOWLIST — `bwrap --clearenv` starts the sandboxed process with NO
#      environment at all, then only the names below are re-added with `--setenv`, so any
#      credential-shaped variable this shell happened to inherit (a developer's export, an
#      org/environment-level secret, ...) is dropped by construction, not by trying to name and
#      unset it (a denylist would miss whatever we didn't think to name). This applies to the
#      `--allow-network` acquisition phase too (REVIEW FIX, DFO-83 52222/52236: "do not inherit
#      real HOME/config" was a requirement on dependency preparation, not only on lifecycle code);
#   2. an ALLOWLISTED FILESYSTEM BOUNDARY built by `bwrap` (bubblewrap), not a hand-rolled
#      `unshare`/`mount` script (REVIEW FIX, DFO-83 52222: a prior draft here only replaced $HOME
#      with a fresh tmpfs inside a private mount namespace it assembled itself - a real
#      filesystem/mount boundary, but still "the real root minus $HOME", not an allowlist of only
#      what the command actually needs). bwrap instead starts from NOTHING and the sandboxed
#      process sees ONLY what is explicitly bound in below: the read-only system directories a
#      dynamically-linked `node`/`bash`/`git` needs to run at all (/usr, /bin, /lib, /lib64), a
#      fresh /proc and /dev bwrap constructs itself (not the host's), a fresh empty /tmp, the
#      repository checkout at its original path, a DISPOSABLE STAGING COPY of the CI runner's
#      scratch directory rather than the real one (see "DISPOSABLE RUNNER_TEMP STAGING" below),
#      and a fresh empty tmpfs standing in for $HOME. Nothing else on the host - no other path,
#      credential file, or mounted secret - is reachable from inside the sandbox by any name,
#      literal or discovered, because nothing else was ever bound in. This also sidesteps a
#      correctness problem the hand-rolled version had to solve by hand (anchoring the checkout
#      outside $HOME before masking it, then binding the anchor back): bwrap resolves every
#      `--bind SRC DEST` source against the real host filesystem regardless of where it falls in
#      the argument list, so `--tmpfs $HOME` followed by `--bind $ROOT $ROOT` (with $ROOT nested
#      under $HOME, as it is on GitHub-hosted runners) correctly ends up with $ROOT visible and the
#      rest of $HOME masked, with no ordering trick of ours required - that is bwrap's own
#      documented design, not an assumption;
#   3. a NETWORK-DENIED namespace (`--unshare-net`) in the default mode only: no interface but
#      loopback, so a request toward any real external host fails at the kernel
#      (ECONNREFUSED/ENETUNREACH), not a best-effort stub. `--unshare-pid` (both modes)
#      additionally hides the host's own process tree (see "CHILD-PROCESS CONFINEMENT" below -
#      this is load-bearing for that claim, not decorative);
#   4. FAIL-CLOSED canaries before the real command runs: in default mode, if a real external host
#      still answers (the network namespace did not take), this refuses to run. In BOTH modes: if
#      $HOME still resolves to the real filesystem object (the tmpfs mount did not take), or if the
#      checkout's own package.json is missing (the bind-in did not take), this refuses to run the
#      real command rather than proceed unprotected.
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
#   - an EMPTY disposable directory bound at $RUNNER_TEMP's real path, holding ONLY the one named
#     input/output path (if any) a caller explicitly declares - see "DISPOSABLE RUNNER_TEMP
#     STAGING" immediately below. Nothing else from the real $RUNNER_TEMP is ever made visible.
#   - /proc, /dev, /tmp: bwrap's own freshly-constructed versions (not the host's), needed for
#     ordinary process operation (reading own PID's /proc entry, /dev/null, /dev/urandom, a scratch
#     /tmp some tools assume exists) - not a bind of anything the host itself put there.
#
# DISPOSABLE RUNNER_TEMP STAGING, an explicit PER-CALLER TRANSFER CONTRACT (REVIEW FIX, DFO-83
# 52252: a prior draft here copied the ENTIRE real $RUNNER_TEMP directory's contents into a
# disposable directory before binding that in, and copied the ENTIRE resulting tree back out on
# exit. That was still wrong, just one layer removed: the full point-in-time COPY was just as
# readable to the sandboxed command as the real directory would have been - including any
# credential or unrelated cross-step data anyone else left in RUNNER_TEMP - and the whole-tree
# copy-back let the sandboxed command influence arbitrary files returned to the live runner
# directory. Fixed by never exposing "the contents of RUNNER_TEMP" as a concept at all: the
# disposable directory this binds in starts and stays EMPTY except for exactly what a caller
# explicitly names via two optional environment variables it sets on its own workflow step, each
# naming ONE path relative to $RUNNER_TEMP:
#   - CONTAINED_RUN_TEMP_IN: an existing input the command needs to READ (e.g. test-times.yml's
#     downloaded shard artifacts). Copied into the disposable directory, at the SAME relative
#     path, before the sandbox runs - nothing else from the real directory is copied alongside it.
#     Fails closed (exit 94) if the named path does not exist at the real location: a declared,
#     required input that is missing is a configuration error, not something to proceed past
#     silently with an empty directory.
#   - CONTAINED_RUN_TEMP_OUT: an output artifact the command is expected to WRITE (e.g. a test
#     shard's `--record` file). Copied back out to the real $RUNNER_TEMP, at the same relative
#     path, after the command exits (success or failure, via a trap - matching this ticket's
#     existing tolerance for a partial/missing record file) - ONLY that one named path, if it
#     exists; nothing else the command wrote anywhere else in its copy of $RUNNER_TEMP is ever
#     copied back, so it cannot influence any other file in the live runner directory.
# Neither variable set (the common case - lint/types/build/sweep/intro checks never touch
# $RUNNER_TEMP at all): $RUNNER_TEMP is not bound into the sandbox in any form. Only the two
# callers that actually need it (see "Callers" below) set one of these each - never both at once
# today, though the mechanism supports a caller that needs both.
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
# DEPENDENCY ACQUISITION vs. LIFECYCLE EXECUTION (REVIEW FIX, DFO-83 52222/52236: "Esbuild's
# required install behavior must be preserved, not used to exempt dependency scripts from the
# credential-free phase/boundary" - a prior draft here left `npm ci` (scripts included) entirely
# outside this script, reasoning that esbuild's own `postinstall` needed the real registry/network.
# That reasoning is withdrawn: it was never actually verified against esbuild's own code. Reading
# node_modules/esbuild/install.js (0.28.1): its `checkAndPreparePackage()` first does
# `require.resolve('@esbuild/linux-x64/bin/esbuild')` (the platform package) - and ONLY falls back
# to a live HTTPS download (`downloadDirectlyFromNPM`) in the `catch` branch, if that local resolve
# fails. `@esbuild/linux-x64` is declared as an `optionalDependencies` entry in esbuild's own
# package.json and is pinned with a `resolved` registry URL in package-lock.json - meaning
# `npm ci --ignore-scripts` (which skips lifecycle SCRIPTS/hooks but NOT ordinary dependency
# resolution - optionalDependencies are still installed as regular packages) places it in
# node_modules on its own, before any script runs. So on this locked dependency tree, esbuild's
# postinstall takes the local-only path (`require.resolve` succeeds) and makes no network call -
# confirmed by reading its logic, not assumed from its presence in node_modules. It CAN safely run
# inside the network-denied boundary. This produces an actual two-phase split, not an exemption:
#   1. ACQUISITION (`tools/containedRun.sh --allow-network npm ci --ignore-scripts`): network
#      allowed (the registry fetch needs it), but $HOME is still the isolated tmpfs and the env
#      is still allowlisted - credential-free, as required, just not network-denied. No lifecycle
#      script runs in this phase, ours or any dependency's.
#   2. LIFECYCLE EXECUTION (`tools/containedRun.sh npm rebuild`, default network-denied mode):
#      re-runs every installed package's own install/postinstall scripts (today, only esbuild's -
#      confirmed by reading every installed package.json for an install/preinstall/postinstall key)
#      inside the full boundary, network denied. `npm rebuild` (not naming `esbuild` specifically)
#      is deliberately not narrowed further: a future dependency's own lifecycle script would be
#      picked up automatically, and if one ever genuinely needs network unlike esbuild's does, this
#      FAILS CLOSED (the build breaks loudly, complaining network is unavailable) rather than
#      silently running it with real network/credentials - the correct failure direction even
#      though it would need a human decision to resolve, not a silent compromise either way.
# package.json's own former top-level `postinstall` (our repository's OWN code, not a dependency's)
# is a separate, already-fixed issue: removed from package.json entirely, it now runs only via the
# explicit, already-contained FIRST-VISIT pins step and the Vite build plugin that independently
# regenerates it - see those files for that half of this.
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
#   - `npm rebuild`'s own exit behaviour and output when there is genuinely nothing to rebuild (a
#     cache-hit path never calls it at all - see "Callers" below) is not exercised here either.
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
# Callers: every retained workflow step that runs repository or dependency-lifecycle code is wired
# through this script:
#   - check.yml's verify.yml (all 3 jobs): `npm ci --ignore-scripts` (--allow-network) and
#     `npm rebuild` on a cache miss, the FIRST-VISIT pins step, `npm run lint`, `npm run types`,
#     each test shard (`node tools/testShards.mjs <i>/8`), and `npm run build`. The test-shard step
#     sets `CONTAINED_RUN_TEMP_OUT=test-times.json` (its own `--record` output - see "DISPOSABLE
#     RUNNER_TEMP STAGING" above).
#   - test-times.yml: the merge step (`node tools/testTimes.mjs --merge ...`), which sets
#     `CONTAINED_RUN_TEMP_IN=test-times` (the shard artifacts an earlier, unwrapped
#     actions/download-artifact step already placed there). No npm ci here - this job does not
#     need node_modules.
#   - eg-sweep.yml: `npm ci --ignore-scripts`/`npm rebuild` on a cache miss, and both sweep steps -
#     neither touches $RUNNER_TEMP, so neither sets either variable and it is not bound in at all.
#   - intro-quality.yml: `npm ci --ignore-scripts`/`npm rebuild`, the intro's own tests, the audio
#     landmark check, the live probe, and the review capture - same as eg-sweep.yml, none of these
#     touch $RUNNER_TEMP.
# It must NOT wrap `npx playwright install --with-deps chromium` or the `which ffmpeg || apt-get
# install` step: both need real network AND real system-level write access (`--with-deps`/apt
# write to /var/lib/dpkg, /etc/apt - not something any $HOME/credential-isolation model addresses,
# and not bound into this sandbox's filesystem allowlist at all), so neither fits either mode of
# this script. They stay in a separate, unwrapped step as before.
#
# Usage (once this design is reviewed and the execution hold is explicitly released):
#   tools/containedRun.sh --allow-network npm ci --ignore-scripts
#   tools/containedRun.sh npm rebuild
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

NETWORK_MODE="deny"
if [ "${1-}" = "--allow-network" ]; then
  NETWORK_MODE="allow"
  shift
fi

if [ "${1-}" = "--inside-sandbox" ]; then
  shift
  # Already inside the bwrap sandbox below: namespaces applied, env cleared and reallowlisted,
  # filesystem assembled. Verify it actually took before running the real command.
  if [ "${CONTAINED_RUN_NETWORK_MODE:-deny}" = "deny" ]; then
    if timeout 2 bash -c 'exec 3<>/dev/tcp/1.1.1.1/443' 2>/dev/null; then
      echo "containedRun: a real external host answered from inside the sandbox - network isolation did not take; refusing to run: $*" >&2
      exit 97
    fi
  fi
  if [ "$(stat -c '%d:%i' "$HOME" 2>/dev/null || echo unknown)" = "${CONTAINED_RUN_REAL_HOME_ID:?CONTAINED_RUN_REAL_HOME_ID must be set by the parent}" ]; then
    echo "containedRun: \$HOME ($HOME) still resolves to the real filesystem object - credential isolation did not take; refusing to run: $*" >&2
    exit 96
  fi
  if [ ! -f "$CONTAINED_RUN_ROOT/package.json" ]; then
    echo "containedRun: $CONTAINED_RUN_ROOT/package.json is missing inside the sandbox - the repository checkout was not bound in correctly; refusing to run: $*" >&2
    exit 95
  fi
  unset CONTAINED_RUN_REAL_HOME_ID CONTAINED_RUN_ROOT CONTAINED_RUN_NETWORK_MODE
  exec "$@"
fi

if [ "$#" -eq 0 ]; then
  echo "usage: $0 [--allow-network] <command> [args...]" >&2
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
ENV_ARGS+=(--setenv CONTAINED_RUN_REAL_HOME_ID "$REAL_HOME_ID" --setenv CONTAINED_RUN_ROOT "$ROOT" --setenv CONTAINED_RUN_NETWORK_MODE "$NETWORK_MODE")

# Disposable RUNNER_TEMP staging, per-caller transfer contract (see "DISPOSABLE RUNNER_TEMP
# STAGING" above): the disposable directory starts and stays EMPTY except for exactly the one
# input and/or one output path a caller names - never a copy of the real directory's contents.
TEMP_IN_REL="${CONTAINED_RUN_TEMP_IN:-}"
TEMP_OUT_REL="${CONTAINED_RUN_TEMP_OUT:-}"
STAGE_DIR=""
if [ -n "$RUNNER_TEMP_DIR" ] && { [ -n "$TEMP_IN_REL" ] || [ -n "$TEMP_OUT_REL" ]; }; then
  STAGE_DIR="$(mktemp -d)"
  if [ -n "$TEMP_IN_REL" ]; then
    SRC="$RUNNER_TEMP_DIR/$TEMP_IN_REL"
    if [ ! -e "$SRC" ]; then
      echo "containedRun: declared input \$RUNNER_TEMP/$TEMP_IN_REL (CONTAINED_RUN_TEMP_IN) does not exist - refusing to run without it: $*" >&2
      exit 94
    fi
    mkdir -p "$(dirname "$STAGE_DIR/$TEMP_IN_REL")"
    cp -a "$SRC" "$STAGE_DIR/$TEMP_IN_REL"
  fi
  if [ -n "$TEMP_OUT_REL" ]; then
    mkdir -p "$(dirname "$STAGE_DIR/$TEMP_OUT_REL")"
  fi
fi
cleanup_stage() {
  if [ -n "$STAGE_DIR" ] && [ -n "$TEMP_OUT_REL" ] && [ -e "$STAGE_DIR/$TEMP_OUT_REL" ]; then
    mkdir -p "$(dirname "$RUNNER_TEMP_DIR/$TEMP_OUT_REL")"
    cp -a "$STAGE_DIR/$TEMP_OUT_REL" "$RUNNER_TEMP_DIR/$TEMP_OUT_REL"
  fi
  [ -n "$STAGE_DIR" ] && rm -rf "$STAGE_DIR"
}
trap cleanup_stage EXIT

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
if [ -n "$STAGE_DIR" ]; then
  BIND_ARGS+=(--bind "$STAGE_DIR" "$RUNNER_TEMP_DIR")
fi
if [ -n "$RUNNER_TOOL_CACHE_DIR" ]; then
  BIND_ARGS+=(--ro-bind-try "$RUNNER_TOOL_CACHE_DIR" "$RUNNER_TOOL_CACHE_DIR")
fi

NAMESPACE_ARGS=(--unshare-pid --die-with-parent)
if [ "$NETWORK_MODE" = "deny" ]; then
  NAMESPACE_ARGS+=(--unshare-net)
fi

STATUS=0
bwrap \
  "${NAMESPACE_ARGS[@]}" \
  --clearenv \
  "${BIND_ARGS[@]}" \
  "${ENV_ARGS[@]}" \
  --chdir "$ROOT" \
  -- "$ROOT/tools/containedRun.sh" --inside-sandbox "$@" || STATUS=$?

exit "$STATUS"
