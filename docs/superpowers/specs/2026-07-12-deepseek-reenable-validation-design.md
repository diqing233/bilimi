# DeepSeek Re-enable Validation Design

## Goal

When the user turns off the `Enable DeepSeek` switch and later turns it back on, automatically validate the saved connection again if an API key is already stored.

## Behavior

- Turning DeepSeek off changes the global status to disabled and arms a new automatic validation.
- Turning DeepSeek back on with a stored key starts one real connection test and shows the existing validating status.
- A successful request changes the status to connected; a failed request changes it to connection failed.
- Turning DeepSeek back on without a stored key shows the existing configuration-needed status and does not send a request.
- Snapshot refreshes and ordinary preference changes must not repeat the automatic request.
- The existing startup validation and Save and Test action retain their current behavior.

## Architecture

Reuse the existing startup-validation effect and its one-attempt guard. Disabling DeepSeek resets that guard, so the next valid enabled state is treated as a fresh validation opportunity. This keeps connection-test state, task reporting, success handling, and failure handling in one path without adding another request implementation.

## Testing

Add a component regression test that starts with an enabled and connected saved configuration, turns DeepSeek off, turns it on again, and verifies exactly one additional connection test and the validating-to-connected status transition. Add coverage that re-enabling without a stored key sends no request.

