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
  const effect = transient?.effect ?? view.effect

  if (layerId === 'character') {
    return blueWhiteMaidPetAssets.character[transient?.transient ?? view.state]
  }

  if (layerId === 'effect') {
    return effect === 'none' ? null : blueWhiteMaidPetAssets.effects[effect]
  }
  return null
}

function getLayerClassName(layerId: PetLayerId) {
  return `layered-pet__layer layered-pet__layer--${layerId}`
}

export function LayeredPetRenderer({ petState, clickReactionSignal }: LayeredPetRendererProps) {
  const [assetFailed, setAssetFailed] = useState(false)
  const [transientName, setTransientName] = useState<PetTransient | null>(null)
  const previousClickSignal = useRef(clickReactionSignal)
  const view = useMemo(() => createLayeredPetView(petState), [petState])
  const transient = transientName ? createLayeredPetTransientView(transientName) : null
  const activeMotion = transient?.motion ?? view.motion
  const activeEffect = transient?.effect ?? view.effect

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

        return (
          <img
            key={layer.id}
            src={source}
            className={getLayerClassName(layer.id)}
            data-testid={`layered-pet-${layer.id}`}
            data-layer={layer.id}
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
