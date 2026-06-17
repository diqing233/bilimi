# Programmatic 3D Pet Prototype Design

- Date: 2026-06-17
- Status: Approved direction for implementation planning
- Scope: Replace the CSS palace-maid desktop pet with a real lightweight Three.js 3D prototype based on the blue-white porcelain tea-attendant character direction, prioritizing expression and motion states over props, while keeping a later GLB/VRM model path open.

## 1. Goal

Bilimi's desktop pet should feel like a small living 3D companion, closer to the Codex app's persistent 3D character pattern, without abandoning Bilimi's palace-maid identity. The visual direction is a blue-white porcelain tea-attendant chibi: pale blue hair, twin buns, blue-white robe, tassel-like ornaments, bright facial expressions, and gentle idle motion.

The first implementation will build a true 3D pet in code with Three.js. It will not use static image cards or CSS-only illustration. The pet remains a companion and status surface: it can be dragged, clicked to restore Bilimi, and show short state feedback, but it does not become an action menu.

Props such as a tray, teapot, or teacups are intentionally out of the first version. The desktop window is small, so silhouette, face, pose, and motion carry more value than detailed held objects.

## 2. Current Context

The current pet is `PalaceMaidPetApp`, rendered as nested DOM elements styled in `styles.css`. It already supports:

1. Drag start, move, and finish through the existing floating seal drag bridge.
2. Click-to-restore through `restoreMainWindowFromPet`.
3. Four normalized states from `petState.ts`: `idle`, `hint`, `working`, and `error`.
4. A short text bubble derived from `createPetStateView`.

The project currently has no 3D rendering dependency and no model asset pipeline.

## 3. Recommended Approach

Use a hybrid path:

1. First build a programmatic Three.js model from simple geometry.
2. Keep the app-level pet state and Electron window behavior unchanged.
3. Isolate rendering behind a component boundary so a later GLB/VRM loader can replace the geometry model without rewriting desktop behavior.

This is preferred over starting with a purchased or handcrafted GLB because Bilimi does not yet have a final character model asset. It is also preferred over staying with CSS because the requested experience is explicitly a real 3D character rather than a flat illustration.

## 4. Pet Visual Model

The first 3D model is a stylized Q-version blue-white porcelain tea attendant assembled from Three.js primitives:

1. Head: rounded soft face shape.
2. Hair: pale blue bob, twin side buns, and one curved ahoge strand.
3. Eyes and mouth: simple expressive face elements that can switch between happy, attentive, focused, shy, and wronged expressions.
4. Body and robe: compact blue-white robe silhouette with simplified porcelain-floral marks and blue trim.
5. Tassel or ribbon hints: small simplified ornaments that can sway with motion.
6. Halo or state light: subtle status signal around or behind the character.
7. Optional small base shadow: grounds the pet visually inside the transparent floating window.

The model should read as Bilimi's palace maid, not as a copy of Codex's abstract mascot. The Codex reference informs persistence, liveliness, and 3D presence, not literal shape.

The tray, teapot, teacups, book, broom, pillow, flowerpot, and other reference-sheet props are not included in the first 3D prototype.

## 5. Rendering Architecture

Add a renderer component under the assistant feature, for example:

1. `ThreePetCanvas.tsx`: React wrapper that owns the canvas mount, renderer lifecycle, resize handling, animation loop, and cleanup.
2. `petModel.ts`: pure Three.js model factory that builds the programmatic model and returns named parts used by animation.
3. `petAnimation.ts`: state-to-animation helpers for breathing, expression switching, hint, working, error, and click feedback states.

`PalaceMaidPetApp` remains responsible for input behavior, state subscription, click-to-restore, and bubble rendering. The 3D component receives `petState` as a prop and only controls visual presentation.

## 6. State Behavior

The existing four persisted product states remain the contract:

1. `idle`: calm breathing, subtle head movement, neutral warm light.
2. `hint`: happy or surprised expression, brighter light, small nod, wave, or attentive lean.
3. `working`: focused or cheering expression, small bouncing motion, raised hands, pulsing robe light, or faster halo motion.
4. `error`: wronged or upset expression, lowered head, amber/red state light, reduced bounce, and a small sweat/cloud cue where practical.

There is also one transient interaction animation:

1. `clicked`: short shy or delighted response after the user clicks the pet, then return to the previous persisted state.

State changes should be smooth. The pet should not flash aggressively or obscure the text bubble.

The first version does not need every expression in the reference sheet. It should cover five high-value behaviors:

1. Idle or daze.
2. Happy hint.
3. Working or cheering.
4. Error or wronged.
5. Click reaction.

## 7. Interaction Rules

The existing desktop behavior stays intact:

1. Pointer down starts dragging through the current desktop bridge.
2. Drag movement suppresses the restore click.
3. Click without drag restores or focuses the main Bilimi window.
4. A click also triggers the short `clicked` animation if the click is not suppressed by dragging.
5. The text bubble remains short state feedback.
6. No platform-changing actions are added to the pet.

The canvas should not swallow pointer events in a way that breaks the existing button behavior. The 3D renderer should be placed inside the current button or an equivalent accessible control.

## 8. Asset And GLB Path

The first version does not require external model files.

To preserve a future GLB/VRM path, the renderer boundary should expose a small internal interface:

1. Build or load model.
2. Return named animation targets.
3. Apply state updates.
4. Trigger transient interaction animations.
5. Dispose model resources.

Later, a `GLBPetModel` loader can replace `createProgrammaticPetModel` while keeping `ThreePetCanvas`, pet state, and Electron window behavior stable.

## 9. Performance And Reliability

The pet runs in a small always-on-top transparent Electron window, so it must stay lightweight:

1. Use a compact scene and low geometry counts.
2. Cap renderer pixel ratio to avoid unnecessary GPU cost.
3. Pause or reduce animation if the document is hidden.
4. Dispose geometries, materials, renderer, and animation frame on unmount.
5. Avoid network-loaded assets in the first version.

If WebGL initialization fails, the app should fall back to a simple DOM/CSS pet or show the existing state bubble with a non-3D placeholder.

## 10. Testing Strategy

Implementation should be verified with:

1. Component tests that confirm `PalaceMaidPetApp` still renders, subscribes to state, and preserves restore/drag behavior.
2. Unit tests for state normalization and state-to-animation configuration, including the transient click animation where practical.
3. A focused test for renderer fallback behavior if WebGL setup is unavailable.
4. Manual Electron verification on Windows that the floating pet window is visible, transparent, draggable, clickable, and animated.
5. Visual/browser verification that the 3D canvas is nonblank and does not overlap the bubble incoherently.

## 11. Acceptance Criteria

The prototype is complete when:

1. The desktop pet uses a real Three.js canvas with a visible 3D palace-maid-like model.
2. The pet no longer depends on CSS-only figure parts for its primary character body.
3. `idle`, `hint`, `working`, and `error` produce distinct 3D visual states.
4. Click without drag triggers a short reaction animation and still restores or focuses the main window.
5. Dragging and click-to-restore behavior still work.
6. The state bubble remains readable.
7. Renderer resources are cleaned up on unmount.
8. A future GLB/VRM replacement path is documented in the renderer boundary.

## 12. Out Of Scope

This prototype does not include:

1. A final handcrafted production character model.
2. VRM expression rigging.
3. Full skeletal animation.
4. Clothing, skin, or accessory customization.
5. Pet leveling, feeding, or raising mechanics.
6. New Bilibili automation behavior.
7. Tray, teapot, teacup, book, broom, pillow, flowerpot, or other prop-heavy actions.
8. Implementing every expression and activity shown in the reference sheet.
