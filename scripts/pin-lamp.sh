#!/usr/bin/env bash
# Materialise `vendor/lamp` — LAMP PINNED TO EXACTLY ONE COMMIT, the one this repository compiles
# against.
#
# Why pin at all, and why this file replaced the old `rebuild-blueprint.sh`:
#
# This repository imports LAMP Treasury's transaction builder directly. The import path used to be
# `../../../LAMP/...`, i.e. it compiled against whatever commit LAMP happened to be sitting on in
# the reader's checkout. LAMP changed the `custody` interface from 2 to 3 parameters on 2026-06-15
# (`8e485b3`), so from that day this repository was red on every machine — while the error message
# talked about `CollectParams` rather than about a commit.
#
# Which commit, and why that one: `LAMP_PIN` below is the LAST commit that still matches the
# blueprint in `vendor/treasury-custody.plutus.json`, i.e. matches the custody instance already
# deployed on Preview and recorded in `scripts/deployed_preview.json`. That address holds real
# assets (measured 2026-08-20: 12 ADA and 19,500,000 LAMP). Compiling against a newer LAMP means
# building transactions for a different script hash — that is, losing the ability to spend what is
# sitting at that address.
#
# The old `rebuild-blueprint.sh` did the opposite: it copied the blueprint from LAMP at whatever
# HEAD was, overwrote the matching one, and EXITED 0 as if it had succeeded. It has been deleted.
#
# Read-only, on purpose: this uses `git archive` rather than `git worktree add`, so nothing is ever
# written into the LAMP repository (a worktree registers metadata under LAMP/.git/worktrees and
# leaves a stale entry that breaks the next run).
#
# Usage:  ./scripts/pin-lamp.sh          (LAMP defaults to a sibling of this repository)
#         LAMP_REPO=/some/other/path ./scripts/pin-lamp.sh
set -euo pipefail

# The FULL 40-character hash, not a 7-character prefix. A short name can resolve to a branch, a
# tag, or a different object entirely in a fork that rewrote history — and the check further down
# would not notice, because it asks the same repository that just answered.
LAMP_PIN="ebafc2e1ed6895e741e9febf0d66b62f7873d2ab"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
DEST="$ROOT/vendor/lamp"
LAMP_REPO="${LAMP_REPO:-$(cd "$ROOT/../.." && pwd)/LAMP}"

if [ ! -d "$LAMP_REPO/.git" ]; then
  echo "No LAMP repository at '$LAMP_REPO'." >&2
  echo "The bridge layer only compiles with LAMP on disk. Point LAMP_REPO at it," >&2
  echo "or skip this step: the core (feeEngine, bridge, buckets, tasks) does not need LAMP." >&2
  exit 2
fi

FULL="$(git -C "$LAMP_REPO" rev-parse --verify "${LAMP_PIN}^{commit}" 2>/dev/null || true)"
if [ "$FULL" != "$LAMP_PIN" ]; then
  echo "The LAMP repository at '$LAMP_REPO' does not contain commit $LAMP_PIN — fetch and retry." >&2
  exit 3
fi

rm -rf "$DEST"
mkdir -p "$DEST"
git -C "$LAMP_REPO" archive "$FULL" | tar -x -C "$DEST"

# Verify by CONTENT, not by name. `git archive` strips the history, so there is no HEAD to compare
# against; the check that matters is that this really is the custody interface the vendored
# blueprint was built from — two parameters, not three.
CUSTODY="$DEST/Treasury/onchain/validators/custody.ak"
if [ ! -f "$CUSTODY" ]; then
  echo "Extracted tree has no $CUSTODY — this is not the LAMP repository." >&2
  exit 4
fi
if ! grep -q 'validator custody(proposal_policy: assets.PolicyId, ms_per_epoch: Int)' "$CUSTODY"; then
  echo "custody.ak does not have the expected 2-parameter signature. Either LAMP_REPO points at" >&2
  echo "something else, or $LAMP_PIN is no longer the commit that matches the vendored blueprint." >&2
  exit 5
fi

echo "vendor/lamp pinned at $FULL (verified by content: custody takes 2 parameters)."
