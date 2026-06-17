# Layered 2D Desktop Pet Design

- Date: 2026-06-17
- Status: Implemented on 2026-06-17
- Scope: Replace the current CSS-only palace-maid desktop pet direction with a lightweight 2D blue-white porcelain chibi maid pet, using generated transparent bitmap assets and DOM/CSS animation orchestration.

## 1. Goal

Bilimi's desktop pet should become a small expressive 2D companion inspired by the provided blue-white porcelain chibi tea-attendant/palace-maid references. The first production direction should not continue the earlier Three.js prototype path.

The pet remains a companion and status surface. It can be dragged, clicked to restore or focus Bilimi, and show short status bubbles. It must not become an action menu, add platform controls, or perform Bilibili-changing actions.

The first version should use generated project-owned transparent PNG or WebP assets based on the reference style direction. The reference images are visual inspiration only; the implementation must not crop, trace, or directly reuse their artwork.

## 2. Current Context

The current app is Electron, React, and TypeScript.

`PalaceMaidPetApp` already owns the desktop pet behavior:

1. Pointer drag start, movement detection, drag finish, and click suppression through the existing floating seal drag bridge.
2. Click-to-restore through `restoreMainWindowFromPet`.
3. Four product states from `petState.ts`: `idle`, `hint`, `working`, and `error`.
4. A short state bubble derived from `createPetStateView`.

The current primary character body is CSS-only DOM illustration inside `src/renderer/src/styles.css`. That implementation is lightweight but cannot efficiently reach the desired anime/chibi porcelain-maid visual quality.

## 3. Technical Choice

Use transparent PNG/WebP assets rendered as DOM elements, with CSS keyframe animation and state classes.

This is preferred over pure CSS/DOM because the desired hair, eyes, robe pattern, tassels, porcelain-blue ornament detail, blush, and facial highlights are better represented as bitmap art than as CSS shapes.

This is also preferred over a Canvas sprite sheet for the first version. Canvas is useful for dense frame animation, many particles, or pixel-level effects, but this pet needs a small number of named visual assets with state-driven transforms, opacity changes, and expression swaps. DOM images are easier to inspect, test, click through, and later replace with a Live2D or Spine renderer boundary.

The renderer should keep the current Electron window small and transparent. It should avoid network-loaded assets, heavy runtime dependencies, WebGL, and large frame sequences.

## 4. Rendering Architecture

Keep `PalaceMaidPetApp` as the owner of desktop behavior and add an isolated 2D renderer under the assistant feature.

Recommended files:

1. `src/renderer/src/features/assistant/layeredPetTypes.ts`
   Defines pet renderer state names, expression names, layer IDs, and the small future renderer interface.
2. `src/renderer/src/features/assistant/layeredPetModel.ts`
   Maps each product state and transient animation to visible layers, CSS animation names, and timing.
3. `src/renderer/src/features/assistant/LayeredPetRenderer.tsx`
   React component that renders the named bitmap layers and applies state/transient attributes.
4. `src/renderer/src/features/assistant/LayeredPetRenderer.test.tsx`
   Verifies state mapping, transient behavior, asset alt-hidden structure, and fallback rendering.
5. `src/renderer/src/features/assistant/petAssets.ts`
   Imports or declares the generated asset URLs in one place.
6. `src/renderer/src/assets/pet/blue-white-maid/`
   Stores generated transparent WebP or PNG layers.

`PalaceMaidPetApp` passes the persistent `petState` to the renderer and increments a click reaction signal when a non-drag click occurs. The renderer never calls Electron APIs and never decides product state.

## 5. Asset Organization

Use a compact character-state asset set rather than prop-heavy activity art.

Implemented asset tree:

```text
src/renderer/src/assets/pet/blue-white-maid/
  character/idle.png
  character/hint.png
  character/working.png
  character/error.png
  character/clicked.png
  effects/hint-sparkles.png
  effects/working-stars.png
  effects/error-sweat.png
  effects/click-hearts.png
```

The first implementation intentionally uses five full-character state PNGs plus light effect layers. This replaced the originally proposed fine-grained `base/`, `face/`, and `accessories/` split after visual review showed that programmatic or overly granular placeholder art did not meet the required fidelity. The stable renderer contract remains `character` plus `effect` layers, with expressions represented in the selected character-state bitmap.

The first asset set should be generated as original artwork in the same broad direction as the references:

1. Blue-white porcelain palette.
2. Pale blue hair.
3. Twin buns.
4. Chibi proportions with large expressive eyes.
5. Compact palace-maid robe silhouette.
6. Blue ribbon, flower, tassel, and porcelain-pattern accents.

Do not include trays, teapots, teacups, books, brooms, pillows, flowerpots, or other activity props in this first version. The small Electron floating window should prioritize face, silhouette, and motion.

Each character and effect asset should share a stable transparent canvas size so DOM placement is stable. The first implementation uses square transparent PNGs displayed at the existing pet visual size. This avoids layout shifts when states change.

## 6. State Mapping

The four persistent product states remain the public contract.

### idle

Mood: calm, available, quietly present.

Visual behavior:

1. Idle eyes and smile in the `character/idle.png` state image.
2. Slow breathing scale on the character layer.
3. Gentle head bob.
4. Hair and tassel motion implied by the state image and stage animation.
5. No strong effect layer.

### hint

Mood: happy prompt or attention request.

Visual behavior:

1. Happy eyes and open smile in the `character/hint.png` state image.
2. Shorter upbeat bounce.
3. Prompting pose through the state image.
4. Hint sparkles fade or twinkle near the head.
5. Existing bubble remains the textual cue.

### working

Mood: focused, cheering, "加油".

Visual behavior:

1. Focused or energetic eyes in the `character/working.png` state image.
2. Open or small determined mouth.
3. Rhythmic bounce with slightly faster timing than idle.
4. Cheer pose through the state image.
5. Working stars pulse lightly.

### error

Mood: wronged, apologetic, needs attention.

Visual behavior:

1. Wronged eyes and small mouth in the `character/error.png` state image.
2. Head lowers a few pixels.
3. Reduced motion amplitude.
4. Error sweat/cloud effect appears.
5. No aggressive red flashing; the pet should signal recoverable attention, not alarm.

## 7. Transient Click Feedback

Click feedback is a transient animation layered over the persistent product state.

When the user clicks without dragging:

1. `PalaceMaidPetApp` still restores or focuses the main Bilimi window.
2. It also increments a click reaction signal.
3. `LayeredPetRenderer` plays `clicked` for about 700-900ms.
4. During `clicked`, the renderer swaps to `character/clicked.png`, shows hearts, and plays a quick bounce.
5. When the timer ends, the renderer returns to the latest persistent state.

Dragging must not trigger `clicked`, and the click event that follows a drag release must still be suppressed.

The transient animation must not call `setAssistantPetState`, must not overwrite `idle/hint/working/error`, and must remain purely visual.

## 8. Future Live2D Or Spine Path

The first version must not add Live2D, Spine, Pixi, or other heavy animation runtimes.

Preserve the upgrade path through a small renderer boundary:

```ts
export type PetTransient = 'clicked'

export type PetRendererHandle = {
  setState(state: AssistantPetState): void
  playTransient(name: PetTransient): void
}
```

The DOM renderer implements this behavior through props and effects in the first bitmap version. A later `Live2DPetRenderer` or `SpinePetRenderer` can keep the same state and transient contract while replacing internal rendering.

The named conceptual parts should remain stable across renderer types, even though the first bitmap implementation stores them inside full-character state images:

1. Head.
2. Body.
3. Eyes.
4. Mouth.
5. Hands.
6. Ahoge.
7. Tassels.
8. Effects.

## 9. Performance And Reliability

The pet runs in a small always-on-top transparent Electron window, so the first implementation should be conservative:

1. Use a small number of bitmap layers.
2. Prefer WebP for production assets when transparency quality is acceptable; PNG is acceptable for crisp fallback or if WebP tooling is inconvenient.
3. Avoid large frame sequences.
4. Use CSS transforms and opacity rather than layout-affecting animation.
5. Set fixed dimensions and aspect ratio for the pet stage.
6. Respect reduced-motion preferences by disabling bounce/sway and keeping expression swaps.
7. Provide a fallback visual if an asset fails to load or the asset manifest is incomplete.

## 10. Interaction Rules

Existing interaction behavior remains:

1. Pointer down starts drag through the current desktop bridge.
2. Pointer movement beyond the threshold marks the gesture as drag.
3. Drag release suppresses the subsequent click.
4. Non-drag click restores or focuses the main Bilimi window.
5. Non-drag click also plays the transient click animation.
6. The pet has no extra buttons, menus, or platform action controls.
7. The state bubble stays readable and does not obscure the face.

## 11. Testing Strategy

Implementation should be verified with:

1. Unit tests for product-state-to-layer mapping in `layeredPetModel.ts`.
2. Component tests for `LayeredPetRenderer` showing the expected active expression and effect layers for `idle`, `hint`, `working`, and `error`.
3. Component tests that a changed click signal starts a transient `clicked` state and returns to the persistent state after the configured duration.
4. `PalaceMaidPetApp` tests that click-to-restore still works and drag still suppresses restore and click feedback.
5. Reduced-motion behavior where practical.
6. Build or test verification that generated assets are imported successfully.
7. Manual Windows Electron verification for transparent window, drag, click restore, state bubble readability, and animation smoothness.

## 12. Acceptance Criteria

The feature is complete when:

1. The desktop pet uses transparent 2D bitmap assets as its primary character body.
2. The pet visually reads as an original blue-white porcelain chibi palace maid inspired by the references.
3. `idle`, `hint`, `working`, and `error` show distinct expressions and motions.
4. Click without drag plays a short shy/happy transient animation and still restores or focuses Bilimi.
5. Dragging does not trigger restore or click feedback.
6. No tray, teapot, teacup, book, broom, pillow, flowerpot, platform button, or action menu is added to the pet.
7. The renderer remains dependency-light and does not add Live2D, Spine, Three.js, Pixi, or Canvas sprite runtimes.
8. The state bubble remains readable in the transparent floating Electron window.
9. Tests cover mapping, renderer behavior, click transient behavior, and interaction regressions.
10. A future Live2D or Spine renderer can replace the DOM renderer without changing product states or Electron window behavior.

## 13. Out Of Scope

This version does not include:

1. A pet marketplace or character selector.
2. Pet leveling, feeding, dressing, or long-term raising systems.
3. New Bilibili automation behavior.
4. New platform-affecting controls in the pet window.
5. Full skeletal animation.
6. Live2D, Spine, Pixi, Three.js, or WebGL integration.
7. Exhaustive implementation of every expression and activity shown in the reference sheet.
