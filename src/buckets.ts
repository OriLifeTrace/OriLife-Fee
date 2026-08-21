// OriLife — treasury BUCKET classification (the category id inside the CustodyDatum ledger).
//
// "The treasuries" here means the accounting BUCKETS inside ONE OriLife custody instance
// (a multi-asset × bucket ledger — see LAMP/Treasury types.ak). A single Collect transaction
// deposits LAMP into several buckets via several CollectItems with different `category`.
// Buckets split by WHERE THE MONEY IS GOING, not by who paid:
//
//   PROTOCOL       — the MagicLamp protocol cut (orchestrator operations, DAO treasury).
//   LAMPNET_REWARD — the share owed to LampNet hardware contributors (storage/compute/bandwidth).
//                    Held here as an accounting entry only; nodes redeem later through
//                    Release + vesting (LampNet Reward-Feat §3 Capped Drop). It is NOT paid out
//                    inside the fee transaction.
//   ANCHOR         — the fund covering Cardano on-chain anchoring costs (min-UTxO + MMR batch fee).
//
// Invariant: the three buckets sum to exactly what the user paid (Σ bucket = fee_total_oil).
// LAMP is fixed-supply, so money entering the treasury is a state change from circulating to
// accounting — never a burn (Σout = Σin per asset, enforced by custody.ak C-COL-4).

/** Bucket id (category) — matches the CustodyDatum ledger. An integer; the DAO may add more. */
export const BUCKET = {
  PROTOCOL: 0n,
  LAMPNET_REWARD: 1n,
  ANCHOR: 2n,
} as const;

export type BucketName = keyof typeof BUCKET;

/** Human-readable label per bucket (for logs and explanations; never goes on-chain). */
export const BUCKET_LABEL: Record<BucketName, string> = {
  PROTOCOL: "MagicLamp protocol treasury (protocol cut)",
  LAMPNET_REWARD: "LampNet node reward pool (storage/compute/bandwidth)",
  ANCHOR: "Cardano on-chain anchoring fund",
};

/** Look up the category (bigint) from a bucket name. */
export function bucketCategory(name: BucketName): bigint {
  return BUCKET[name];
}
