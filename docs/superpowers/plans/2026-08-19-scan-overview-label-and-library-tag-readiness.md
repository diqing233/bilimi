# Scan Overview Label And Library Tag Readiness Correction Plan

## Scope

Restore the existing scan-overview source table and change only the combined select-all heading to `全选`. Make selected library reorganization treat saved complete non-empty tags as an accepted historical tag result, so the adoption prompt and button are disabled when no new tag work exists.

## Tasks

- [x] Update `docs/项目功能项目书.md` and the requirement ledger with the confirmed source-table and tag-readiness behavior.
- [x] Add failing renderer coverage for the source table and the exact `全选` heading.
- [x] Add failing coordinator coverage for non-empty saved tags without a legacy `tagEvidence` field.
- [x] Restore only the removed renderer projection and source-row markup; preserve existing counts, toggles, row selection and callbacks.
- [x] Normalize reusable saved tags in selected reorganization without changing the tag payload or remote data, and initialize the accepted tag cutoff.
- [x] Run focused tests, full tests, build, diff checks, then commit on local `main`.
