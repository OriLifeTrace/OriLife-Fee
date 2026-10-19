# Who pays the network fee? Three fee sources

Every action on Cardano carries a small network fee, paid in ADA. Asking a new user to buy ADA before they can do anything is one of the biggest barriers to onboarding. The MagicLamp and PhoenixKey ecosystem therefore supports three ways to pay that fee: **by Owner**, **by Feecover**, and **by FeeSponsor**.

Status: Feecover and FeeSponsor run on the Cardano Preprod testnet; paying by Owner is in development. None is live on mainnet yet. Limits and amounts on testnet are provisional.

## When each source is used

- **Getting started and system actions** — creating a vault, linking a PhoenixKey identity, and background maintenance — are paid by Feecover by default. The user is not asked to choose and pays no network fee.
- **Using a service** — the user picks how to pay for each transaction. The app lists only the sources that accept that kind of action, so some actions offer fewer than three. On testnet, FeeSponsor is open only for spending MAGIC.

## The three sources

### By Owner — the user pays from their own wallet
- The user's PhoenixKey wallet pays the fee in ADA. No third party pays for or co-signs the transaction.
- Advantages: fully self-custodial; uses no shared budget; nobody has to approve it.
- Trade-off: the user needs some ADA in their wallet first, for the fee and, for some actions, a collateral amount that stays in the wallet and is only taken if the transaction fails validation.

### By Feecover — the ecosystem fee service pays
- Feecover, the ecosystem's fee service, pays the ADA fee. For getting-started and system actions the user pays no network fee.
- For service use, the design asks the user to reimburse the network fee in CARP rather than pay it in ADA. This concerns the network fee only. The service itself is priced in MAGIC: each use draws down MAGIC credit already in the user's vault, generated from LAMP they hold or prepaid in CARP through PrepaidGen. Whenever the user pays for a service, they pay in CARP. Testnet does not enforce the reimbursement yet: the CARP amount is shown, the gap is logged, and the transaction goes through anyway.
- Advantages: a new user can start with zero ADA.
- Target design: part of these getting-started fees is planned to move from the pilot wallet to a dedicated funding source. This is not in use yet; on testnet all of these fees are still paid from the pilot wallet.
- Today on testnet: fees are paid from a pilot wallet operated by the team for testing, and usage rules (daily limits, identity checks) are applied by the signing service, not by an on-chain contract. The signing service adds only the fee payer's signature; it cannot authorise the user's own action.

### By FeeSponsor — a sponsorship budget covers the fee
- A dedicated sponsorship budget pays the ADA fee. The user pays no network fee.
- Limits: each PhoenixKey identity has a small daily allowance, and the transaction must be authorised by that identity. On testnet these checks are made by the signing service.
- Advantages: no network fee for the user, even when using services.
- Target design: a sponsorship budget funded through a dedicated channel rather than by the team. That funding is not in operation yet.
- Today on testnet: the budget is a small fixed daily amount from the same pilot wallet.

## At a glance

| | By Owner | By Feecover | By FeeSponsor |
|---|---|---|---|
| Who pays the ADA fee | The user's own wallet | Feecover | Sponsorship budget |
| What the user pays | The network fee in ADA | No network fee to get started; network fee reimbursed in CARP for service use, planned (not enforced on testnet) | No network fee |
| Needs ADA first | Yes | No | No |
| Limits | None beyond the user's balance | Daily limits | Daily allowance per identity |
| Testnet status | In development | Running (pilot wallet) | Running (small budget) |

## What is not claimed

- These sources are not live on mainnet.
- On testnet, limits for Feecover and FeeSponsor are applied by the signing service, not by an on-chain contract.
- Testnet amounts and limits are provisional and are not final prices.
