# Three-minute demo script

For a screen share. Everything runs locally on the in-memory simulator: no
API keys, no Docker, no network beyond localhost. All member data is synthetic.

## Before the call

```bash
cd fairway-credit-gate
make test          # first run does npm ci; expect "Tests  78 passed (78)"
clear
```

Have three things open: a terminal at the repo root,
`contract/sacco-credit-gate.compact` in an editor scrolled to
`evaluateApplicant`, and the README's architecture diagram in a browser tab.
Make the terminal font large.

---

## 0:00 to 0:30 · The problem (diagram tab)

> "Savings cooperatives (SACCOs) in Ethiopia lend to their own members, and
> a member's savings history is the collateral. If you put that lending on a
> public ledger, you publish members' finances. This contract keeps the
> numbers on the member's phone and puts only the decision on chain."

Point at the three boxes left to right:

> "The SACCO signs the member's profile off chain. The member's device proves,
> in zero knowledge, that the signature is valid and the profile clears the
> lending rules. The ledger stores only status and amount."

## 0:30 to 1:00 · The rule, in the contract (editor)

Show `evaluateApplicant`.

> "The witness hands the circuit the private profile and the SACCO's
> signature. First, the SACCO's key has to be registered on chain. Then the
> Schnorr signature is verified inside the proof, over these three figures plus
> a hash of the member's key. Only then do the rules run: a six-month
> membership gate, then three fixed tiers in birr."

Point at the `disclose(` calls in `requestLoan`:

> "The compiler won't let witness data reach the ledger without an explicit
> `disclose`. The only things disclosed are the member's hashed key, the status
> and the amount."

## 1:00 to 2:15 · Run it (terminal)

```bash
make demo
```

It takes under a second. Scroll back to the top and talk through it.

- **Steps 1 and 2:** "The SACCO's signing service starts on localhost. The
  admin deploys and registers the SACCO's public key. On chain is a hash of
  the admin's secret, not the secret."
- **Step 3, member-A:** "Repayment 720, savings 2,500 a month, 30 months. Those
  stay on the device. The SACCO signs them, bound to this member's key. The
  member asks for 8,000 and the ledger records Approved, 8,000."
- **member-B:** "Asks for 9,000 but qualifies for Tier 2. The ledger records
  Proposed at 7,000, the member accepts, and it becomes Approved."
- **member-C:** "Excellent numbers, but joined four months ago. Rejected. From
  outside, that looks the same as a weak repayment record. Tenure isn't
  revealed."
- **Step 4:** "Four attacks. Edit the profile after signing: the signature
  fails. Replay someone else's attestation: fails, because the signature is
  bound to their key. Sign with your own key: that provider isn't registered.
  Register your own signer: admin only. None of these can produce a proof, so
  nothing gets submitted."
- **Step 5:** "The whole public ledger. Each loan record has two fields, amount
  and status, and none of the nine private figures appear anywhere."

## 2:15 to 2:45 · Why fixed tiers (back to the editor or just talk)

> "Why not lend three times monthly savings? Because the limit is public and so
> is the formula. A limit of 4,500 means savings of 1,500. Fixed tiers turn an
> exact number into a band. Bands still leak something, and repeated loans show
> a trajectory. That's on the honest-scope list in the README."

## 2:45 to 3:00 · Scope and close

> "It's adapted from Midnight's zk-loan example. I kept the zero-knowledge
> machinery, including a soundness fix in the Schnorr check that has its own
> regression test, and changed the domain model, added the membership gate, a
> standalone build and CI on compiler 0.31.1. 78 tests run in memory with every
> assert. Real proofs on a local devnet are a separate lane I haven't run for
> this release. And the demo signer trusts its input: in production the SACCO
> signs from its own books."

---

## If they ask

| Question | Short answer | Where to show it |
|---|---|---|
| "Is the simulator a real proof?" | No. It runs the compiled circuit logic with every assert and ledger write, and skips proving. If an assert fails here, a prover couldn't produce a proof either. | `test/sacco-credit-gate.simulator.ts` |
| "What stops a fake SACCO?" | `providers` map, admin-only. | `registerProvider` in the contract |
| "What was the soundness fix?" | The Schnorr quotient was an unconstrained field element, which let a prover pick their own challenge. Now `Uint<7>` with `q < 116`. | `schnorr.compact`; test "rejects a forged attestation…" |
| "Can the SACCO track members on chain?" | It signs for a hash of the member's key, and a new PIN gives a new key. The SACCO does know who it signed for, by design. | `deriveUserPublicKey`, `changePin` |
| "What's next?" | Thresholds set by a credit committee on chain, several SACCOs with their own policies, a member UI. | README, Honest scope |

## If something breaks

- `make demo` fails on install: run `npm ci` and look at the error. Node must
  be 22 or newer.
- Port conflict: there can't be one. The signer binds to a random free port.
- Fallback: the README has the real demo output in a collapsible block.
