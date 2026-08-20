# @orilife/fee

Task-fee pricing for OriLife users, plus the bridge that deposits the resulting LAMP into the
treasury buckets (reusing the LAMP Treasury Collect layer — no new on-chain code).

## In one line

A user performs a task (register a tree, run an identity scan, anchor on-chain) → `quoteFee`
prices it in LAMP and splits it across three buckets (PROTOCOL / LAMPNET_REWARD / ANCHOR) →
`buildFeeCollectTx` builds ONE Collect transaction that deposits the whole fee into the treasury.
The `custody.custody.spend` Plutus validator enforces `Σout = Σin` (LAMP is fixed-supply; nothing
is ever burned).

## Two layers, and only one of them runs from a fresh clone

Stated up front so nobody wastes time: **the bridge layer needs the LAMP repository, which is not
public today.** The core layer needs nothing at all.

| | Needs LAMP? | Contains |
|---|---|---|
| **Core** | no | `feeEngine` (pricing) · `bridge` (invariants) · `buckets` · `tasks` |
| **Bridge** | yes | `treasuryClient` · `e2e/` · `scripts/*_preview.ts` |

### Running the core layer — clone and go

```bash
npm install
npx tsc --noEmit -p tsconfig.core.json
npx vitest run tests/feeEngine.test.ts tests/bridge.test.ts tests/custodyAddress.test.ts
```

That is also exactly what the CI gate runs (`.github/workflows/ci.yml`, job `core`). The gate
spells out what it does **not** cover, rather than letting one green check imply coverage it
never had.

### Running both layers — needs the LAMP repository on disk

```bash
bash scripts/pin-lamp.sh    # materialises vendor/lamp, pinned to commit ebafc2e1
npm test                    # 57 tests
npm run typecheck
npm run e2e:emulator        # prints the evidence: 1 Collect tx, 8 invariants, a real txHash
```

`scripts/pin-lamp.sh` **pins** LAMP to exactly one commit rather than following HEAD. The reason
is at the top of that file and is worth reading before touching anything: commit `ebafc2e1` is the
last commit that still matches `vendor/treasury-custody.plutus.json`, i.e. matches the custody
instance already deployed on Preview. That address holds real assets. Rebuilding the blueprint
against a newer LAMP changes the script hash, which changes the address, which means losing the
ability to spend what is sitting there.

`vendor/lamp/` is in `.gitignore`: this repository pins another repository's commit, it does not
copy that repository's code into itself.

## Documentation

`OriLife-Specs/Fee/`: `FeeMechanism-CONTRACT.md` (the backbone) · `-FEAT.md` · `-MATH.md` ·
`-TECH.md` · `-EXEC.md`. Build report and review notes: `AUDIT.md`.

## Architecture (short version)

```
quoteFee (feeEngine) ──FeeQuote──▶ quoteToCollectItems (bridge) ──CollectItem[]──▶
  buildFeeCollectTx (treasuryClient) ──▶ buildCollectTx (@magiclamp/treasury-sdk) ──▶
  custody.ak Collect validator ──▶ custody UTxO: value += feeOil, 3-bucket ledger += oil
```

`src/params|buckets|tasks|feeEngine|bridge` is pure off-chain code (its tests do not need the
LAMP repository). Only `treasuryClient` and `e2e/` touch the Treasury SDK.
