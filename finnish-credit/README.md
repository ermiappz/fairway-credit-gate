# Finnish credit status → Midnight (minimal demo)

Original source copied from the user's `Fairway/credit/fi-credit-proof` project. `original/` preserves the React frontend, browser capture extension, verifier, intended TLSNotary plugin, and Solana program for review. Keypairs, environment files, personal captures, dependencies and generated builds were excluded.

`midnight/eligibility.compact` ports the **risk_flags == 0** predicate to Compact. It records a supplied pseudonymous subject and eligibility boolean, keeping the raw risk count in a private witness. This is an educational circuit with **untrusted witness inputs**: no TLSNotary signature, issuer authority, identity binding, freshness, authorization or replay protection. It must not be used to make lending decisions.

The original fast path used a local Chrome capture and Solana verifier; real TLSNotary verification was still a TODO. The new hosted walkthrough uses fictional fixtures and browser simulation, with a link to the official Vero e-service. No real financial data is collected, proof generated, or blockchain transaction broadcast. There is no confirmed Midnight transaction to link to an explorer.

Compile and run the local circuit checks from the Credit Gate root:

```sh
compact compile --skip-zk finnish-credit/midnight/eligibility.compact finnish-credit/midnight/managed
npx tsx finnish-credit/midnight/check.ts
```

The generated circuit artifacts are local build outputs. The original Solana project is preserved for provenance; the minimal Midnight replacement is intentionally separate and does not pretend to be a completed verifier migration.
