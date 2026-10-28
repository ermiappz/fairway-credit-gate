# Finnish Credit Register Proof on Solana

Minimum proof-of-concept for writing a local Solana attestation from a Finnish
Positive Credit Register claim. The fast demo path uses a local browser
extension capture; the TLSNotary plugin direction remains in `tlsn-plugin/`.

## Current Claim

The old Asiakastieto claim was `payment_defaults == 0`. That is not the right
claim for Vero’s Positive Credit Register: the register does **not** contain
payment-default records. It can show loan information, delayed amounts reported
when a loan instalment is more than 60 days late, accelerated loans, voluntary
credit bans, and income data.

This repo now attests this Vero-compatible claim:

```text
risk_flags == 0
```

`risk_flags` is the sum of:

- delayed amount entries in the revealed `loans[]`
- loans with `isForeclosed: true`
- active `voluntaryBanOnCredits.isInEffect`
- deceased-person extract responses

The Solana account layout still stores this as the existing `u32` slot for
compatibility, but UI/server code presents it as `risk_flags`.

## Architecture

```text
Vero Positive Credit Register e-service
        |
        | local extension captures /loans JSON
        v
Verifier Server
        | validates host, notary, freshness, Vero schema, risk_flags == 0
        v
Solana Program
        | creates CreditAttestation PDA for wallet
        v
Frontend + Phantom
```

## Demo Modes

| Mode | Data source | Proof path | On-chain write |
| --- | --- | --- | --- |
| `DEV` | Vero-shaped no-risk fixture | local fixture | yes, local Solana |
| `PROD` | Vero e-service `/loans` response | local Chrome extension capture | yes, local Solana |

`DEV` is the reliable sub-1-hour demo path: it proves the Solana program,
wallet connection, verifier transaction, and PDA readback. `PROD` is wired to
validate real Vero-shaped proof data from the e-service. Production lender API
use still requires a lender/data-user certificate and lawful basis for
`GetCreditRegisterExtract`.

## Vero Integration Facts

- Production API endpoint: `https://api.positiivinenluottotietorekisteri.fi/GetCreditRegisterExtract`
- Production API access requires a Tax Administration certificate for requesting
  data and an approved data permission.
- Private individuals can view their own loan data in the e-service after
  Suomi.fi strong identification.
- A robust no-risk proof must reveal either:
  - `creditInformationSummary.loanContractsCount == 0` and `loans: []`, or
  - the complete `loans[]` array, so the verifier can count delayed amounts and
    accelerated loans.

If the user has loans, do not reveal only a summary. Absence of
`delayedAmounts` cannot be proven from a concealed array.

## Prerequisites

- Node.js 18+
- Rust + Solana CLI + `cargo-build-sbf`
- Phantom wallet
- Local Solana validator
- For `PROD`: Chromium browser and access to Vero e-service data

## One-Time Setup

```bash
npm install
npm --prefix frontend install
npm --prefix verifier-server install
npm --prefix tlsn-plugin install

cp verifier-server/.env.example verifier-server/.env
```

## Run the Local Demo

Terminal 1:

```bash
solana-test-validator --reset --quiet
```

Terminal 2:

```bash
cd solana-program
cargo build-sbf
solana --url http://127.0.0.1:8899 airdrop 5 FUuk4fUyyPrgBJkawRJesgktnzvwqKvxoDdNrPtjdW1R
solana --url http://127.0.0.1:8899 program deploy \
  target/deploy/fi_credit_attestation.so \
  --program-id target/deploy/fi_credit_attestation-keypair.json
```

Terminal 3:

```bash
cd verifier-server
npm run dev
```

Terminal 4:

```bash
cd frontend
npm run dev
```

Open `http://localhost:5173`, connect Phantom, keep `DEV` selected, and click
`Prove Credit to Solana`. The verifier accepts the Vero-shaped fixture and
writes a real localnet PDA.

## PROD Proof Flow

For the next demo, use the local browser-capture extension. It matches the
screen you captured: Vero's e-service calls
`https://asiointi.positiivinenluottotietorekisteri.fi/loans`, which returns a
summary with zero debt, empty delayed repayments, empty foreclosures, and empty
loan arrays.

1. Load the local extension:

   - Open `chrome://extensions`
   - Enable Developer mode
   - Click **Load unpacked**
   - Select `vero-proof-extension/`

2. In the dApp, connect Phantom and choose `PROD`.

3. Click **Start Vero Proof Session**. The app stores your wallet in the local
   verifier and opens the official Vero sign-in page.

4. Sign in with Suomi.fi and open **Loan information**.

5. The extension overlay should change to `Vero /loans response captured`.

6. Click **Create debt-free proof** in the overlay. It posts the captured Vero
   response to the verifier, which writes the Solana PDA. When the overlay says
   published, close the tab and return to the dApp.

The browser-capture verifier checks:

- response URL host is `asiointi.positiivinenluottotietorekisteri.fi`
- response path includes `/loans`
- `summary.debtTotal`, lump-sum debt, running-account debt, and leasing totals
  sum to zero
- `lumpSumLoans`, `runningAccountLoans`, `leasingLoans`, and
  `guaranteeReceivables` are empty
- delayed repayments and foreclosed loan arrays are empty
- `isPersonInDebtArrangementOrBusinessRestructuringProgram` is not true

## Important Limitations

- The local extension is a browser-capture proof path for a fast team demo. It
  is not yet a cryptographic TLSNotary proof.
- The `tlsn-plugin/` code keeps the TLSNotary direction, but the verifier still
  needs the real `tlsn-verifier` WASM/crate integration for full cryptographic
  verification of TLSNotary commitments.
- Wallet binding is not production-grade unless the TLS transcript reveals a
  wallet/challenge value, for example a custom request header ignored by Vero
  but included in the signed TLS transcript.
- The Vero lender API is not a public personal API. Production use requires
  legal data permission and Tax Administration certificates.
- This is localnet-only. No remote deployment or audit has been done.
