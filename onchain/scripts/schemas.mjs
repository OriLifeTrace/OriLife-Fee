// Khuôn datum, tách riêng khỏi kịch bản. Để chung với kịch bản thì `import` kéo theo
// cả phần thân chạy của kịch bản đó — đã vấp một lần.

import { Data } from "@lucid-evolution/lucid";

export const VaultDatum = Data.Object({
  collected: Data.Integer(),
  skimmed: Data.Integer(),
});

export const EscrowDatum = Data.Object({ carp: Data.Integer() });

/// Redeemer của kho phí: Collect{amount} · Skim{amount} · Operate
export const VaultRedeemer = Data.Enum([
  Data.Object({ Collect: Data.Object({ amount: Data.Integer() }) }),
  Data.Object({ Skim: Data.Object({ amount: Data.Integer() }) }),
  Data.Literal("Operate"),
]);

export const EscrowRedeemer = Data.Enum([Data.Literal("Donate")]);
