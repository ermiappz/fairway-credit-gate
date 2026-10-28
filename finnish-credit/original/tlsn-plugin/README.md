# TLSNotary Plugin - Finnish Positive Credit Register

This plugin is a proof helper for Vero’s Positive Credit Register flow. It opens
the Vero sign-in page, waits for a matching e-service/API request, and generates
a TLSNotary proof that reveals only the fields needed by the verifier.

Fast-demo target:

- `statusMessage: "Success"`
- `creditInformationSummary`
- `loans: []`
- `voluntaryBanOnCredits` if present

If the user has loans, the proof must reveal the complete `loans[]` array so the
verifier can prove there are no `delayedAmounts` entries and no
`isForeclosed: true` loans.

## Build

```bash
npm install
npm run build
```

Load `dist/index.wasm` in the TLSNotary Chrome extension.

## Notes

- Production lender API proofs target
  `api.positiivinenluottotietorekisteri.fi/GetCreditRegisterExtract`.
- Private-individual e-service proofs target
  `asiointi.positiivinenluottotietorekisteri.fi` after Suomi.fi login.
- The exact browser API path may need confirmation from the TLSN Requests tab
  during a real Vero login.
