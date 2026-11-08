#!/usr/bin/env bash
# DFO-83 / DFO-11 containment design — NOT YET AUTHORIZED TO RUN.
#
# Checked in for independent static review only. Runs one repository command (lint, types, a
# test shard, a build, an eg-sweep course sweep, an intro-quality probe — anything already
# documented in a retained workflow) with:
#   1. an ENVIRONMENT ALLOWLIST — `env -i` starts from nothing and only the names below are
#      re-added, so any credential-shaped variable this shell happened to inherit (a developer's
#      export, an org/environment-level secret, ...) is dropped by construction, not by trying
#      to name and unset it (a denylist would miss whatever we didn't think to name);
#   2. an ACTUAL FILESYSTEM/MOUNT BOUNDARY around $HOME, not just a changed environment variable
#      (REVIEW FIX, DFO-83 52208 finding 2 / 52213: a prior draft only pointed $HOME at a fresh
#      directory, which a reviewer correctly rejected - code that reads the runner's real home
#      path literally, or discovers it another way, would still see the real files). This script
#      replaces the real $HOME with an empty tmpfs inside a private mount namespace, so nothing
#      under it - ~/.npmrc, ~/.gitconfig, ~/.ssh/*, a cloud CLI's ~/.aws or ~/.config, a cached
#      gh/git token, anything else left there - is reachable from inside the sandbox by ANY path
#      that resolves through $HOME, literal or not. The repository checkout and the CI runner's
#      own scratch directory are narrowly, explicitly re-exposed at their original paths
#      (REQUIRED on GitHub-hosted runners: $GITHUB_WORKSPACE and $RUNNER_TEMP are themselves
#      subdirectories of $HOME there - typically /home/runner/work/<repo>/<repo> and
#      /home/runner/work/_temp - so masking $HOME wholesale with nothing re-bound would also hide
#      the repository being tested and its own scratch space, breaking the workflow outright
#      rather than narrowing it). Nothing else under the real $HOME is re-exposed;
#   3. a NETWORK-DENIED namespace (`unshare --net`) with only loopback brought up, so a request
#      toward any real external host fails at the kernel (ECONNREFUSED/ENETUNREACH), not a
#      best-effort stub;
#   4. FAIL-CLOSED canaries before the real command runs: if the real $HOME is still reachable
#      through $HOME (the mount did not take), if the repository checkout did not come back
#      after the mask (the re-exposure did not take), or if the network namespace did not take,
#      this refuses to run the real command rather than proceed unprotected.
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
# `secrets.*` env today (confirmed by reading them) — this script's allowlist and HOME boundary
# are defense against what the invoking SHELL/RUNNER inherits regardless of that, which is
# DFO-11's actual concern.
#
# RESIDUAL GAPS, named rather than assumed away:
#   - this masks $HOME only. A credential filed somewhere else on the runner entirely (a path
#     under /etc, say, or a sibling directory the runner mounted outside $HOME) is not covered.
#     The realistic case this defends is the standard one every tool here actually uses -
#     $HOME-relative config for npm/git/ssh/cloud CLIs - not an exhaustive scan of the whole
#     filesystem for secrets that might live somewhere unconventional.
#   - child processes of the contained command inherit its namespaces (Linux namespaces are a
#     property of the process tree, not re-granted per process), so they see the same boundary -
#     but a child that itself calls `unshare` (or otherwise asks the kernel to leave the
#     namespace) is not something this script can prevent from inside; that would need a
#     restrictive seccomp/landlock profile, which this pass does not add.
#   - the dependency/lifecycle preparation phase (`npm ci`, `npx playwright install`, the ffmpeg
#     check - see "Callers" below) deliberately runs OUTSIDE this script, with the real $HOME and
#     real network, because installing anything needs both; this script's boundary starts only
#     once repository code actually runs.
#
# Callers (REVIEW FIX, DFO-83 52208 finding 1): every retained workflow step that runs repository
# code is wired through this script — not just the eight test shards:
#   - check.yml's verify.yml: the FIRST-VISIT pins step, `npm run lint`, `npm run types`, each
#     test shard (`node tools/testShards.mjs <i>/8`), and `npm run build`.
#   - test-times.yml: the merge step (`node tools/testTimes.mjs --merge ...`).
#   - eg-sweep.yml: both sweep steps (the course sweep and the law9 walk).
#   - intro-quality.yml: the intro's own tests, the audio landmark check, the live probe, and the
#     review capture.
# It must NOT wrap `npm ci`, `npx playwright install --with-deps chromium`, or the `which ffmpeg
# || apt-get install` step — those legitimately need the real registry/CDN/package feed and the
# real $HOME (for npm's own cache/config) and stay in a separate, explicitly network-allowed
# preparation phase (still env-allowlisted) that runs BEFORE this script, never inside it.
#
# Usage (once this design is reviewed and the execution hold is explicitly released):
#   tools/containedRun.sh npm run lint
#   tools/containedRun.sh npm run types
#   tools/containedRun.sh node tools/testShards.mjs 1/1
#   tools/containedRun.sh npm run build
#   tools/containedRun.sh node tools/egSpanSolve.mjs --sweep --band 0 --seeds 25 --golden --part 1/1
#
# Prerequisite to verify before relying on this (not checked by running anything here): the host
# actually running it supports an unprivileged (or root) network AND mount namespace with mount()
# permitted inside it (`unshare --net --mount --map-root-user`, then `mount -t tmpfs` and `mount
# --bind` inside that namespace) — some containers/kernels restrict one or both. If the namespace
# itself is unavailable, this script refuses to run rather than proceed unprotected (exit 98); if
# the namespace is available but a mount call inside it still fails for some other reason, `set
# -e` inside the inner script (below) stops before the real command runs, for the same reason.
# The real fix on a host where this is unavailable is a container with its own filesystem image
# (no host credential files bind-mounted in) started with `--network=none`, which achieves both
# boundaries without `unshare`.

set -euo pipefail

if [ "${1-}" = "--inside-sandbox" ]; then
  shift
  # Already inside the (supposedly) network- and mount-isolated namespaces re-exec'd below, with
  # $HOME already replaced and the checkout/runner-temp already re-exposed by the parent.
  ip link set lo up 2>/dev/null || true
  if timeout 2 bash -c 'exec 3<>/dev/tcp/1.1.1.1/443' 2>/dev/null; then
    echo "containedRun: a real external host answered from inside the namespace - network isolation did not take; refusing to run: $*" >&2
    exit 97
  fi
  # Fail closed if $HOME still resolves to the real filesystem object the parent recorded before
  # masking it (same device:inode) - i.e. the mount namespace or the tmpfs mount did not actually
  # take, so the credential boundary would be a no-op.
  if [ "$(stat -c '%d:%i' "$HOME" 2>/dev/null || echo unknown)" = "${CONTAINED_RUN_REAL_HOME_ID:?CONTAINED_RUN_REAL_HOME_ID must be set by the parent}" ]; then
    echo "containedRun: \$HOME ($HOME) still resolves to the real filesystem object - credential isolation did not take; refusing to run: $*" >&2
    exit 96
  fi
  # Fail closed if the checkout's own re-exposure did not take: package.json is this repository's
  # own root marker, checked in and always present at a real checkout's top level.
  if [ ! -f "$CONTAINED_RUN_ROOT/package.json" ]; then
    echo "containedRun: $CONTAINED_RUN_ROOT/package.json is missing inside the sandbox - the repository checkout was not re-exposed correctly; refusing to run: $*" >&2
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

# Allowlist: only what the toolchain itself needs. Nothing credential-shaped is named, so nothing
# credential-shaped survives `env -i`. HOME keeps its real path STRING (tools that expect it to
# look like a normal home directory keep working); what changes is what that path resolves to
# inside the sandbox - see the mount sequence below, not this list.
ALLOW_VARS=(PATH HOME LANG LC_ALL TERM TMPDIR PWD SHLVL USER LOGNAME CI NODE_OPTIONS NODE_ENV RUNNER_TEMP)
ENV_ARGS=()
for v in "${ALLOW_VARS[@]}"; do
  [ -n "${!v+x}" ] && ENV_ARGS+=("$v=${!v}")
done
ENV_ARGS+=("CONTAINED_RUN_REAL_HOME_ID=$REAL_HOME_ID" "CONTAINED_RUN_ROOT=$ROOT")

if ! command -v unshare >/dev/null 2>&1; then
  echo "containedRun: 'unshare' is not available on this host - refusing to run without network/filesystem isolation: $*" >&2
  exit 98
fi

# --net: no interface but loopback, brought up inside --inside-sandbox.
# --mount: a private mount table, so every mount below is invisible outside this process tree and
#   cannot propagate back to the real host filesystem.
# --map-root-user: the unprivileged-userns-clone path most hosts actually allow both of the above
#   under, and what lets the mount calls below succeed unprivileged inside the new namespace.
exec unshare --net --mount --map-root-user \
  env REAL_HOME="$REAL_HOME" REPO_ROOT="$ROOT" RUNNER_TEMP_DIR="$RUNNER_TEMP_DIR" bash -c '
    set -euo pipefail
    # A private mount table (belt-and-suspenders beyond --mount itself) before mounting anything,
    # so nothing here can leak a mount event to the real host even on an unusual propagation setup.
    mount --make-rprivate / 2>/dev/null || true

    # Anchor the repository checkout (and the runner scratch directory, if set) at paths OUTSIDE
    # $HOME, BEFORE masking $HOME - a bind mount keeps pointing at the same underlying files no
    # matter what happens to the path it was taken from afterward, but only if it is taken before
    # that path is masked. Binding the checkout onto itself AFTER masking $HOME would just bind
    # the (by then empty) tmpfs onto itself, which is why this has to happen first, anchored
    # somewhere $HOME masking cannot reach.
    ANCHOR_REPO="$(mktemp -d)"
    mount --bind "$REPO_ROOT" "$ANCHOR_REPO"
    if [ -n "$RUNNER_TEMP_DIR" ]; then
      mkdir -p "$RUNNER_TEMP_DIR"
      ANCHOR_TEMP="$(mktemp -d)"
      mount --bind "$RUNNER_TEMP_DIR" "$ANCHOR_TEMP"
    fi

    # Now mask $HOME: an empty tmpfs, so ~/.npmrc, ~/.gitconfig, ~/.ssh/*, ~/.aws, ~/.config and
    # anything else left there by the real host/runner is gone from this process tree'"'"'s view,
    # by any path that resolves through $HOME.
    mount -t tmpfs -o mode=0700 tmpfs "$REAL_HOME"

    # Re-expose exactly the two things that must stay reachable, narrowly, at their ORIGINAL
    # paths, from the anchors taken above (not from the now-masked originals):
    mkdir -p "$REPO_ROOT"
    mount --bind "$ANCHOR_REPO" "$REPO_ROOT"
    if [ -n "$RUNNER_TEMP_DIR" ]; then
      mkdir -p "$RUNNER_TEMP_DIR"
      mount --bind "$ANCHOR_TEMP" "$RUNNER_TEMP_DIR"
    fi

    exec env -i "$@"
  ' bash "${ENV_ARGS[@]}" "$ROOT/tools/containedRun.sh" --inside-sandbox "$@"
