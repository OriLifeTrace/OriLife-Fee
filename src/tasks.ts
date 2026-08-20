// OriLife — the catalogue of billable user TASKS plus the economic profile of each one.
//
// Task sources: the orilife-core API (tree/fruit/evidence/farm) and field-reid (animal).
// Every task carries a DAO-governed pricing profile. valueBps > 0 marks a task on a valuable
// asset (an extra component scaled by the declared value, with a FLOOR so under-declaring does
// not pay). onChain marks a task that triggers anchoring.

import type { AnchorTier } from "./params.js";

export interface TaskSpec {
  /** Task key — a stable identifier (used for the secondary app_id and for logs). */
  key: string;
  /** Short human-readable description. */
  label: string;
  /** Base fee for the task, in USD. */
  baseFeeUsd: number;
  /** The equivalent traditional cost in USD — drives the CAP and the "cheaper by" figure. */
  traditionalCostUsd: number;
  /** Basis points added on the declared asset value (0 = not value-based). */
  valueBps: number;
  /** Value FLOOR in USD, so under-declaring does not pay; 0 when not value-based. */
  floorValueUsd: number;
  /** Anchoring tier used when the caller does not specify one. */
  defaultAnchorTier: AnchorTier;
  /** True if the task anchors on-chain directly; false if it is off-chain plus batching. */
  onChain: boolean;
}

/** The task catalogue (simulated PLACEHOLDER values — the DAO tunes them via daoSetTask). */
const CATALOG: Record<string, TaskSpec> = {
  "tree.register": {
    key: "tree.register", label: "Register a tree",
    baseFeeUsd: 0.02, traditionalCostUsd: 1.5, valueBps: 2, floorValueUsd: 50,
    defaultAnchorTier: "batch_daily", onChain: true,
  },
  "tree.scan": {
    key: "tree.scan", label: "Tree identity scan (verify)",
    baseFeeUsd: 0.004, traditionalCostUsd: 0.3, valueBps: 0, floorValueUsd: 0,
    defaultAnchorTier: "no_anchor", onChain: false,
  },
  "tree.anchor": {
    key: "tree.anchor", label: "Anchor a tree on Cardano (CIP-68 NFT)",
    baseFeeUsd: 0.05, traditionalCostUsd: 2.0, valueBps: 3, floorValueUsd: 100,
    defaultAnchorTier: "immediate", onChain: true,
  },
  "fruit.register": {
    key: "fruit.register", label: "Register fruit",
    baseFeeUsd: 0.01, traditionalCostUsd: 0.5, valueBps: 1, floorValueUsd: 5,
    defaultAnchorTier: "batch_daily", onChain: true,
  },
  "fruit.lifecycle": {
    key: "fruit.lifecycle", label: "Record a fruit lifecycle event",
    baseFeeUsd: 0.006, traditionalCostUsd: 0.4, valueBps: 0, floorValueUsd: 0,
    defaultAnchorTier: "batch_daily", onChain: true,
  },
  "fruit.qr": {
    key: "fruit.qr", label: "Generate a fruit traceability QR code",
    baseFeeUsd: 0.002, traditionalCostUsd: 0.2, valueBps: 0, floorValueUsd: 0,
    defaultAnchorTier: "no_anchor", onChain: false,
  },
  "animal.enroll": {
    key: "animal.enroll", label: "Enrol an animal",
    baseFeeUsd: 0.05, traditionalCostUsd: 3.0, valueBps: 1, floorValueUsd: 400,
    defaultAnchorTier: "batch_daily", onChain: true,
  },
  "animal.identify": {
    key: "animal.identify", label: "Animal identity scan",
    baseFeeUsd: 0.008, traditionalCostUsd: 0.5, valueBps: 0, floorValueUsd: 0,
    defaultAnchorTier: "no_anchor", onChain: false,
  },
  "evidence.ingest": {
    key: "evidence.ingest", label: "Ingest an evidence photo",
    baseFeeUsd: 0.01, traditionalCostUsd: 0.6, valueBps: 0, floorValueUsd: 0,
    defaultAnchorTier: "batch_daily", onChain: false,
  },
};

/** The task keys currently in the catalogue. */
export function taskKeys(): string[] {
  return Object.keys(CATALOG);
}

/** Fetch a task profile; throws when it is absent (catches mistyped keys). */
export function getTask(key: string): TaskSpec {
  const t = CATALOG[key];
  if (!t) {
    throw new Error(`TASK-001: task '${key}' is not in the catalogue. Available: ${taskKeys().join(", ")}`);
  }
  return t;
}

/** The highest valueBps the DAO may set (stops value-based fees being inflated). */
export const MAX_VALUE_BPS = 1000; // at most 10% of the asset value

/** The DAO updates or adds a task profile (a seasonal vote). Bounds-checked against typos and
 *  malicious values (M-1). */
export function daoSetTask(key: string, patch: Partial<Omit<TaskSpec, "key">>): void {
  const cur = CATALOG[key] ?? {
    key, label: key, baseFeeUsd: 0, traditionalCostUsd: 0,
    valueBps: 0, floorValueUsd: 0, defaultAnchorTier: "batch_daily" as AnchorTier, onChain: false,
  };
  const next: TaskSpec = { ...cur, ...patch, key };

  // Bounds: every number finite and non-negative; valueBps within [0, MAX_VALUE_BPS].
  for (const [f, v] of [
    ["baseFeeUsd", next.baseFeeUsd], ["traditionalCostUsd", next.traditionalCostUsd],
    ["floorValueUsd", next.floorValueUsd], ["valueBps", next.valueBps],
  ] as const) {
    if (!Number.isFinite(v) || v < 0) {
      throw new Error(`TASK-002: ${key}.${f} must be finite and >= 0 (got ${v}).`);
    }
  }
  if (next.valueBps > MAX_VALUE_BPS) {
    throw new Error(`TASK-003: ${key}.valueBps=${next.valueBps} exceeds the cap of ${MAX_VALUE_BPS}.`);
  }
  CATALOG[key] = next;
}
