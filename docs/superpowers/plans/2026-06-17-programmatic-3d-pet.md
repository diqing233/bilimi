# Programmatic 3D Pet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the CSS palace-maid pet body with a lightweight Three.js blue-white porcelain tea-attendant 3D pet that expresses idle, hint, working, error, and click-reaction states without prop-heavy objects.

**Implementation status:** Planned only. As of 2026-06-17, `PalaceMaidPetApp` still uses the CSS-rendered palace-maid pet and `three` is not installed in `package.json`. Do not treat this document as implemented behavior until the tasks below have been executed and verified.

**Architecture:** Keep `PalaceMaidPetApp` responsible for desktop bridge behavior, drag suppression, click-to-restore, and the state bubble. Add a small isolated Three.js rendering layer under `src/renderer/src/features/assistant/` with pure animation configuration, a programmatic model factory, and a React canvas wrapper. Tests avoid requiring real WebGL by unit-testing animation/model contracts and using an injectable renderer factory in the React wrapper.

**Tech Stack:** Electron 35, React 19, TypeScript, Three.js, Vitest, Testing Library, existing Electron preload bridge.

---

## File Structure

- Modify: `package.json`
  - Add runtime dependency `three`.
- Modify: `package-lock.json`
  - Lock the installed `three` version.
- Create: `src/renderer/src/features/assistant/petAnimation.ts`
  - Pure state-to-expression and state-to-motion configuration.
  - Exposes `createPetPose`, `createClickReactionPose`, and numeric interpolation helpers.
- Create: `src/renderer/src/features/assistant/petAnimation.test.ts`
  - Verifies the five high-value behaviors: idle, hint, working, error, clicked.
- Create: `src/renderer/src/features/assistant/petModel.ts`
  - Builds the programmatic blue-white porcelain tea-attendant model from Three.js primitives.
  - Exposes named parts for animation and a resource disposal helper.
- Create: `src/renderer/src/features/assistant/petModel.test.ts`
  - Verifies the model exposes expected named parts and disposes geometries/materials.
- Create: `src/renderer/src/features/assistant/ThreePetCanvas.tsx`
  - React wrapper for the Three.js scene lifecycle, resize handling, animation loop, fallback, and cleanup.
- Create: `src/renderer/src/features/assistant/ThreePetCanvas.test.tsx`
  - Uses an injected renderer factory to verify mounting, state updates, click reactions, fallback, and cleanup without real WebGL.
- Modify: `src/renderer/src/features/assistant/PalaceMaidPetApp.tsx`
  - Replace CSS figure spans with `ThreePetCanvas`.
  - Trigger transient click reaction on non-drag click.
- Modify: `src/renderer/src/features/assistant/PalaceMaidPetApp.test.tsx`
  - Assert the 3D canvas mount exists, click reaction is requested, restore still works, and drag still suppresses click.
- Modify: `src/renderer/src/styles.css`
  - Remove CSS-only body-part styles from primary pet rendering.
  - Add canvas shell/fallback styles and blue-white visual framing.

---

### Task 1: Add Three.js Dependency

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Install Three.js**

Run:

```bash
npm install three
```

Expected:

```text
added 1 package
```

or npm reports the dependency is installed and updates `package-lock.json`.

- [ ] **Step 2: Confirm dependency is recorded**

Run:

```bash
node -e "const pkg=require('./package.json'); if (!pkg.dependencies.three) throw new Error('three missing'); console.log(pkg.dependencies.three)"
```

Expected:

```text
^0.x.x
```

where `0.x.x` is the installed Three.js version.

- [ ] **Step 3: Commit dependency update**

Run:

```bash
git add package.json package-lock.json
git commit -m "chore: add three for 3d pet"
```

Expected:

```text
[codex/... <hash>] chore: add three for 3d pet
```

---

### Task 2: Define Pet Animation Contract

**Files:**
- Create: `src/renderer/src/features/assistant/petAnimation.ts`
- Create: `src/renderer/src/features/assistant/petAnimation.test.ts`

- [ ] **Step 1: Write failing animation tests**

Create `src/renderer/src/features/assistant/petAnimation.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  createClickReactionPose,
  createPetPose,
  interpolateNumber,
  type PetExpressionName
} from './petAnimation'

describe('petAnimation', () => {
  it('maps persistent pet states to expression-first poses', () => {
    expect(createPetPose('idle')).toMatchObject({
      expression: 'daze',
      motion: 'breathing',
      stateLight: '#9fc8ff'
    })
    expect(createPetPose('hint')).toMatchObject({
      expression: 'happy',
      motion: 'wave',
      stateLight: '#ffd76a'
    })
    expect(createPetPose('working')).toMatchObject({
      expression: 'focused',
      motion: 'cheer',
      stateLight: '#77d7ff'
    })
    expect(createPetPose('error')).toMatchObject({
      expression: 'wronged',
      motion: 'lowered',
      stateLight: '#ff8c73'
    })
  })

  it('creates a transient shy click reaction without changing the persistent state', () => {
    expect(createClickReactionPose()).toMatchObject({
      expression: 'shy' satisfies PetExpressionName,
      motion: 'clicked',
      durationMs: 900
    })
  })

  it('interpolates numbers with a clamped progress value', () => {
    expect(interpolateNumber(10, 20, -1)).toBe(10)
    expect(interpolateNumber(10, 20, 0.25)).toBe(12.5)
    expect(interpolateNumber(10, 20, 2)).toBe(20)
  })
})
```

- [ ] **Step 2: Run the animation tests and confirm the missing module failure**

Run:

```bash
npm run test -- src/renderer/src/features/assistant/petAnimation.test.ts
```

Expected:

```text
FAIL  src/renderer/src/features/assistant/petAnimation.test.ts
Error: Failed to resolve import "./petAnimation"
```

- [ ] **Step 3: Add the animation contract**

Create `src/renderer/src/features/assistant/petAnimation.ts`:

```ts
import type { AssistantPetState } from './petState'

export type PetExpressionName = 'daze' | 'happy' | 'focused' | 'wronged' | 'shy'
export type PetMotionName = 'breathing' | 'wave' | 'cheer' | 'lowered' | 'clicked'

export type PetPose = {
  expression: PetExpressionName
  motion: PetMotionName
  headTilt: number
  bodyBounce: number
  armLift: number
  eyeOpen: number
  mouthSmile: number
  stateLight: string
  durationMs?: number
}

const STATE_POSES: Record<AssistantPetState, PetPose> = {
  idle: {
    expression: 'daze',
    motion: 'breathing',
    headTilt: 0.03,
    bodyBounce: 0.04,
    armLift: 0.05,
    eyeOpen: 0.92,
    mouthSmile: 0.34,
    stateLight: '#9fc8ff'
  },
  hint: {
    expression: 'happy',
    motion: 'wave',
    headTilt: -0.12,
    bodyBounce: 0.08,
    armLift: 0.62,
    eyeOpen: 0.62,
    mouthSmile: 0.92,
    stateLight: '#ffd76a'
  },
  working: {
    expression: 'focused',
    motion: 'cheer',
    headTilt: 0,
    bodyBounce: 0.12,
    armLift: 0.78,
    eyeOpen: 1,
    mouthSmile: 0.48,
    stateLight: '#77d7ff'
  },
  error: {
    expression: 'wronged',
    motion: 'lowered',
    headTilt: 0.18,
    bodyBounce: 0.01,
    armLift: 0,
    eyeOpen: 0.76,
    mouthSmile: -0.55,
    stateLight: '#ff8c73'
  }
}

export function createPetPose(state: AssistantPetState): PetPose {
  return { ...STATE_POSES[state] }
}

export function createClickReactionPose(): PetPose {
  return {
    expression: 'shy',
    motion: 'clicked',
    headTilt: -0.08,
    bodyBounce: 0.1,
    armLift: 0.34,
    eyeOpen: 0.58,
    mouthSmile: 0.84,
    stateLight: '#ff9fba',
    durationMs: 900
  }
}

export function interpolateNumber(start: number, end: number, progress: number) {
  const clampedProgress = Math.min(1, Math.max(0, progress))

  return start + (end - start) * clampedProgress
}
```

- [ ] **Step 4: Run animation tests and confirm pass**

Run:

```bash
npm run test -- src/renderer/src/features/assistant/petAnimation.test.ts
```

Expected:

```text
PASS  src/renderer/src/features/assistant/petAnimation.test.ts
```

- [ ] **Step 5: Commit animation contract**

Run:

```bash
git add src/renderer/src/features/assistant/petAnimation.ts src/renderer/src/features/assistant/petAnimation.test.ts
git commit -m "feat: define 3d pet animation states"
```

Expected:

```text
[codex/... <hash>] feat: define 3d pet animation states
```

---

### Task 3: Build Programmatic Blue-White Pet Model

**Files:**
- Create: `src/renderer/src/features/assistant/petModel.ts`
- Create: `src/renderer/src/features/assistant/petModel.test.ts`

- [ ] **Step 1: Write failing model tests**

Create `src/renderer/src/features/assistant/petModel.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import {
  createBlueWhitePetModel,
  disposePetModel,
  type DisposablePetModel
} from './petModel'

describe('petModel', () => {
  it('creates named parts for the blue-white porcelain pet silhouette', () => {
    const model = createBlueWhitePetModel()

    expect(model.root.name).toBe('bilimi-blue-white-pet')
    expect(model.parts.head.name).toBe('pet-head')
    expect(model.parts.leftBun.name).toBe('pet-left-bun')
    expect(model.parts.rightBun.name).toBe('pet-right-bun')
    expect(model.parts.ahoge.name).toBe('pet-ahoge')
    expect(model.parts.leftEye.name).toBe('pet-left-eye')
    expect(model.parts.rightEye.name).toBe('pet-right-eye')
    expect(model.parts.mouth.name).toBe('pet-mouth')
    expect(model.parts.leftArm.name).toBe('pet-left-arm')
    expect(model.parts.rightArm.name).toBe('pet-right-arm')
    expect(model.parts.stateLight.name).toBe('pet-state-light')
  })

  it('disposes tracked geometry and material resources', () => {
    const geometry = { dispose: vi.fn() }
    const material = { dispose: vi.fn() }
    const model = {
      disposables: [{ geometry, material }]
    } as unknown as DisposablePetModel

    disposePetModel(model)

    expect(geometry.dispose).toHaveBeenCalledOnce()
    expect(material.dispose).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run model tests and confirm the missing module failure**

Run:

```bash
npm run test -- src/renderer/src/features/assistant/petModel.test.ts
```

Expected:

```text
FAIL  src/renderer/src/features/assistant/petModel.test.ts
Error: Failed to resolve import "./petModel"
```

- [ ] **Step 3: Add the programmatic model factory**

Create `src/renderer/src/features/assistant/petModel.ts`:

```ts
import {
  AmbientLight,
  BoxGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PointLight,
  SphereGeometry,
  TorusGeometry,
  type Material,
  type Object3D
} from 'three'

type DisposableMesh = Mesh & {
  geometry: { dispose: () => void }
  material: Material | Material[]
}

export type PetModelParts = {
  root: Group
  head: Mesh
  leftBun: Mesh
  rightBun: Mesh
  ahoge: Mesh
  body: Mesh
  robeTrim: Mesh
  leftEye: Mesh
  rightEye: Mesh
  mouth: Mesh
  leftArm: Mesh
  rightArm: Mesh
  leftTassel: Mesh
  rightTassel: Mesh
  stateLight: PointLight
}

export type DisposablePetModel = {
  root: Group
  parts: PetModelParts
  disposables: DisposableMesh[]
}

function createTrackedMesh(
  name: string,
  geometry: DisposableMesh['geometry'],
  material: Material | Material[],
  disposables: DisposableMesh[]
) {
  const mesh = new Mesh(geometry, material) as DisposableMesh
  mesh.name = name
  disposables.push(mesh)

  return mesh
}

export function createBlueWhitePetModel(): DisposablePetModel {
  const disposables: DisposableMesh[] = []
  const root = new Group()
  root.name = 'bilimi-blue-white-pet'

  const skin = new MeshStandardMaterial({ color: '#ffd9c6', roughness: 0.62 })
  const hair = new MeshStandardMaterial({ color: '#bfe2ff', roughness: 0.48, metalness: 0.02 })
  const blue = new MeshStandardMaterial({ color: '#3778d5', roughness: 0.55 })
  const robe = new MeshStandardMaterial({ color: '#f6fbff', roughness: 0.72 })
  const eye = new MeshBasicMaterial({ color: '#49213e' })
  const mouthMaterial = new MeshBasicMaterial({ color: '#c64e5f' })
  const tassel = new MeshStandardMaterial({ color: '#2869c6', roughness: 0.6 })
  const trim = new MeshBasicMaterial({ color: '#6ea9ee' })

  const head = createTrackedMesh('pet-head', new SphereGeometry(0.78, 32, 24), skin, disposables)
  head.scale.set(1, 0.88, 0.84)
  head.position.set(0, 0.72, 0)
  root.add(head)

  const hairCap = createTrackedMesh('pet-hair-cap', new SphereGeometry(0.82, 32, 16), hair, disposables)
  hairCap.scale.set(1.04, 0.54, 0.86)
  hairCap.position.set(0, 0.98, -0.03)
  root.add(hairCap)

  const leftBun = createTrackedMesh('pet-left-bun', new SphereGeometry(0.3, 24, 16), hair, disposables)
  leftBun.position.set(-0.72, 0.94, 0.02)
  root.add(leftBun)

  const rightBun = createTrackedMesh('pet-right-bun', new SphereGeometry(0.3, 24, 16), hair, disposables)
  rightBun.position.set(0.72, 0.94, 0.02)
  root.add(rightBun)

  const ahoge = createTrackedMesh('pet-ahoge', new TorusGeometry(0.18, 0.025, 8, 24, Math.PI * 1.35), hair, disposables)
  ahoge.position.set(0.04, 1.55, 0.02)
  ahoge.rotation.set(0.2, 0.12, -0.45)
  root.add(ahoge)

  const body = createTrackedMesh('pet-body', new CapsuleGeometry(0.38, 0.74, 8, 18), robe, disposables)
  body.position.set(0, -0.2, 0)
  body.scale.set(1.02, 1, 0.72)
  root.add(body)

  const robeTrim = createTrackedMesh('pet-robe-trim', new BoxGeometry(0.78, 0.08, 0.04), trim, disposables)
  robeTrim.position.set(0, 0.12, 0.34)
  robeTrim.rotation.set(0, 0, -0.56)
  root.add(robeTrim)

  const leftEye = createTrackedMesh('pet-left-eye', new SphereGeometry(0.09, 16, 12), eye, disposables)
  leftEye.scale.set(0.72, 1.12, 0.2)
  leftEye.position.set(-0.24, 0.72, 0.66)
  root.add(leftEye)

  const rightEye = createTrackedMesh('pet-right-eye', new SphereGeometry(0.09, 16, 12), eye, disposables)
  rightEye.scale.set(0.72, 1.12, 0.2)
  rightEye.position.set(0.24, 0.72, 0.66)
  root.add(rightEye)

  const mouth = createTrackedMesh('pet-mouth', new SphereGeometry(0.07, 16, 8), mouthMaterial, disposables)
  mouth.scale.set(1.28, 0.48, 0.16)
  mouth.position.set(0, 0.47, 0.7)
  root.add(mouth)

  const leftArm = createTrackedMesh('pet-left-arm', new CapsuleGeometry(0.08, 0.42, 6, 10), robe, disposables)
  leftArm.position.set(-0.43, -0.06, 0.16)
  leftArm.rotation.set(0.1, 0, 0.7)
  root.add(leftArm)

  const rightArm = createTrackedMesh('pet-right-arm', new CapsuleGeometry(0.08, 0.42, 6, 10), robe, disposables)
  rightArm.position.set(0.43, -0.06, 0.16)
  rightArm.rotation.set(0.1, 0, -0.7)
  root.add(rightArm)

  const leftTassel = createTrackedMesh('pet-left-tassel', new ConeGeometry(0.06, 0.32, 10), tassel, disposables)
  leftTassel.position.set(-0.58, 0.4, 0.12)
  root.add(leftTassel)

  const rightTassel = createTrackedMesh('pet-right-tassel', new ConeGeometry(0.06, 0.32, 10), tassel, disposables)
  rightTassel.position.set(0.58, 0.4, 0.12)
  root.add(rightTassel)

  const hairFlower = createTrackedMesh('pet-hair-flower', new SphereGeometry(0.09, 12, 8), blue, disposables)
  hairFlower.position.set(0.54, 1.12, 0.24)
  root.add(hairFlower)

  const stateLight = new PointLight(new Color('#9fc8ff'), 1.4, 4)
  stateLight.name = 'pet-state-light'
  stateLight.position.set(0, 1.4, 1.5)
  root.add(stateLight)
  root.add(new AmbientLight('#dbefff', 1.7))

  return {
    root,
    parts: {
      root,
      head,
      leftBun,
      rightBun,
      ahoge,
      body,
      robeTrim,
      leftEye,
      rightEye,
      mouth,
      leftArm,
      rightArm,
      leftTassel,
      rightTassel,
      stateLight
    },
    disposables
  }
}

export function disposePetModel(model: Pick<DisposablePetModel, 'disposables'>) {
  for (const mesh of model.disposables) {
    mesh.geometry.dispose()
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]

    for (const material of materials) {
      material.dispose()
    }
  }
}

export function removePetModelFromParent(root: Object3D) {
  root.parent?.remove(root)
}
```

- [ ] **Step 4: Run model tests and confirm pass**

Run:

```bash
npm run test -- src/renderer/src/features/assistant/petModel.test.ts
```

Expected:

```text
PASS  src/renderer/src/features/assistant/petModel.test.ts
```

- [ ] **Step 5: Commit model factory**

Run:

```bash
git add src/renderer/src/features/assistant/petModel.ts src/renderer/src/features/assistant/petModel.test.ts
git commit -m "feat: build programmatic 3d pet model"
```

Expected:

```text
[codex/... <hash>] feat: build programmatic 3d pet model
```

---

### Task 4: Add ThreePetCanvas Lifecycle Wrapper

**Files:**
- Create: `src/renderer/src/features/assistant/ThreePetCanvas.tsx`
- Create: `src/renderer/src/features/assistant/ThreePetCanvas.test.tsx`

- [ ] **Step 1: Write failing canvas wrapper tests**

Create `src/renderer/src/features/assistant/ThreePetCanvas.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThreePetCanvas, type PetSceneController } from './ThreePetCanvas'

function createController(): PetSceneController {
  return {
    dispose: vi.fn(),
    mount: vi.fn((element: HTMLElement) => {
      const canvas = document.createElement('canvas')
      canvas.setAttribute('data-testid', 'mock-three-canvas')
      element.append(canvas)
    }),
    playClickReaction: vi.fn(),
    setState: vi.fn()
  }
}

describe('ThreePetCanvas', () => {
  it('mounts the scene and applies the current state', () => {
    const controller = createController()
    const createScene = vi.fn(() => controller)

    render(<ThreePetCanvas petState="working" createScene={createScene} />)

    expect(screen.getByTestId('three-pet-mount')).toContainElement(
      screen.getByTestId('mock-three-canvas')
    )
    expect(createScene).toHaveBeenCalledOnce()
    expect(controller.mount).toHaveBeenCalledOnce()
    expect(controller.setState).toHaveBeenCalledWith('working')
  })

  it('updates state without rebuilding the scene', () => {
    const controller = createController()
    const createScene = vi.fn(() => controller)
    const { rerender } = render(<ThreePetCanvas petState="idle" createScene={createScene} />)

    rerender(<ThreePetCanvas petState="error" createScene={createScene} />)

    expect(createScene).toHaveBeenCalledOnce()
    expect(controller.setState).toHaveBeenLastCalledWith('error')
  })

  it('plays click reaction when the signal changes', () => {
    const controller = createController()
    const createScene = vi.fn(() => controller)
    const { rerender } = render(
      <ThreePetCanvas petState="idle" clickReactionSignal={0} createScene={createScene} />
    )

    rerender(<ThreePetCanvas petState="idle" clickReactionSignal={1} createScene={createScene} />)

    expect(controller.playClickReaction).toHaveBeenCalledOnce()
  })

  it('shows a fallback when scene creation fails', () => {
    render(
      <ThreePetCanvas
        petState="idle"
        createScene={() => {
          throw new Error('webgl unavailable')
        }}
      />
    )

    expect(screen.getByText('3D')).toBeInTheDocument()
  })

  it('disposes the scene on unmount', () => {
    const controller = createController()
    const { unmount } = render(
      <ThreePetCanvas petState="idle" createScene={() => controller} />
    )

    unmount()

    expect(controller.dispose).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run canvas wrapper tests and confirm the missing module failure**

Run:

```bash
npm run test -- src/renderer/src/features/assistant/ThreePetCanvas.test.tsx
```

Expected:

```text
FAIL  src/renderer/src/features/assistant/ThreePetCanvas.test.tsx
Error: Failed to resolve import "./ThreePetCanvas"
```

- [ ] **Step 3: Add ThreePetCanvas and default scene controller**

Create `src/renderer/src/features/assistant/ThreePetCanvas.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import {
  Color,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
  type WebGLRendererParameters
} from 'three'
import { createClickReactionPose, createPetPose, type PetPose } from './petAnimation'
import { createBlueWhitePetModel, disposePetModel, type DisposablePetModel } from './petModel'
import type { AssistantPetState } from './petState'

export type PetSceneController = {
  mount: (element: HTMLElement) => void
  setState: (state: AssistantPetState) => void
  playClickReaction: () => void
  dispose: () => void
}

type ThreePetCanvasProps = {
  petState: AssistantPetState
  clickReactionSignal?: number
  createScene?: () => PetSceneController
}

function applyPose(model: DisposablePetModel, pose: PetPose, time = 0) {
  const wave = Math.sin(time * 0.004)
  const bounce = Math.sin(time * 0.006) * pose.bodyBounce

  model.root.position.y = bounce
  model.parts.head.rotation.z = pose.headTilt + wave * 0.025
  model.parts.ahoge.rotation.z = -0.45 + wave * 0.08
  model.parts.leftTassel.rotation.z = wave * 0.14
  model.parts.rightTassel.rotation.z = -wave * 0.14
  model.parts.leftEye.scale.y = Math.max(0.18, pose.eyeOpen)
  model.parts.rightEye.scale.y = Math.max(0.18, pose.eyeOpen)
  model.parts.mouth.scale.y = Math.max(0.18, 0.48 + pose.mouthSmile * 0.3)
  model.parts.leftArm.rotation.z = 0.7 - pose.armLift * 0.9
  model.parts.rightArm.rotation.z = -0.7 + pose.armLift * 0.9
  model.parts.stateLight.color = new Color(pose.stateLight)
}

export function createThreePetScene(
  rendererParameters: WebGLRendererParameters = { alpha: true, antialias: true }
): PetSceneController {
  const scene = new Scene()
  const camera = new PerspectiveCamera(32, 1, 0.1, 100)
  camera.position.set(0, 0.48, 5.2)
  camera.lookAt(0, 0.48, 0)

  const renderer = new WebGLRenderer(rendererParameters)
  renderer.setClearColor(0x000000, 0)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))

  const model = createBlueWhitePetModel()
  scene.add(model.root)

  let animationFrame = 0
  let mountedElement: HTMLElement | null = null
  let currentPose = createPetPose('idle')
  let clickPoseUntil = 0

  function resize() {
    if (!mountedElement) {
      return
    }

    const size = Math.max(1, Math.min(mountedElement.clientWidth, mountedElement.clientHeight))
    camera.aspect = 1
    camera.updateProjectionMatrix()
    renderer.setSize(size, size, false)
  }

  function renderFrame(time: number) {
    const activePose = clickPoseUntil > time ? createClickReactionPose() : currentPose
    applyPose(model, activePose, time)
    renderer.render(scene, camera)
    animationFrame = window.requestAnimationFrame(renderFrame)
  }

  return {
    mount(element) {
      mountedElement = element
      element.append(renderer.domElement)
      resize()
      window.addEventListener('resize', resize)
      animationFrame = window.requestAnimationFrame(renderFrame)
    },
    setState(state) {
      currentPose = createPetPose(state)
    },
    playClickReaction() {
      clickPoseUntil = performance.now() + (createClickReactionPose().durationMs ?? 900)
    },
    dispose() {
      window.cancelAnimationFrame(animationFrame)
      window.removeEventListener('resize', resize)
      renderer.domElement.remove()
      disposePetModel(model)
      renderer.dispose()
      mountedElement = null
    }
  }
}

export function ThreePetCanvas({
  petState,
  clickReactionSignal = 0,
  createScene = createThreePetScene
}: ThreePetCanvasProps) {
  const mountRef = useRef<HTMLSpanElement | null>(null)
  const controllerRef = useRef<PetSceneController | null>(null)
  const previousClickReactionSignal = useRef(clickReactionSignal)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const mount = mountRef.current

    if (!mount) {
      return
    }

    try {
      const controller = createScene()
      controllerRef.current = controller
      controller.mount(mount)
      controller.setState(petState)

      return () => {
        controller.dispose()
        controllerRef.current = null
      }
    } catch {
      setFailed(true)
      return
    }
  }, [createScene])

  useEffect(() => {
    controllerRef.current?.setState(petState)
  }, [petState])

  useEffect(() => {
    if (clickReactionSignal !== previousClickReactionSignal.current) {
      previousClickReactionSignal.current = clickReactionSignal
      controllerRef.current?.playClickReaction()
    }
  }, [clickReactionSignal])

  return (
    <span className="three-pet-canvas" data-failed={failed ? 'true' : 'false'}>
      <span ref={mountRef} className="three-pet-canvas__mount" data-testid="three-pet-mount" />
      {failed ? <span className="three-pet-canvas__fallback">3D</span> : null}
    </span>
  )
}
```

- [ ] **Step 4: Run canvas wrapper tests and confirm pass**

Run:

```bash
npm run test -- src/renderer/src/features/assistant/ThreePetCanvas.test.tsx
```

Expected:

```text
PASS  src/renderer/src/features/assistant/ThreePetCanvas.test.tsx
```

- [ ] **Step 5: Commit canvas wrapper**

Run:

```bash
git add src/renderer/src/features/assistant/ThreePetCanvas.tsx src/renderer/src/features/assistant/ThreePetCanvas.test.tsx
git commit -m "feat: add 3d pet canvas lifecycle"
```

Expected:

```text
[codex/... <hash>] feat: add 3d pet canvas lifecycle
```

---

### Task 5: Integrate 3D Canvas Into PalaceMaidPetApp

**Files:**
- Modify: `src/renderer/src/features/assistant/PalaceMaidPetApp.tsx`
- Modify: `src/renderer/src/features/assistant/PalaceMaidPetApp.test.tsx`

- [ ] **Step 1: Mock ThreePetCanvas in the pet app test**

At the top of `src/renderer/src/features/assistant/PalaceMaidPetApp.test.tsx`, before importing `PalaceMaidPetApp`, add:

```tsx
vi.mock('./ThreePetCanvas', () => ({
  ThreePetCanvas: ({
    clickReactionSignal,
    petState
  }: {
    clickReactionSignal?: number
    petState: string
  }) => (
    <span
      data-testid="three-pet-canvas"
      data-click-reaction-signal={String(clickReactionSignal ?? 0)}
      data-pet-state={petState}
    />
  )
}))
```

Then add this test:

```tsx
  it('renders the 3D pet canvas and triggers a click reaction on non-drag click', () => {
    installDesktopApi()

    render(<PalaceMaidPetApp />)

    const pet = screen.getByRole('button', { name: '鎵撳紑 Bilimi' })

    expect(screen.getByTestId('three-pet-canvas')).toHaveAttribute('data-pet-state', 'idle')
    expect(screen.getByTestId('three-pet-canvas')).toHaveAttribute(
      'data-click-reaction-signal',
      '0'
    )

    fireEvent.click(pet)

    expect(screen.getByTestId('three-pet-canvas')).toHaveAttribute(
      'data-click-reaction-signal',
      '1'
    )
  })
```

- [ ] **Step 2: Run the pet app test and confirm failure**

Run:

```bash
npm run test -- src/renderer/src/features/assistant/PalaceMaidPetApp.test.tsx
```

Expected:

```text
FAIL  src/renderer/src/features/assistant/PalaceMaidPetApp.test.tsx
Unable to find an element by: [data-testid="three-pet-canvas"]
```

- [ ] **Step 3: Replace CSS body parts with ThreePetCanvas**

Modify `src/renderer/src/features/assistant/PalaceMaidPetApp.tsx`.

Add the import:

```ts
import { ThreePetCanvas } from './ThreePetCanvas'
```

Add click reaction state near the existing `petState` state:

```ts
  const [clickReactionSignal, setClickReactionSignal] = useState(0)
```

Update `restoreMainWindow`:

```ts
  function restoreMainWindow() {
    setPetState('hint')
    setClickReactionSignal((signal) => signal + 1)
    void window.bilimiDesktop?.restoreMainWindowFromPet?.()
  }
```

Replace the existing CSS figure block:

```tsx
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
        <ThreePetCanvas petState={stateView.state} clickReactionSignal={clickReactionSignal} />
```

- [ ] **Step 4: Run the pet app tests and confirm pass**

Run:

```bash
npm run test -- src/renderer/src/features/assistant/PalaceMaidPetApp.test.tsx
```

Expected:

```text
PASS  src/renderer/src/features/assistant/PalaceMaidPetApp.test.tsx
```

- [ ] **Step 5: Commit app integration**

Run:

```bash
git add src/renderer/src/features/assistant/PalaceMaidPetApp.tsx src/renderer/src/features/assistant/PalaceMaidPetApp.test.tsx
git commit -m "feat: render 3d pet in floating window"
```

Expected:

```text
[codex/... <hash>] feat: render 3d pet in floating window
```

---

### Task 6: Update Pet Window Styles

**Files:**
- Modify: `src/renderer/src/styles.css`

- [ ] **Step 1: Add style regression checks by selector search**

Run:

```bash
rg "palace-maid-pet__figure|palace-maid-pet__hair|palace-maid-pet__face|palace-maid-pet__robe|three-pet-canvas" src/renderer/src/styles.css
```

Expected before implementation:

```text
matches for palace-maid-pet__figure, palace-maid-pet__hair, palace-maid-pet__face, palace-maid-pet__robe
no matches for three-pet-canvas
```

- [ ] **Step 2: Replace CSS-only body-part styles with canvas styles**

Modify `src/renderer/src/styles.css`.

Keep the shell, button, halo, and bubble styles. Remove the CSS-only body-part blocks:

```css
.palace-maid-pet__figure { ... }
.palace-maid-pet__hair { ... }
.palace-maid-pet__hair::before,
.palace-maid-pet__hair::after { ... }
.palace-maid-pet__hair::before { ... }
.palace-maid-pet__hair::after { ... }
.palace-maid-pet__face { ... }
.palace-maid-pet__eye { ... }
.palace-maid-pet__eye--left { ... }
.palace-maid-pet__eye--right { ... }
.palace-maid-pet__mouth { ... }
.palace-maid-pet__robe { ... }
```

Then add:

```css
.three-pet-canvas {
  position: relative;
  z-index: 1;
  width: 86px;
  height: 86px;
  display: grid;
  place-items: center;
  pointer-events: none;
}

.three-pet-canvas__mount,
.three-pet-canvas__mount canvas {
  width: 86px;
  height: 86px;
  display: block;
}

.three-pet-canvas__fallback {
  position: absolute;
  inset: 18px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background:
    radial-gradient(circle at 42% 28%, rgba(255, 255, 255, 0.82), rgba(255, 255, 255, 0) 34%),
    linear-gradient(145deg, #d9efff, #6ea9ee);
  color: #1d4f9a;
  font-size: 15px;
  font-weight: 800;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6);
}
```

Also update `.palace-maid-pet` colors to the blue-white porcelain direction:

```css
  border-color: rgba(191, 226, 255, 0.72);
  background:
    radial-gradient(circle at 50% 22%, rgba(255, 255, 255, 0.95), rgba(255, 255, 255, 0) 24%),
    linear-gradient(160deg, #f7fcff 0%, #c9e7ff 46%, #5b95da 100%);
  color: #173f78;
```

- [ ] **Step 3: Verify old body-part selectors are gone and canvas selectors exist**

Run:

```bash
rg "palace-maid-pet__figure|palace-maid-pet__hair|palace-maid-pet__face|palace-maid-pet__robe" src/renderer/src/styles.css; if ($LASTEXITCODE -eq 0) { exit 1 } else { exit 0 }
rg "three-pet-canvas" src/renderer/src/styles.css
```

Expected:

```text
first command exits 0 after the PowerShell condition converts no matches into success
second command prints the new three-pet-canvas selectors
```

- [ ] **Step 4: Run CSS-adjacent component tests**

Run:

```bash
npm run test -- src/renderer/src/features/assistant/PalaceMaidPetApp.test.tsx src/renderer/src/features/assistant/ThreePetCanvas.test.tsx
```

Expected:

```text
PASS  src/renderer/src/features/assistant/PalaceMaidPetApp.test.tsx
PASS  src/renderer/src/features/assistant/ThreePetCanvas.test.tsx
```

- [ ] **Step 5: Commit style update**

Run:

```bash
git add src/renderer/src/styles.css
git commit -m "style: update pet window for 3d canvas"
```

Expected:

```text
[codex/... <hash>] style: update pet window for 3d canvas
```

---

### Task 7: Focused And Full Verification

**Files:**
- Verify all files changed by Tasks 1-6.

- [ ] **Step 1: Run all focused 3D pet tests**

Run:

```bash
npm run test -- src/renderer/src/features/assistant/petAnimation.test.ts src/renderer/src/features/assistant/petModel.test.ts src/renderer/src/features/assistant/ThreePetCanvas.test.tsx src/renderer/src/features/assistant/PalaceMaidPetApp.test.tsx
```

Expected:

```text
PASS  src/renderer/src/features/assistant/petAnimation.test.ts
PASS  src/renderer/src/features/assistant/petModel.test.ts
PASS  src/renderer/src/features/assistant/ThreePetCanvas.test.tsx
PASS  src/renderer/src/features/assistant/PalaceMaidPetApp.test.tsx
```

- [ ] **Step 2: Run the full test suite**

Run:

```bash
npm run test
```

Expected:

```text
Test Files: all pass
Tests: all pass
```

- [ ] **Step 3: Run the production build**

Run:

```bash
npm run build
```

Expected:

```text
electron-vite build completes successfully
```

- [ ] **Step 4: Check whitespace-sensitive diff issues**

Run:

```bash
git diff --check
```

Expected:

```text
exit code 0 with no output
```

- [ ] **Step 5: Manually verify the Electron pet window**

Run:

```bash
npm run dev
```

Verify on Windows:

1. The floating pet window appears with a visible blue-white 3D chibi character.
2. The pet has pale blue hair, twin buns, ahoge, blue-white robe, and small tassel/ribbon hints.
3. The pet does not show a tray, teapot, teacups, book, broom, pillow, flowerpot, or other prop-heavy objects.
4. `idle` shows calm breathing and subtle hair/tassel motion.
5. `hint` shows a happy or attentive expression and brighter state light.
6. `working` shows a focused or cheering expression with more active bounce/arm motion.
7. `error` shows a wronged or lowered expression with amber/red state light.
8. Clicking without dragging triggers a short shy/delighted reaction and restores/focuses the main window.
9. Dragging still moves the pet and suppresses the restore click.
10. The state bubble remains readable and does not overlap the 3D body incoherently.

- [ ] **Step 6: Inspect final git status**

Run:

```bash
git status --short
```

Expected:

```text
No 3D pet implementation files remain unstaged or uncommitted.
Unrelated pre-existing user changes may still appear and must not be reverted.
```

---

## Self-Review Notes

### Spec Coverage

1. Real Three.js canvas and non-CSS primary body: Tasks 1, 3, 4, 5, and 6.
2. Blue-white porcelain tea-attendant shape: Task 3 model parts and Task 6 styles.
3. No tray/tea props in first version: Task 3 model omits prop objects; Task 7 manual verification checks this explicitly.
4. Existing persisted states `idle`, `hint`, `working`, and `error`: Task 2 animation contract and Task 4 state application.
5. Transient click reaction: Task 2, Task 4, and Task 5.
6. Drag and click-to-restore remain in `PalaceMaidPetApp`: Task 5 keeps existing behavior and extends tests.
7. Renderer cleanup and fallback: Task 4 lifecycle wrapper tests.
8. Future GLB/VRM path: the model factory boundary in Task 3 and scene controller boundary in Task 4 keep model construction isolated.

### Placeholder Scan

The plan avoids unresolved placeholders. Each task names exact files, includes code for new files or exact edit targets, and includes commands with expected results.

### Type Consistency

`AssistantPetState` remains the persisted state contract. `PetPose`, `PetExpressionName`, and `PetMotionName` are internal rendering concepts. The transient click reaction is a signal passed to `ThreePetCanvas`, not a new persisted desktop state.
