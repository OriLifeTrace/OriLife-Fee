# STATUS — measured 2026-08-21

This directory existed for a long time but had **never been under any git repository**
(`git rev-parse` returned `fatal: not a git repository`). The first commit was made to **stop
losing work**, not to declare anything finished. This file records what was measured, not what
was hoped.

## Actual size

16 hand-written TypeScript files, **1671 lines**. Everything else in the directory is
`node_modules/`, which is gitignored. There is no `.env` and no key anywhere in the tree; that was
checked before the first `git add`.

## Checks — green (measured 2026-08-21)

```
npx tsc --noEmit                                  → 0 errors      (needs vendor/lamp)
npx vitest run                                    → 57 / 57 pass, 4 files
npx tsc --noEmit -p tsconfig.core.json            → 0 errors      (no LAMP needed)
npx vitest run tests/feeEngine.test.ts \
               tests/bridge.test.ts \
               tests/custodyAddress.test.ts       → 54 / 54 pass, 3 files
```

The second pair is what CI runs, because CI has no copy of LAMP. The difference between the two —
`tests/emulator.integration.test.ts`, three tests — is the honest measure of what the gate does not see.

Before the pin existed, `tsc` reported 1 error and `vitest` 51/54, all three tracing back to
`src/treasuryClient.ts:66` (`CollectParams` missing `validFromMs`, `msPerEpoch`). The real cause
was not in that file.

**This repository used to import LAMP source through relative paths that climbed out of its own
root** (`../../../LAMP/...`, 12 of them). That means it compiled against whatever commit LAMP
happened to be sitting on, on whoever's disk. LAMP changed the `custody` interface from 2 to 3
parameters on 2026-06-15 (`8e485b3`), so from that day on this repository was red on every machine
— while the error message talked about `CollectParams` and never mentioned a commit. Three red
checks were one symptom of **an unpinned dependency**, not three code defects.

The fix: `scripts/pin-lamp.sh` materialises `vendor/lamp` from LAMP at exactly commit `ebafc2e1`,
the LAST commit that still matches the blueprint in `vendor/treasury-custody.plutus.json` — that
is, matches the custody instance already deployed on Preview. The script pins by the full 40-char
hash and then verifies by *content* (it greps for the 2-parameter validator signature), because a
short name alone can resolve to a branch or tag in some other repository. `vendor/lamp/` is
gitignored: this repository pins another repository's commit, it does not copy that repository's
code into itself.

## The Preview custody instance still holds assets — measured

Address `addr_test1wzz0uxpt58vllu2patcldqa7dvgwkr2j5yagcs8s9lmh37gq34gs9`, read from Blockfrost
Preview on 2026-08-21:

```
lovelace                                       12,000,000
28e916b0…4c414d50   (LAMP)                     19,500,000
b1474a77…744c414d50 (tLAMP)                   120,000,000
c123bdfb…744c414d50 (tLAMP, other policy)       1,000,000
0c2ab8cf…747265732d7265736576 (tres-resev)              1
171350413…74726561737572792d6c616d70 (treasury-lamp)    1
```

Two of those are NFTs (quantity 1); three are fungible batches under three different policy IDs,
only the first of which is the LAMP this repository prices in. Several UTxOs, one of them carrying
an inline datum with `instance_id = orilife-fee-v1` and a three-line bucket ledger.

**That address holds real assets.** It follows that rebuilding the blueprint against a newer LAMP
changes the script hash, which changes the address, which means losing the ability to spend what
is sitting there. That is the reason for the pin — not a preference.

`tests/custodyAddress.test.ts` turns this into a check that runs without LAMP: it derives the
address from the vendored blueprint and fails if it stops matching `scripts/deployed_preview.json`.

## `scripts/rebuild-blueprint.sh` has been DELETED

It copied the blueprint from LAMP at whatever HEAD was checked out, overwrote the one that
matched, and then **exited 0 as if it had succeeded**. It is replaced by `scripts/pin-lamp.sh`,
which does the opposite: it pins, and it refuses if it cannot pin.

Note for anyone following older documentation: `OriLife-Specs/Fee/FeeMechanism-TECH.md` and
`-EXEC.md` still tell the reader to run the deleted script. Those two lines are wrong.

## Still open

1. The bridge layer (`src/treasuryClient.ts`, `e2e/`, `scripts/*_preview.ts`) only compiles with
   the LAMP repository on disk. The core layer (`feeEngine`, `bridge`, `buckets`, `tasks`) needs
   nothing. A public repository whose bridge layer needs a private repository is a real
   constraint, and the README says so up front rather than letting an outsider discover it by
   failing.
2. `src/tasks.ts:28` declares its own price catalogue to be a `PLACEHOLDER`. The fee catalogue
   actually running in production is
   `orilife-core/MassTreeIdentify/core/animal_fee.py::TASK_CATALOG`.
3. Two generations of fee code live in this repository: `main` reuses the LAMP Treasury Collect
   layer on Preview, while the branch `claude/hop-dong-phi-carp-preprod` carries a purpose-written
   CARP validator on Preprod. Nothing in the tree states which one is current.

## Relationship to MCR

**None.** This is the fee and accounting layer; it does not touch tree recognition. The production
home of the live fee catalogue is
`orilife-core/MassTreeIdentify/core/animal_fee.py::TASK_CATALOG`, **not** `src/tasks.ts` here —
grepping all of `orilife-core` finds no caller pointing at this directory.

OriLife agent
