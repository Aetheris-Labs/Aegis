# Audit Sealing Notes

This repo already captures strategy signals, hashes, and attestation state. The missing piece was a short note on what must be sealed together when an execution bundle is archived.

## Seal together

- The finalized decision payload that left the planner.
- The quote snapshot or venue response that justified the decision.
- The enclave attestation material tied to the signer session.
- The transaction signature or the explicit failure reason when no signature exists.

## Keep out of the bundle

- Transient debug logs that only help local development.
- Repeated quote retries after a final decision was already made.
- Derived dashboard rows that can be rebuilt from the canonical records.

## Review rule

If an operator cannot answer "what was decided, why, and under which attested context" from a single sealed bundle, the archive is incomplete.
