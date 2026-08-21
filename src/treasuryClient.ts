// OriLife — the layer that calls the REAL LAMP Treasury SDK to build a Collect transaction from
// a FeeQuote. It imports the builder and datum codec of @magiclamp/treasury-sdk by source path.
//
// Kept separate from bridge.ts (which is pure and testable without the LAMP repository): only
// this file and e2e/ touch the Treasury SDK.

import { Data, type LucidEvolution, type UTxO, type Validator, type Network } from "@lucid-evolution/lucid";
import {
  buildCollectTx, type CollectResult,
} from "../vendor/lamp/Treasury/offchain/src/collectBuilder.js";
import { decodeCustodyDatum } from "../vendor/lamp/Treasury/offchain/src/datum.js";
import type { CollectItem as TreasuryCollectItem } from "../vendor/lamp/Treasury/offchain/src/types.js";

import type { FeeQuote } from "./feeEngine.js";
import {
  quoteToCollectItems, assertBridgeInvariants, type BridgeConfig, type CollectItem,
} from "./bridge.js";

// B1: a COMPILE-TIME check that CollectItem (the local mirror in bridge.ts) matches the REAL
// Treasury SDK CollectItem exactly. If Treasury changes a field or a type, tsc fails here — rather
// than an `as` cast hiding the drift until it breaks on-chain.
type _ItemCompat = [CollectItem] extends [TreasuryCollectItem]
  ? ([TreasuryCollectItem] extends [CollectItem] ? true : never)
  : never;
const _itemCompat: _ItemCompat = true;
void _itemCompat;

export interface BuildFeeCollectParams {
  lucid: LucidEvolution;
  network: Network;
  /** The custody UTxO of the OriLife instance (inline CustodyDatum, cut_bps = 10000). */
  custodyUtxo: UTxO;
  custodyScript: Validator;
  quote: FeeQuote;
  cfg: BridgeConfig;
  newEpoch?: bigint;
}

export interface BuildFeeCollectResult extends CollectResult {
  items: CollectItem[];
}

/**
 * FeeQuote -> an unsigned Collect transaction. Reads cut_bps from the custody datum and CHECKS
 * the bridge invariants before building anything (fail fast). Each item's amount is the bucket's
 * oil; with cut_bps = 10000 the whole fee enters the treasury, split across buckets by category.
 */
export async function buildFeeCollectTx(p: BuildFeeCollectParams): Promise<BuildFeeCollectResult> {
  if (!p.custodyUtxo.datum) {
    throw new Error("ORILIFE-TC-000: the custody UTxO has no inline datum.");
  }
  const datum = decodeCustodyDatum(Data.from(p.custodyUtxo.datum));

  // B3: the configured asset must be in the instance's accepted_assets — a specific error here
  // beats a vague COLLECT-001 later.
  const lampKey = `${p.cfg.lampPolicyHex.toLowerCase()}|${p.cfg.lampNameHex.toLowerCase()}`;
  const accepted = datum.accepted_assets.some(
    (a) => `${a.policy.toLowerCase()}|${a.name.toLowerCase()}` === lampKey,
  );
  if (!accepted) {
    throw new Error(
      `BRIDGE-004: LAMP (${p.cfg.lampPolicyHex}.${p.cfg.lampNameHex}) is not in the instance's `
        + `accepted_assets — either the policy/name config is wrong, or this is the wrong custody `
        + `instance.`,
    );
  }

  const items = quoteToCollectItems(p.quote, p.cfg);
  assertBridgeInvariants(p.quote, items, datum.cut_bps);

  const res = await buildCollectTx({
    lucid: p.lucid,
    network: p.network,
    custodyUtxo: p.custodyUtxo,
    custodyScript: p.custodyScript,
    items: items as TreasuryCollectItem[],
    ...(p.newEpoch !== undefined ? { newEpoch: p.newEpoch } : {}),
  });

  return { ...res, items };
}
