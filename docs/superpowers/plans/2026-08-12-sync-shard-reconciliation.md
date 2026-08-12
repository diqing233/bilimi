# Sync And Shard Reconciliation Implementation Plan

**Goal:** Keep one local bilimi logical ledger per name, support multiple Bilibili physical shards, make synchronization safer, and clear stale pause messaging after recovery.

**Architecture:** Treat the local ledger as the single source of classification and library identity. Remote folder IDs are candidates or physical shard bindings attached to that ledger; remote-only discovery groups same-name folders instead of creating one draft per folder. Existing repository physical-shard records remain the authority for post-sync bindings.

**Verification:** Add focused renderer/service tests, run affected Vitest suites, build, inspect `git diff --check`, then commit only the implementation and tests.

---

### Scope

- Use one local draft for same-name remote bilimi folders and retain all candidate IDs for confirmation.
- Preserve one library logical folder while exposing its multiple remote shard bindings and deletion scope.
- Remove sync acceleration and use 1.2–2 seconds between writes in both sync paths.
- Clear stale 412 details when a resumed operation succeeds.
