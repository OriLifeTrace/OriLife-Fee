# STATUS — measured 2026-10-02

Measured on the tree of the last commit that touched `src/`
(`git log -1 --format=%h -- src/`). Every count below carries the command that takes
it again: a bare number in this file has no way to learn that its subject moved, and this file has
carried both stale and never-true counts before (see "History").

## What the repository holds

| Part | Where | State |
|---|---|---|
| MAGIC pricing, OriLife side | `src/`, `tests/` | parse `op_declaration`, quote against a PriceParam beacon datum, plan ConsumeMAGIC — pure code |
| Fee vault + fee inbox + donation escrow | `onchain/` | deployed on Preprod (the instance at the root of `onchain/scripts/deployed_preprod.json`) and idle since epoch 317: Koios on 2026-11-05 (epoch 323) shows the inbox at 0 balance after 2 transactions, the vault holding 5,000,000 lovelace after 2, the escrow with none. No service builds a fee output to the inbox; only the manual scripts `01`–`07` drive it. The deployed instance predates the foreign-token guard (item 8), so it does not run the `fee_vault` in `plutus.json`. Auction parameters are test values; nothing on Mainnet |
| LAMP prototype | removed; record in `docs/lamp-prototype.md` | Preview custody address still holds assets |

## Checks — 2026-10-02

```
npx tsc --noEmit -p tsconfig.core.json   → exit 0
npx tsc --noEmit                          → exit 0
npx vitest run                            → 60 / 60 pass, 3 files
```

`tsconfig.core.json` now extends `tsconfig.json` and covers the same files: the split existed only
because the LAMP bridge layer needed another repository on disk. CI runs the first and third
commands (`.github/workflows/ci.yml`, job `core`), so the gate and a local run see the same tests.

Mutations run against the suite on 2026-10-02, each with its own marker in the mutated line and
the whole suite run again; every one turned it red:
- flooring per unit instead of once per line (`requiredNanogic`, 3 red), and reporting an absent
  declaration as `no_charge` (`planConsume`, 4 red);
- `anomaly` no longer winning over `policy_partial`; `reason` no longer required on `pending` or on
  `missing`; an absent `pending` read as empty; an absent `not_applicable` thrown on (each 1 red);
- a replay planned with no lines (2 red); a zero price allowed; a negative operand allowed;
  `priceEpochAt` rounding up (each 1 red);
- the multi-line hold removed (3 red); a multi-line replay escaping the hold; a replay checked
  before `ops: []`; code 3 accepted in `ops`; the whole `/api/identify/auto` body read as "not
  declared"; `not_applicable` left out of the duplicate check; an empty `reason` on
  `not_applicable` accepted; an empty `unit` accepted; `op_type` above 2^53 − 1 accepted (each 1
  red).

## What the tests do not pin

- **The formula is a copy.** `requiredNanogic` mirrors MAGIC's `requiredFromBeacon` and on-chain
  `required_for` at MAGIC `origin/main` `4f5b86db`. The parity vector in `tests/magicPrice.test.ts`
  is copied from MAGIC's own test, so it pins this copy to MAGIC's value **as of that commit**. If
  MAGIC changes its formula, nothing here turns red.
- **The declaration shape is a copy.** `parseOpDeclaration` follows OriLife-Core
  `MOBILE-API-CONTRACT.md` §14.6-bis at Core `origin/main` `dca31f3`. A shape change in Core shows
  up as a thrown error at runtime, not as a red test here.
- **Beacon validity is only partly re-checked.** `requiredNanogic` rejects a missing or duplicated
  row, a negative operand and a zero result, but not the other `valid_param` rules (band, ceiling,
  ordering); a beacon that breaks them is rejected by the chain, not here.
- **A task with more than one `ops` line is held, not charged.** One task is one ConsumeMAGIC
  transaction, and the redeemer that carries several pairs does not exist yet. When it does, the
  hold is replaced by a plan for that transaction, priced the way MAGIC floors several pairs.
- **Whether a replay was already consumed for is not decided here.** `replay` keeps its lines and
  amounts; the decision needs the app's own record keyed by `client_event_id`, which this package
  does not hold.

## Onchain (`onchain/`) — carried over from the 2026-09-21 measurement

1. `onchain/orilife_treasury/validators/fee_vault.ak` and `donation_escrow.ak`, merged in `2b35232`
   on 2026-08-21, driven by `onchain/scripts/01_mint_test_ring.mjs` through `06_close_vault.mjs`.
2. `onchain/scripts/deployed_preprod.json` records a lifecycle executed end to end on Preprod —
   mint, open, collect, skim, donate, close — each step with its transaction hash. Its `previous`
   block records an earlier validator revision with no `Close` branch, where every branch forced
   `lovelace_of(out) >= lovelace_of(in)`: 5,000,000 lovelace at `addr_test1wrxmzy4…` cannot be
   withdrawn by any redeemer. The 900,000 tCARP (on-chain asset name of that test token) at the same address are not stranded — `Operate`
   still spends those. The current revision has `Close`.
3. `onchain/scripts/*.mjs` import `@lucid-evolution/lucid` from this repository's root
   `package.json`; that is the only reason the dependency is still there.
4. **The source in this repository no longer matches the Preprod addresses above.** Outputs that
   continue the vault or the escrow are pinned to the FULL `Address`, not to the payment credential
   alone, and a reference script on the vault is refused (`fee_vault.ak` header, item 5;
   `donation_escrow.ak` header, second hole). Both script hashes change. The deployed ones are
   `fee_vault` `457a22dc…79cabcb6` and `donation_escrow` `7ad64886…9df2f0be`; the current ones are
   the `hash` fields in `onchain/orilife_treasury/plutus.json`, rebuilt by `aiken build`. The
   recorded addresses stay as written: they are what is on Preprod, and the patched revision has
   never been deployed, so it has no address to record. Read `deployed_preprod.json` as a log of
   what ran, not as a pointer to what the code now builds.

## Onchain — ledger NFT, fee inbox, descending auction (2026-10-02)

5. `fee_vault` now identifies its ledger by a one-shot NFT (`seed` parameter, minted by `Open`,
   burnt by `Close`); any other UTxO at the vault address can only be swept into the ledger by
   `Collect`. New validator `fee_inbox` receives the platform fee as a plain output with no datum
   and lets anyone sweep it into the ledger (withdraw-zero, one batch check). `donation_escrow`
   prices `Donate` by a linear descending auction from `start_lovelace_per_ring` to
   `min_lovelace_per_ring` over `decay_ms`, opened at `listed_at`, which `Skim` pins to the upper
   validity bound. All three hashes change again; this revision has never been deployed.
   Hardening in the same revision: `Donate` runs with exactly one redeemer (the whole-transaction
   `treasury_donation` cannot be shared by two escrow instances), releases at least
   `min(held, lot_min)`, and leaves at most one remainder with RING > 0 and no less lovelace;
   `Collect` requires the ledger to gain at least the RING of every other script-locked input, which
   covers any number of inbox versions pointing at one vault.
6. Checks, from `onchain/orilife_treasury` then the repository root:
   ```
   aiken check                                  → read `summary.failed` when piped to JSON; the exit code stays 0
   node onchain/scripts/lifecycle_emulator.mjs  → runs 01 → 06 on the Lucid Emulator, phase-two on every redeemer, ends with "ĐẠT"
   ```
   A mutation of `requiredDonation` to one lovelace below the on-chain price made `05` fail with
   `failed script execution`; restored, it passes.
7. Not pinned by the checks above: the ledger rules of Preprod itself (value balance, the
   `treasury_donation` field, script stake credential registration) — the Emulator does not
   enforce them; and the auction parameters are test values for the Preprod instance only.

## Onchain — foreign tokens in the ledger UTxO (2026-11-05)

8. `shape_ok` in `fee_vault.ak` now requires the continuing ledger UTxO to carry exactly the
   non-ADA, non-RING value of the ledger input, the ledger NFT included (`fee_vault.ak` header,
   item 10). Before, it pinned only the address, the NFT and lovelace not decreasing, and
   `Collect` and `Skim` need no signature, so anyone could strip any token other than RING from
   the ledger UTxO. The `fee_vault` hash changes; this revision has not been deployed. The
   scripts derive the vault address from `plutus.json`, so driving the deployed instance
   (collect, skim, close, rotate) means running them from `4cc29e7`. Checks:
   `aiken check` 323 / 323; replacing the new condition with `True` turns exactly the seven
   strip/add tests red (7 / 323); `lifecycle_emulator.mjs` ends with "ĐẠT"; costs re-measured in
   `onchain/README.md`, section "Chi phí thực thi đo trên Emulator".
9. `Open` now requires the new ledger UTxO to hold nothing but lovelace and exactly one ledger
   NFT (`without_lovelace(opened.value) == from_asset(policy_id, vault_nft_name, 1)`). Item 8
   only keeps the non-ADA, non-RING value equal from input to output, so a token put in at
   opening would stay in the ledger UTxO for the life of the vault. Checks: replacing this
   condition with `True` turns exactly `open_rejects_a_foreign_token_in_the_opening_output` red
   (1 / 323); the Open row of the cost table was re-measured on 2026-11-06.

## History

- **Until 2026-10-02** the repository priced tasks in LAMP: `src/feeEngine.ts` and friends, a
  bridge into a LAMP Treasury custody contract on Preview, pinned to LAMP commit `ebafc2e1` by
  `scripts/pin-lamp.sh`. All of it is at commit `fef2ee2`; `docs/lamp-prototype.md` records the
  custody address and its assets.
- **2026-09-21** (`a21c7a9`): this file was rewritten to attach a command to every count after two
  failures — counts that went stale when tests were added (`54 / 54`, `57 / 57`), and a file count
  that had never been true (16 stated, 17 at every commit). Both are why the counts above carry
  their commands.
- **2026-09-14**: this file said the RING validator lived on an unmerged branch; it had been merged
  two commits later and the branch was deleted by 2026-09-21. For the current state, read the tree
  (`git ls-tree -r HEAD onchain/`), not a paragraph naming a branch.
