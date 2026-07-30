# DeepSeek Cancel Toggle Design

## Goal

Replace the separate DeepSeek organize and cancel controls with one stable-width state button so cancellation never wraps onto its own row.

## Interaction

The button has three states:

| State | Label | Action | Enabled |
| --- | --- | --- | --- |
| Idle | `DeepSeek 整理` | Start organization | When the existing prerequisites pass |
| Running | `取消整理` | Request cancellation | Yes |
| Cancellation requested | `取消中...` | None | No |

Cancellation keeps the existing batch boundary: the in-flight request may finish, but no later batch starts. The scope selector remains locked while organization is running.

## Layout

The single button stays beside the scope selector. A stable minimum width prevents state-label changes from shifting the toolbar. The running cancel state uses the existing porcelain error color as a restrained warning treatment.

## Tests

- Extend the existing cancellation test to verify that one button changes from start to cancel to cancelling and returns to start after cancellation completes.
- Add style assertions for stable width and the running warning state.
- Run the focused tests, full test suite, production build, and an actual development UI check.
