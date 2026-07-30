// OriLife — lớp gọi LAMP Treasury SDK THẬT để dựng giao dịch Collect từ FeeQuote.
// Import builder + datum codec của @magiclamp/treasury-sdk qua đường dẫn nguồn (file local).
//
// Tách khỏi bridge.ts (thuần, test không cần repo LAMP): chỉ file này + e2e chạm Treasury.

import { Data, type LucidEvolution, type UTxO, type Validator, type Network } from "@lucid-evolution/lucid";
import {
  buildCollectTx, type CollectResult,
} from "../../../LAMP/Treasury/offchain/src/collectBuilder.js";
import { decodeCustodyDatum } from "../../../LAMP/Treasury/offchain/src/datum.js";
import type { CollectItem as TreasuryCollectItem } from "../../../LAMP/Treasury/offchain/src/types.js";

import type { FeeQuote } from "./feeEngine.js";
import {
  quoteToCollectItems, assertBridgeInvariants, type BridgeConfig, type CollectItem,
} from "./bridge.js";

// B1: kiểm LÚC BIÊN DỊCH rằng CollectItem (mirror cục bộ ở bridge.ts) KHỚP TUYỆT ĐỐI
// CollectItem THẬT của Treasury SDK. Nếu Treasury đổi field/kiểu → tsc lỗi ngay (không
// để phép ép `as` che lệch câm rồi mới vỡ on-chain).
type _ItemCompat = [CollectItem] extends [TreasuryCollectItem]
  ? ([TreasuryCollectItem] extends [CollectItem] ? true : never)
  : never;
const _itemCompat: _ItemCompat = true;
void _itemCompat;

export interface BuildFeeCollectParams {
  lucid: LucidEvolution;
  network: Network;
  /** Custody UTxO của instance OriLife (inline CustodyDatum, cut_bps=10000). */
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
 * FeeQuote → giao dịch Collect (chưa sign). Đọc cut_bps từ custody datum để KIỂM bất biến
 * cầu nối trước khi dựng (fail-fast). amount mỗi item = oil bucket; cut_bps=10000 ⇒ toàn bộ
 * vào treasury, chia về các bucket theo category.
 */
export async function buildFeeCollectTx(p: BuildFeeCollectParams): Promise<BuildFeeCollectResult> {
  if (!p.custodyUtxo.datum) throw new Error("ORILIFE-TC-000: custody UTxO thiếu inline datum.");
  const datum = decodeCustodyDatum(Data.from(p.custodyUtxo.datum));

  // B3: asset cấu hình phải ∈ accepted_assets của instance (lỗi rõ thay vì COLLECT-001 mơ hồ).
  const lampKey = `${p.cfg.lampPolicyHex.toLowerCase()}|${p.cfg.lampNameHex.toLowerCase()}`;
  const accepted = datum.accepted_assets.some(
    (a) => `${a.policy.toLowerCase()}|${a.name.toLowerCase()}` === lampKey,
  );
  if (!accepted) {
    throw new Error(
      `BRIDGE-004: LAMP (${p.cfg.lampPolicyHex}.${p.cfg.lampNameHex}) ∉ accepted_assets của instance `
        + `— sai cấu hình policy/name hoặc sai custody instance.`,
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
