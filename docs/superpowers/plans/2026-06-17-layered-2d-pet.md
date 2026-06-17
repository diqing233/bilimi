# Layered 2D Desktop Pet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current CSS-only desktop pet body with a lightweight layered 2D blue-white porcelain chibi maid renderer, while preserving drag, click-to-restore, state bubble, and future renderer upgrade boundaries.

**Architecture:** Keep `PalaceMaidPetApp` responsible for Electron bridge behavior and persistent state. Add a pure state-to-layer model plus a DOM/CSS `LayeredPetRenderer` that renders generated transparent bitmap layers and plays a transient click animation without mutating product state.

**Tech Stack:** Electron, React 19, TypeScript, Vite asset imports, Vitest, Testing Library, CSS keyframes, generated transparent PNG assets.

---

## File Structure

- Create: `src/renderer/src/features/assistant/layeredPetTypes.ts`
  - Defines `PetLayerId`, `PetExpression`, `PetEffect`, `PetMotion`, `PetTransient`, `PetRendererHandle`, and view-model types.
- Create: `src/renderer/src/features/assistant/layeredPetModel.ts`
  - Maps `idle`, `hint`, `working`, `error`, and transient `clicked` to expressions, effects, motions, and timing.
- Create: `src/renderer/src/features/assistant/layeredPetModel.test.ts`
  - Unit-tests state mapping and transient overlay behavior.
- Create: `src/renderer/src/features/assistant/petAssets.ts`
  - Imports generated PNG assets and exposes a keyed asset manifest.
- Create: `src/renderer/src/features/assistant/LayeredPetRenderer.tsx`
  - Renders the layer stack with fixed ordering, active expression/effect layers, image failure fallback, and click transient timer.
- Create: `src/renderer/src/features/assistant/LayeredPetRenderer.test.tsx`
  - Component-tests persistent state rendering, transient click behavior, fallback, and reduced-motion data attributes.
- Modify: `src/renderer/src/features/assistant/PalaceMaidPetApp.tsx`
  - Replace CSS-only figure markup with `LayeredPetRenderer`, increment click signal on non-drag click, and keep all existing Electron behavior.
- Modify: `src/renderer/src/features/assistant/PalaceMaidPetApp.test.tsx`
  - Mock `LayeredPetRenderer`, assert state and click signal behavior, and assert drag does not trigger click feedback.
- Modify: `src/renderer/src/styles.css`
  - Remove or neutralize old CSS-only character body styles and add layered pet stage, image layer, effect, state motion, transient, fallback, and reduced-motion styles.
- Create generated asset files under `src/renderer/src/assets/pet/blue-white-maid/`
  - Use original generated transparent PNG files with stable 512x512 canvases.

Non-goals for this implementation:

- Do not repair existing Chinese text encoding in `petState.ts` or its tests.
- Do not add Live2D, Spine, Pixi, Three.js, Canvas sprite runtimes, or new dependencies.
- Do not add tray, teapot, teacup, book, broom, pillow, flowerpot, action menu, or platform controls.

### Task 1: Define Layered Pet Model

**Files:**
- Create: `src/renderer/src/features/assistant/layeredPetTypes.ts`
- Create: `src/renderer/src/features/assistant/layeredPetModel.ts`
- Create: `src/renderer/src/features/assistant/layeredPetModel.test.ts`

- [ ] **Step 1: Write the failing model tests**

Create `src/renderer/src/features/assistant/layeredPetModel.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createLayeredPetView, createLayeredPetTransientView } from './layeredPetModel'

describe('layeredPetModel', () => {
  it('maps persistent pet states to expressions, effects, and motions', () => {
    expect(createLayeredPetView('idle')).toMatchObject({
      state: 'idle',
      expression: {
        eyes: 'idle',
        mouth: 'smile'
      },
      effect: 'none',
      motion: 'idle'
    })

    expect(createLayeredPetView('hint')).toMatchObject({
      state: 'hint',
      expression: {
        eyes: 'happy',
        mouth: 'open'
      },
      effect: 'hint-sparkles',
      motion: 'hint'
    })

    expect(createLayeredPetView('working')).toMatchObject({
      state: 'working',
      expression: {
        eyes: 'focused',
        mouth: 'open'
      },
      effect: 'working-stars',
      motion: 'working'
    })

    expect(createLayeredPetView('error')).toMatchObject({
      state: 'error',
      expression: {
        eyes: 'wronged',
        mouth: 'small'
      },
      effect: 'error-sweat',
      motion: 'error'
    })
  })

  it('creates a clicked transient without changing the persistent state contract', () => {
    expect(createLayeredPetTransientView('clicked')).toEqual({
      transient: 'clicked',
      expression: {
        eyes: 'happy',
        mouth: 'smile'
      },
      effect: 'click-hearts',
      motion: 'clicked',
      durationMs: 850
    })
  })

  it('keeps layer ordering stable for all persistent states', () => {
    expect(createLayeredPetView('idle').layers.map((layer) => layer.id)).toEqual([
      'hairBack',
      'body',
      'head',
      'hairFront',
      'leftHand',
      'rightHand',
      'eyes',
      'mouth',
      'ahoge',
      'leftTassel',
      'rightTassel',
      'effect'
    ])
    expect(createLayeredPetView('working').layers).toHaveLength(12)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run test -- src/renderer/src/features/assistant/layeredPetModel.test.ts
```

Expected: FAIL with an import resolution error for `./layeredPetModel`.

- [ ] **Step 3: Create type definitions**

Create `src/renderer/src/features/assistant/layeredPetTypes.ts`:

```ts
import type { AssistantPetState } from './petState'

export type PetLayerId =
  | 'hairBack'
  | 'body'
  | 'head'
  | 'hairFront'
  | 'leftHand'
  | 'rightHand'
  | 'eyes'
  | 'mouth'
  | 'ahoge'
  | 'leftTassel'
  | 'rightTassel'
  | 'effect'

export type PetEyes = 'idle' | 'happy' | 'focused' | 'wronged'

export type PetMouth = 'smile' | 'open' | 'small'

export type PetEffect = 'none' | 'hint-sparkles' | 'working-stars' | 'error-sweat' | 'click-hearts'

export type PetMotion = 'idle' | 'hint' | 'working' | 'error' | 'clicked'

export type PetTransient = 'clicked'

export type PetExpression = {
  eyes: PetEyes
  mouth: PetMouth
}

export type PetLayerView = {
  id: PetLayerId
  visible: boolean
}

export type LayeredPetView = {
  state: AssistantPetState
  expression: PetExpression
  effect: PetEffect
  motion: PetMotion
  layers: PetLayerView[]
}

export type LayeredPetTransientView = {
  transient: PetTransient
  expression: PetExpression
  effect: PetEffect
  motion: 'clicked'
  durationMs: number
}

export type PetRendererHandle = {
  setState(state: AssistantPetState): void
  playTransient(name: PetTransient): void
}
```

- [ ] **Step 4: Create the model mapping**

Create `src/renderer/src/features/assistant/layeredPetModel.ts`:

```ts
import type { AssistantPetState } from './petState'
import type {
  LayeredPetTransientView,
  LayeredPetView,
  PetEffect,
  PetExpression,
  PetLayerId,
  PetMotion,
  PetTransient
} from './layeredPetTypes'

const LAYER_ORDER: PetLayerId[] = [
  'hairBack',
  'body',
  'head',
  'hairFront',
  'leftHand',
  'rightHand',
  'eyes',
  'mouth',
  'ahoge',
  'leftTassel',
  'rightTassel',
  'effect'
]

const STATE_VISUALS: Record<
  AssistantPetState,
  {
    expression: PetExpression
    effect: PetEffect
    motion: PetMotion
  }
> = {
  idle: {
    expression: {
      eyes: 'idle',
      mouth: 'smile'
    },
    effect: 'none',
    motion: 'idle'
  },
  hint: {
    expression: {
      eyes: 'happy',
      mouth: 'open'
    },
    effect: 'hint-sparkles',
    motion: 'hint'
  },
  working: {
    expression: {
      eyes: 'focused',
      mouth: 'open'
    },
    effect: 'working-stars',
    motion: 'working'
  },
  error: {
    expression: {
      eyes: 'wronged',
      mouth: 'small'
    },
    effect: 'error-sweat',
    motion: 'error'
  }
}

const TRANSIENT_VISUALS: Record<PetTransient, LayeredPetTransientView> = {
  clicked: {
    transient: 'clicked',
    expression: {
      eyes: 'happy',
      mouth: 'smile'
    },
    effect: 'click-hearts',
    motion: 'clicked',
    durationMs: 850
  }
}

export function createLayeredPetView(state: AssistantPetState): LayeredPetView {
  const visual = STATE_VISUALS[state]

  return {
    state,
    ...visual,
    layers: LAYER_ORDER.map((id) => ({
      id,
      visible: id !== 'effect' || visual.effect !== 'none'
    }))
  }
}

export function createLayeredPetTransientView(
  transient: PetTransient
): LayeredPetTransientView {
  return TRANSIENT_VISUALS[transient]
}
```

- [ ] **Step 5: Run model tests to verify they pass**

Run:

```bash
npm run test -- src/renderer/src/features/assistant/layeredPetModel.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the model**

Run:

```bash
git add src/renderer/src/features/assistant/layeredPetTypes.ts src/renderer/src/features/assistant/layeredPetModel.ts src/renderer/src/features/assistant/layeredPetModel.test.ts
git commit -m "feat: define layered pet state model"
```

Expected: commit succeeds.

### Task 2: Generate And Register Original Layer Assets

**Files:**
- Create: `src/renderer/src/assets/pet/blue-white-maid/base/body.png`
- Create: `src/renderer/src/assets/pet/blue-white-maid/base/head.png`
- Create: `src/renderer/src/assets/pet/blue-white-maid/base/hair-back.png`
- Create: `src/renderer/src/assets/pet/blue-white-maid/base/hair-front.png`
- Create: `src/renderer/src/assets/pet/blue-white-maid/base/left-hand.png`
- Create: `src/renderer/src/assets/pet/blue-white-maid/base/right-hand.png`
- Create: `src/renderer/src/assets/pet/blue-white-maid/face/eyes-idle.png`
- Create: `src/renderer/src/assets/pet/blue-white-maid/face/eyes-happy.png`
- Create: `src/renderer/src/assets/pet/blue-white-maid/face/eyes-focused.png`
- Create: `src/renderer/src/assets/pet/blue-white-maid/face/eyes-wronged.png`
- Create: `src/renderer/src/assets/pet/blue-white-maid/face/mouth-smile.png`
- Create: `src/renderer/src/assets/pet/blue-white-maid/face/mouth-open.png`
- Create: `src/renderer/src/assets/pet/blue-white-maid/face/mouth-small.png`
- Create: `src/renderer/src/assets/pet/blue-white-maid/accessories/ahoge.png`
- Create: `src/renderer/src/assets/pet/blue-white-maid/accessories/tassel-left.png`
- Create: `src/renderer/src/assets/pet/blue-white-maid/accessories/tassel-right.png`
- Create: `src/renderer/src/assets/pet/blue-white-maid/effects/hint-sparkles.png`
- Create: `src/renderer/src/assets/pet/blue-white-maid/effects/working-stars.png`
- Create: `src/renderer/src/assets/pet/blue-white-maid/effects/error-sweat.png`
- Create: `src/renderer/src/assets/pet/blue-white-maid/effects/click-hearts.png`
- Create: `src/renderer/src/features/assistant/petAssets.ts`

- [ ] **Step 1: Generate original transparent PNG layer assets**

Use image generation or a local drawing script to create original 512x512 transparent PNG assets. The character should be a blue-white porcelain chibi palace maid with pale blue hair, twin buns, robe, ribbon, flowers, tassels, expressive eyes, and no props.

Required layer design:

- Every file is 512x512 with a transparent background.
- Layers share the same registration point.
- Base layers compose into one readable chibi character at small size.
- Face layers only contain eyes or mouth pixels.
- Effect layers only contain the named effect.

If using a local script, keep it out of the commit unless it is intentionally maintained. Do not derive these files by cropping or tracing the provided reference images.

- [ ] **Step 2: Create asset manifest**

Create `src/renderer/src/features/assistant/petAssets.ts`:

```ts
import ahogeUrl from '../../assets/pet/blue-white-maid/accessories/ahoge.png'
import leftTasselUrl from '../../assets/pet/blue-white-maid/accessories/tassel-left.png'
import rightTasselUrl from '../../assets/pet/blue-white-maid/accessories/tassel-right.png'
import bodyUrl from '../../assets/pet/blue-white-maid/base/body.png'
import hairBackUrl from '../../assets/pet/blue-white-maid/base/hair-back.png'
import hairFrontUrl from '../../assets/pet/blue-white-maid/base/hair-front.png'
import headUrl from '../../assets/pet/blue-white-maid/base/head.png'
import leftHandUrl from '../../assets/pet/blue-white-maid/base/left-hand.png'
import rightHandUrl from '../../assets/pet/blue-white-maid/base/right-hand.png'
import clickHeartsUrl from '../../assets/pet/blue-white-maid/effects/click-hearts.png'
import errorSweatUrl from '../../assets/pet/blue-white-maid/effects/error-sweat.png'
import hintSparklesUrl from '../../assets/pet/blue-white-maid/effects/hint-sparkles.png'
import workingStarsUrl from '../../assets/pet/blue-white-maid/effects/working-stars.png'
import eyesFocusedUrl from '../../assets/pet/blue-white-maid/face/eyes-focused.png'
import eyesHappyUrl from '../../assets/pet/blue-white-maid/face/eyes-happy.png'
import eyesIdleUrl from '../../assets/pet/blue-white-maid/face/eyes-idle.png'
import eyesWrongedUrl from '../../assets/pet/blue-white-maid/face/eyes-wronged.png'
import mouthOpenUrl from '../../assets/pet/blue-white-maid/face/mouth-open.png'
import mouthSmallUrl from '../../assets/pet/blue-white-maid/face/mouth-small.png'
import mouthSmileUrl from '../../assets/pet/blue-white-maid/face/mouth-smile.png'
import type { PetEffect, PetEyes, PetLayerId, PetMouth } from './layeredPetTypes'

export type PetAssetManifest = {
  base: Record<Exclude<PetLayerId, 'eyes' | 'mouth' | 'effect'>, string>
  eyes: Record<PetEyes, string>
  mouth: Record<PetMouth, string>
  effects: Record<Exclude<PetEffect, 'none'>, string>
}

export const blueWhiteMaidPetAssets: PetAssetManifest = {
  base: {
    hairBack: hairBackUrl,
    body: bodyUrl,
    head: headUrl,
    hairFront: hairFrontUrl,
    leftHand: leftHandUrl,
    rightHand: rightHandUrl,
    ahoge: ahogeUrl,
    leftTassel: leftTasselUrl,
    rightTassel: rightTasselUrl
  },
  eyes: {
    idle: eyesIdleUrl,
    happy: eyesHappyUrl,
    focused: eyesFocusedUrl,
    wronged: eyesWrongedUrl
  },
  mouth: {
    smile: mouthSmileUrl,
    open: mouthOpenUrl,
    small: mouthSmallUrl
  },
  effects: {
    'hint-sparkles': hintSparklesUrl,
    'working-stars': workingStarsUrl,
    'error-sweat': errorSweatUrl,
    'click-hearts': clickHeartsUrl
  }
}
```

- [ ] **Step 3: Verify asset imports build**

Run:

```bash
npm run build
```

Expected: PASS. If Vite cannot resolve a file, fix the file name or import path.

- [ ] **Step 4: Commit assets and manifest**

Run:

```bash
git add src/renderer/src/assets/pet/blue-white-maid src/renderer/src/features/assistant/petAssets.ts
git commit -m "feat: add layered pet assets"
```

Expected: commit succeeds.

### Task 3: Build Layered Pet Renderer

**Files:**
- Create: `src/renderer/src/features/assistant/LayeredPetRenderer.tsx`
- Create: `src/renderer/src/features/assistant/LayeredPetRenderer.test.tsx`
- Modify: `src/renderer/src/styles.css`

- [ ] **Step 1: Write failing renderer tests**

Create `src/renderer/src/features/assistant/LayeredPetRenderer.test.tsx`:

```tsx
import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LayeredPetRenderer } from './LayeredPetRenderer'

describe('LayeredPetRenderer', () => {
  it('renders persistent state layers with hidden decorative images', () => {
    render(<LayeredPetRenderer petState="working" clickReactionSignal={0} />)

    const pet = screen.getByTestId('layered-pet')

    expect(pet).toHaveAttribute('data-pet-state', 'working')
    expect(pet).toHaveAttribute('data-pet-motion', 'working')
    expect(pet).toHaveAttribute('data-pet-effect', 'working-stars')
    expect(screen.getByTestId('layered-pet-eyes')).toHaveAttribute('data-expression', 'focused')
    expect(screen.getByTestId('layered-pet-mouth')).toHaveAttribute('data-expression', 'open')
    expect(screen.getAllByRole('presentation')).toHaveLength(12)
  })

  it('plays clicked transient when the click signal changes and then returns to persistent state', () => {
    vi.useFakeTimers()

    const { rerender } = render(<LayeredPetRenderer petState="idle" clickReactionSignal={0} />)

    rerender(<LayeredPetRenderer petState="idle" clickReactionSignal={1} />)

    const pet = screen.getByTestId('layered-pet')
    expect(pet).toHaveAttribute('data-pet-transient', 'clicked')
    expect(pet).toHaveAttribute('data-pet-motion', 'clicked')
    expect(pet).toHaveAttribute('data-pet-effect', 'click-hearts')

    act(() => {
      vi.advanceTimersByTime(850)
    })

    expect(pet).not.toHaveAttribute('data-pet-transient')
    expect(pet).toHaveAttribute('data-pet-motion', 'idle')
    expect(pet).toHaveAttribute('data-pet-effect', 'none')

    vi.useRealTimers()
  })

  it('keeps the newest persistent state after a click transient expires', () => {
    vi.useFakeTimers()

    const { rerender } = render(<LayeredPetRenderer petState="idle" clickReactionSignal={0} />)
    rerender(<LayeredPetRenderer petState="idle" clickReactionSignal={1} />)
    rerender(<LayeredPetRenderer petState="error" clickReactionSignal={1} />)

    const pet = screen.getByTestId('layered-pet')

    act(() => {
      vi.advanceTimersByTime(850)
    })

    expect(pet).toHaveAttribute('data-pet-state', 'error')
    expect(pet).toHaveAttribute('data-pet-motion', 'error')
    expect(pet).toHaveAttribute('data-pet-effect', 'error-sweat')

    vi.useRealTimers()
  })

  it('shows a fallback when any image layer fails to load', () => {
    render(<LayeredPetRenderer petState="hint" clickReactionSignal={0} />)

    screen.getByTestId('layered-pet-body').dispatchEvent(new Event('error', { bubbles: true }))

    expect(screen.getByText('Bilimi')).toBeInTheDocument()
    expect(screen.getByTestId('layered-pet')).toHaveAttribute('data-asset-error', 'true')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run test -- src/renderer/src/features/assistant/LayeredPetRenderer.test.tsx
```

Expected: FAIL with an import resolution error for `./LayeredPetRenderer`.

- [ ] **Step 3: Implement renderer**

Create `src/renderer/src/features/assistant/LayeredPetRenderer.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { createLayeredPetTransientView, createLayeredPetView } from './layeredPetModel'
import { blueWhiteMaidPetAssets } from './petAssets'
import type { AssistantPetState } from './petState'
import type { PetLayerId, PetTransient } from './layeredPetTypes'

type LayeredPetRendererProps = {
  petState: AssistantPetState
  clickReactionSignal: number
}

function getLayerSource(
  layerId: PetLayerId,
  view: ReturnType<typeof createLayeredPetView>,
  transient: ReturnType<typeof createLayeredPetTransientView> | null
) {
  const expression = transient?.expression ?? view.expression
  const effect = transient?.effect ?? view.effect

  if (layerId === 'eyes') {
    return blueWhiteMaidPetAssets.eyes[expression.eyes]
  }

  if (layerId === 'mouth') {
    return blueWhiteMaidPetAssets.mouth[expression.mouth]
  }

  if (layerId === 'effect') {
    return effect === 'none' ? null : blueWhiteMaidPetAssets.effects[effect]
  }

  return blueWhiteMaidPetAssets.base[layerId]
}

function getLayerClassName(layerId: PetLayerId) {
  return `layered-pet__layer layered-pet__layer--${layerId}`
}

export function LayeredPetRenderer({
  petState,
  clickReactionSignal
}: LayeredPetRendererProps) {
  const [assetFailed, setAssetFailed] = useState(false)
  const [transientName, setTransientName] = useState<PetTransient | null>(null)
  const previousClickSignal = useRef(clickReactionSignal)
  const view = useMemo(() => createLayeredPetView(petState), [petState])
  const transient = transientName ? createLayeredPetTransientView(transientName) : null
  const activeMotion = transient?.motion ?? view.motion
  const activeEffect = transient?.effect ?? view.effect
  const activeExpression = transient?.expression ?? view.expression

  useEffect(() => {
    if (clickReactionSignal === previousClickSignal.current) {
      return
    }

    previousClickSignal.current = clickReactionSignal
    const nextTransient = createLayeredPetTransientView('clicked')
    setTransientName('clicked')

    const timeoutId = window.setTimeout(() => {
      setTransientName(null)
    }, nextTransient.durationMs)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [clickReactionSignal])

  return (
    <span
      className="layered-pet"
      data-testid="layered-pet"
      data-pet-state={view.state}
      data-pet-motion={activeMotion}
      data-pet-effect={activeEffect}
      data-pet-transient={transientName ?? undefined}
      data-asset-error={assetFailed ? 'true' : 'false'}
    >
      {view.layers.map((layer) => {
        const source = getLayerSource(layer.id, view, transient)

        if (!source || !layer.visible) {
          return null
        }

        const expression =
          layer.id === 'eyes'
            ? activeExpression.eyes
            : layer.id === 'mouth'
              ? activeExpression.mouth
              : undefined

        return (
          <img
            key={layer.id}
            src={source}
            className={getLayerClassName(layer.id)}
            data-testid={`layered-pet-${layer.id}`}
            data-layer={layer.id}
            data-expression={expression}
            alt=""
            role="presentation"
            draggable={false}
            onError={() => setAssetFailed(true)}
          />
        )
      })}
      {assetFailed ? <span className="layered-pet__fallback">Bilimi</span> : null}
    </span>
  )
}
```

- [ ] **Step 4: Add renderer CSS**

In `src/renderer/src/styles.css`, add this CSS after the existing `.palace-maid-pet__bubble span` rule:

```css
.layered-pet {
  position: relative;
  z-index: 1;
  display: block;
  width: 104px;
  height: 104px;
  aspect-ratio: 1;
  pointer-events: none;
  transform-origin: 50% 78%;
  animation: layered-pet-idle 3.8s ease-in-out infinite;
}

.layered-pet__layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  user-select: none;
  -webkit-user-drag: none;
  pointer-events: none;
}

.layered-pet__layer--ahoge,
.layered-pet__layer--leftTassel,
.layered-pet__layer--rightTassel {
  transform-origin: 50% 18%;
  animation: layered-pet-sway 2.8s ease-in-out infinite;
}

.layered-pet__layer--leftHand,
.layered-pet__layer--rightHand {
  transform-origin: 50% 72%;
}

.layered-pet[data-pet-motion="hint"] {
  animation-name: layered-pet-hint;
  animation-duration: 1.5s;
}

.layered-pet[data-pet-motion="working"] {
  animation-name: layered-pet-working;
  animation-duration: 1s;
}

.layered-pet[data-pet-motion="error"] {
  animation-name: layered-pet-error;
  animation-duration: 3.2s;
}

.layered-pet[data-pet-motion="clicked"] {
  animation-name: layered-pet-clicked;
  animation-duration: 850ms;
  animation-iteration-count: 1;
}

.layered-pet[data-pet-motion="hint"] .layered-pet__layer--leftHand,
.layered-pet[data-pet-motion="hint"] .layered-pet__layer--rightHand,
.layered-pet[data-pet-motion="working"] .layered-pet__layer--leftHand,
.layered-pet[data-pet-motion="working"] .layered-pet__layer--rightHand {
  transform: translateY(-4px);
}

.layered-pet__layer--effect {
  animation: layered-pet-effect 1.2s ease-in-out infinite;
}

.layered-pet__fallback {
  position: absolute;
  inset: 22px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: rgba(238, 248, 255, 0.92);
  color: #2f64a8;
  font: 700 13px "Noto Serif SC", "Songti SC", "SimSun", serif;
  box-shadow: inset 0 0 0 1px rgba(79, 129, 190, 0.24);
}

@keyframes layered-pet-idle {
  0%,
  100% {
    transform: translateY(0) scale(1);
  }

  50% {
    transform: translateY(-2px) scale(1.015);
  }
}

@keyframes layered-pet-hint {
  0%,
  100% {
    transform: translateY(0) scale(1);
  }

  40% {
    transform: translateY(-5px) scale(1.035);
  }
}

@keyframes layered-pet-working {
  0%,
  100% {
    transform: translateY(0) rotate(0deg);
  }

  50% {
    transform: translateY(-3px) rotate(-1deg);
  }
}

@keyframes layered-pet-error {
  0%,
  100% {
    transform: translateY(2px) scale(0.99);
  }

  50% {
    transform: translateY(0) scale(1);
  }
}

@keyframes layered-pet-clicked {
  0% {
    transform: translateY(0) scale(1);
  }

  35% {
    transform: translateY(-7px) scale(1.06);
  }

  100% {
    transform: translateY(0) scale(1);
  }
}

@keyframes layered-pet-sway {
  0%,
  100% {
    transform: rotate(-2deg);
  }

  50% {
    transform: rotate(2deg);
  }
}

@keyframes layered-pet-effect {
  0%,
  100% {
    opacity: 0.65;
    transform: scale(0.98);
  }

  50% {
    opacity: 1;
    transform: scale(1.04);
  }
}

@media (prefers-reduced-motion: reduce) {
  .layered-pet,
  .layered-pet__layer,
  .layered-pet__layer--effect {
    animation: none;
  }
}
```

- [ ] **Step 5: Run renderer tests to verify they pass**

Run:

```bash
npm run test -- src/renderer/src/features/assistant/LayeredPetRenderer.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit renderer**

Run:

```bash
git add src/renderer/src/features/assistant/LayeredPetRenderer.tsx src/renderer/src/features/assistant/LayeredPetRenderer.test.tsx src/renderer/src/styles.css
git commit -m "feat: render layered 2d pet"
```

Expected: commit succeeds.

### Task 4: Integrate Renderer Into PalaceMaidPetApp

**Files:**
- Modify: `src/renderer/src/features/assistant/PalaceMaidPetApp.tsx`
- Modify: `src/renderer/src/features/assistant/PalaceMaidPetApp.test.tsx`
- Modify: `src/renderer/src/styles.css`

- [ ] **Step 1: Mock renderer in PalaceMaidPetApp tests**

At the top of `src/renderer/src/features/assistant/PalaceMaidPetApp.test.tsx`, before importing `PalaceMaidPetApp`, add:

```tsx
vi.mock('./LayeredPetRenderer', () => ({
  LayeredPetRenderer: ({
    petState,
    clickReactionSignal
  }: {
    petState: AssistantPetState
    clickReactionSignal: number
  }) => (
    <span
      data-testid="mock-layered-pet"
      data-pet-state={petState}
      data-click-reaction-signal={clickReactionSignal}
    />
  )
}))
```

Because the mock uses `AssistantPetState`, keep the existing `import type { AssistantPetState } from './petState'`.

- [ ] **Step 2: Add failing integration expectations**

In the first test, after `fireEvent.click(...)`, add:

```ts
expect(screen.getByTestId('mock-layered-pet')).toHaveAttribute(
  'data-click-reaction-signal',
  '1'
)
```

In the drag test, after `fireEvent.click(pet)`, add:

```ts
expect(screen.getByTestId('mock-layered-pet')).toHaveAttribute(
  'data-click-reaction-signal',
  '0'
)
```

In the state-change test, after the existing working state text expectations, add:

```ts
expect(screen.getByTestId('mock-layered-pet')).toHaveAttribute('data-pet-state', 'working')
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
npm run test -- src/renderer/src/features/assistant/PalaceMaidPetApp.test.tsx
```

Expected: FAIL because `LayeredPetRenderer` is not used and no click reaction signal exists.

- [ ] **Step 4: Integrate LayeredPetRenderer**

Modify `src/renderer/src/features/assistant/PalaceMaidPetApp.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { LayeredPetRenderer } from './LayeredPetRenderer'
import {
  createPetStateView,
  normalizePetState,
  type AssistantPetState
} from './petState'
```

Inside the component, after `const [petState, setPetState] = useState<AssistantPetState>('idle')`, add:

```tsx
const [clickReactionSignal, setClickReactionSignal] = useState(0)
```

Change `restoreMainWindow`:

```tsx
function restoreMainWindow() {
  setClickReactionSignal((signal) => signal + 1)
  setPetState('hint')
  void window.bilimiDesktop?.restoreMainWindowFromPet?.()
}
```

Replace the old CSS-only figure markup:

```tsx
<span className="palace-maid-pet__halo" aria-hidden="true" />
<span className="palace-maid-pet__figure" aria-hidden="true">
  <span className="palace-maid-pet__hair" />
  <span className="palace-maid-pet__face">
    <span className="palace-maid-pet__eye palace-maid-pet__eye--left" />
    <span className="palace-maid-pet__eye palace-maid-pet__eye--right" />
    <span className="palace-maid-pet__mouth" />
  </span>
  <span className="palace-maid-pet__robe" />
</span>
```

with:

```tsx
<span className="palace-maid-pet__halo" aria-hidden="true" />
<LayeredPetRenderer petState={petState} clickReactionSignal={clickReactionSignal} />
```

- [ ] **Step 5: Neutralize old CSS-only figure styles**

In `src/renderer/src/styles.css`, remove the old `.palace-maid-pet__figure`, `.palace-maid-pet__hair`, `.palace-maid-pet__face`, `.palace-maid-pet__eye`, `.palace-maid-pet__mouth`, and `.palace-maid-pet__robe` rules.

Update `.palace-maid-pet` to fit the larger 2D renderer:

```css
.palace-maid-pet {
  width: 104px;
  height: 104px;
  border-color: rgba(174, 207, 246, 0.54);
  background:
    radial-gradient(circle at 50% 30%, rgba(241, 248, 255, 0.9), rgba(241, 248, 255, 0) 46%),
    radial-gradient(circle at 48% 78%, rgba(74, 129, 204, 0.16), rgba(74, 129, 204, 0) 44%);
  color: #1f3d68;
  overflow: visible;
}
```

Keep `.palace-maid-pet__bubble` intact unless it overlaps the new character during manual verification.

- [ ] **Step 6: Run app integration tests**

Run:

```bash
npm run test -- src/renderer/src/features/assistant/PalaceMaidPetApp.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit integration**

Run:

```bash
git add src/renderer/src/features/assistant/PalaceMaidPetApp.tsx src/renderer/src/features/assistant/PalaceMaidPetApp.test.tsx src/renderer/src/styles.css
git commit -m "feat: integrate layered desktop pet"
```

Expected: commit succeeds.

### Task 5: Final Verification And Cleanup

**Files:**
- Modify only files needed to fix issues discovered by verification.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm run test -- src/renderer/src/features/assistant/layeredPetModel.test.ts src/renderer/src/features/assistant/LayeredPetRenderer.test.tsx src/renderer/src/features/assistant/PalaceMaidPetApp.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run:

```bash
npm run test
```

Expected: PASS.

- [ ] **Step 3: Run production build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Manual Electron verification**

Run:

```bash
npm run dev
```

Expected manual checks:

- Floating pet window is transparent and visible.
- Pet visual is a layered 2D blue-white chibi maid, not the old CSS-only body.
- `idle`, `hint`, `working`, and `error` can be triggered through existing app flows or renderer dev tools and look distinct.
- Click restores or focuses the main Bilimi window.
- Dragging the pet moves it and does not restore/focus the main window.
- Dragging does not play the click transient.
- Click transient plays briefly and returns to the latest persistent state.
- State bubble is readable and does not incoherently cover the face.

Stop the dev server after verification.

- [ ] **Step 5: Inspect git diff**

Run:

```bash
git status --short
git diff --stat
```

Expected: only intended layered pet files are changed. If previous task commits were made, `git status --short` should be clean.

- [ ] **Step 6: Final commit if changes remain**

If verification fixes created additional unstaged changes, run:

```bash
git add src/renderer/src/features/assistant src/renderer/src/assets/pet/blue-white-maid src/renderer/src/styles.css
git commit -m "fix: polish layered desktop pet"
```

Expected: commit succeeds if there were final verification fixes.

## Self-Review

Spec coverage:

- Technical choice is implemented by DOM/CSS layered PNG assets in Tasks 2 and 3.
- Resource organization is implemented by Task 2.
- Four persistent states are implemented by Task 1 and verified by Tasks 1, 3, and 5.
- Click transient is implemented by Tasks 3 and 4.
- Future Live2D/Spine boundary is represented by `PetRendererHandle` in Task 1 and renderer isolation in Task 3.
- Drag and click behavior preservation is implemented by Task 4 and verified by Task 5.
- No heavy dependency or prop-heavy behavior is added.

Placeholder scan:

- No open-ended implementation placeholders remain. The asset generation step is intentionally explicit about required files, dimensions, content, and restrictions because generated raster art cannot be represented as inline source code.

Type consistency:

- `PetTransient`, `PetEffect`, `PetMotion`, `PetLayerId`, and `AssistantPetState` names match across tasks.
- Renderer prop names are consistently `petState` and `clickReactionSignal`.
