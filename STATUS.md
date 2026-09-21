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
   The word `PLACEHOLDER` understates the gap, because it points at the numbers. Counted on
   2026-09-21 against `orilife-core@0db96d7`, the two catalogues do not hold the same tasks either:
   `src/tasks.ts` declares **9** keys, `TASK_CATALOG` declares **16**, and the 9 are a subset. Seven
   tasks that production charges for are absent here entirely — `animal.verify`, `care.log`,
   `care.lookup`, `fruit.identify`, `population.count`, `residue.alert`, `tree.verify_add`. A reader
   told only that the values are simulated would reasonably assume the key set is right.
   Reproduce both counts:
   `grep -cE '^  "[a-z0-9._]+": \{' src/tasks.ts` here, and
   `sed -n '/^TASK_CATALOG/,/^}/p' animal_fee.py | grep -cE '^    "[a-z0-9._]+"'` there.
3. Two generations of fee code live in this repository, and **both sit on `main`**. The older bridge
   layer (`src/treasuryClient.ts`, `scripts/*_preview.ts`) reuses the LAMP Treasury Collect layer on
   Preview. The current one is the purpose-written CARP validator under `onchain/`, merged in
   `2b35232` on 2026-08-21: `onchain/orilife_treasury/validators/fee_vault.ak` and
   `donation_escrow.ak`, driven by `onchain/scripts/01_mint_test_carp.mjs` through
   `06_close_vault.mjs`. **The CARP generation on Preprod is the current one.**
4. `onchain/scripts/deployed_preprod.json` records a lifecycle already executed end to end on
   Preprod — mint, open, collect, skim, donate, close — each step carrying its transaction hash.
   Its `previous` block records the failure of an earlier validator revision: that revision had no
   `Close` branch and every branch forced `lovelace_of(out) >= lovelace_of(in)`, so 5,000,000
   lovelace held at `addr_test1wrxmzy4…` cannot be withdrawn by any redeemer. The 900,000 tCARP at
   the same address are not stranded — `Operate` still spends those; only the lovelace is. Both
   halves belong here, because the loss decides nothing and the recoverable balance decides whether
   anyone still has to go back for it. The current revision has `Close`, and `closeTx` is in the
   same file.
5. This file said, until 2026-09-14, that the CARP validator lived on an unmerged branch named
   `claude/hop-dong-phi-carp-preprod`. That was true when written, false two commits later, and by
   2026-09-21 the branch had been deleted outright — `OriLife-Fee` carries three branches, and that
   is not one of them. The paragraph outlived the thing it named twice over, which is the point:
   a document that names a branch does not learn that the branch was merged, and does not learn
   that it was deleted either. When the answer has to be current, read the tree —
   `git ls-tree -r main onchain/` — not this paragraph.

## Relationship to MCR

**None.** This is the fee and accounting layer; it does not touch tree recognition. The production
home of the live fee catalogue is
`orilife-core/MassTreeIdentify/core/animal_fee.py::TASK_CATALOG`, **not** `src/tasks.ts` here —
grepping all of `orilife-core` finds no caller pointing at this directory.

OriLife agent
