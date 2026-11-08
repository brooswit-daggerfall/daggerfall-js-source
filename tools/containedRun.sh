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
#   2. a NETWORK-DENIED namespace (`unshare --net`) with only loopback brought up, so a request
#      toward any real external host fails at the kernel (ECONNREFUSED/ENETUNREACH), not a
#      best-effort stub;
#   3. a CANARY check before the real command runs, so a host where the namespace silently did
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
# structural fix: block egress at the OS level so that convention stops being load-bearing.
# None of the 5 retained workflows (check/verify/test-times/eg-sweep/intro-quality) declare a
# `secrets.*` env today (confirmed by reading them) — this script's allowlist is defense against
# what the invoking SHELL inherits regardless of that, which is DFO-11's actual concern.
#
# Scope note: this wrapper is generic — it should wrap every retained-workflow command that runs
# repository code, not only the eight test shards: check.yml's `npm run lint`/`npm run types`/
# `node tools/testShards.mjs <i>/8`/`npm run build`; eg-sweep.yml's
# `node tools/egSpanSolve.mjs --sweep ...` (both the course sweep and the law9 walk); and
# intro-quality.yml's `node --test test/ui/intro.test.js ...`, `node tools/introAudioCheck.mjs`,
# `node tools/introProbe.mjs`, `node tools/introCapture.mjs`. It must NOT wrap `npm ci` or
# `npx playwright install --with-deps chromium` — those need the real registry/CDN and belong in
# a separate, explicitly network-allowed preparation phase (still env-allowlisted) that runs
# BEFORE this script, never inside it.
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
# `--network=none`, which achieves the same boundary without `unshare`.

set -euo pipefail

if [ "${1-}" = "--inside-netns" ]; then
  shift
  # Already inside the (supposedly) network-denied namespace re-exec'd below.
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

# Allowlist: only what the toolchain itself needs. Nothing credential-shaped is named, so
# nothing credential-shaped survives `env -i`.
ALLOW_VARS=(PATH HOME LANG LC_ALL TERM TMPDIR PWD SHLVL USER LOGNAME CI NODE_OPTIONS NODE_ENV)
ENV_ARGS=()
for v in "${ALLOW_VARS[@]}"; do
  [ -n "${!v+x}" ] && ENV_ARGS+=("$v=${!v}")
done

if ! command -v unshare >/dev/null 2>&1; then
  echo "containedRun: 'unshare' is not available on this host - refusing to run without network isolation: $*" >&2
  exit 98
fi

exec unshare --net --map-root-user \
  env -i "${ENV_ARGS[@]}" \
  "$0" --inside-netns "$@"
