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
#   2. a FRESH, EMPTY $HOME, never the real one, so anything that reads $HOME-relative
#      credentials (npm's ~/.npmrc, git's ~/.gitconfig, ssh's ~/.ssh/*, a cloud CLI's ~/.aws or
#      ~/.config, ...) finds nothing there. REVIEW FIX (DFO-83 52208 finding 2): the prior
#      version forwarded the caller's REAL $HOME through `env -i`, which did not hide any of
#      those files at all.
#      KNOWN RESIDUAL GAP, not silently assumed away: this stops the realistic case - every one
#      of those tools reads $HOME (or os.homedir(), which reads the same variable) - but it does
#      NOT stop code that hardcodes this host's own real home path as a literal string instead of
#      going through $HOME. Closing that fully needs a filesystem/mount boundary or a container
#      with its own image; this script does not attempt one. An earlier draft tried a
#      bind-mount-over-$HOME approach and was caught, before this review, to be actively wrong on
#      GitHub-hosted runners: $GITHUB_WORKSPACE (the checkout this script and the repository it
#      runs live in) is ITSELF a subdirectory of $HOME there (typically
#      /home/runner/work/<repo>/<repo>), so masking all of $HOME would have hidden the repository
#      being tested along with everything else. Pointing $HOME at an unrelated fresh path avoids
#      that failure mode entirely, at the cost of the literal-path gap just named;
#   3. a NETWORK-DENIED namespace (`unshare --net`) with only loopback brought up, so a request
#      toward any real external host fails at the kernel (ECONNREFUSED/ENETUNREACH), not a
#      best-effort stub;
#   4. a CANARY check before the real command runs, so a host where the namespace silently did
#      not take (unsupported kernel, missing capability) FAILS CLOSED instead of running the
#      real command unprotected.
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
# structural fix: block egress and inherited $HOME-relative credentials at the OS level so that
# convention stops being load-bearing.
# None of the 5 retained workflows (check/verify/test-times/eg-sweep/intro-quality) declare a
# `secrets.*` env today (confirmed by reading them) — this script's allowlist and fresh $HOME are
# defense against what the invoking SHELL/RUNNER inherits regardless of that, which is DFO-11's
# actual concern.
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
# || apt-get install` step — those legitimately need the real registry/CDN/package feed and stay
# in a separate, explicitly network-allowed preparation phase (still run with the allowlisted
# environment below, real $HOME included, since dependency managers legitimately need their own
# caches/config there to install anything) that runs BEFORE this script, never inside it.
#
# Usage (once this design is reviewed and the execution hold is explicitly released):
#   tools/containedRun.sh npm run lint
#   tools/containedRun.sh npm run types
#   tools/containedRun.sh node tools/testShards.mjs 1/1
#   tools/containedRun.sh npm run build
#   tools/containedRun.sh node tools/egSpanSolve.mjs --sweep --band 0 --seeds 25 --golden --part 1/1
#
# Prerequisite to verify before relying on this (not checked by running anything here): the host
# actually running it supports an unprivileged (or root) network namespace — `unshare --net` —
# which some containers/kernels restrict. If it does not, this script refuses to run rather than
# proceed unprotected (exit 98); the real fix on such a host is a container started with
# `--network=none`, which achieves the same network boundary without `unshare`.

set -euo pipefail

if [ "${1-}" = "--inside-sandbox" ]; then
  shift
  # Already inside the (supposedly) network-denied namespace, with a fresh, empty $HOME already
  # in place (set by the parent below, before this re-exec - nothing to verify about that part,
  # since it is a plain variable assignment, not a mount that could silently fail to take).
  ip link set lo up 2>/dev/null || true
  if timeout 2 bash -c 'exec 3<>/dev/tcp/1.1.1.1/443' 2>/dev/null; then
    echo "containedRun: a real external host answered from inside the namespace - isolation did not take; refusing to run: $*" >&2
    exit 97
  fi
  exec "$@"
fi

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <command> [args...]" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SANDBOX_HOME="$(mktemp -d)"

# Allowlist: only what the toolchain itself needs. Nothing credential-shaped is named, so nothing
# credential-shaped survives `env -i`. HOME is deliberately NOT in this list - it is added below,
# pointed at the fresh directory above, never at the real one.
ALLOW_VARS=(PATH LANG LC_ALL TERM TMPDIR PWD SHLVL USER LOGNAME CI NODE_OPTIONS NODE_ENV)
ENV_ARGS=()
for v in "${ALLOW_VARS[@]}"; do
  [ -n "${!v+x}" ] && ENV_ARGS+=("$v=${!v}")
done
ENV_ARGS+=("HOME=$SANDBOX_HOME")

if ! command -v unshare >/dev/null 2>&1; then
  echo "containedRun: 'unshare' is not available on this host - refusing to run without network isolation: $*" >&2
  exit 98
fi

exec unshare --net --map-root-user \
  env -i "${ENV_ARGS[@]}" \
  "$ROOT/tools/containedRun.sh" --inside-sandbox "$@"
