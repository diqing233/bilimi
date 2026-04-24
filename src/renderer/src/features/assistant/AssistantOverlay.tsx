import { useMemo, useState } from 'react'
import { executeAssistantAction } from '../actions/actionExecutor'
import { composeMemorialComments } from '../comments/commentComposer'
import { describeRecommendation } from '../recommendation/recommendationRules'
import { MemorialPanel } from './MemorialPanel'
import { SealButton } from './SealButton'

const CURRENT_KIND = 'funny' as const
const CURRENT_TITLE = '早八生存实录'

export function AssistantOverlay() {
  const [open, setOpen] = useState(false)
  const recommendation = useMemo(() => describeRecommendation(CURRENT_KIND), [])
  const commentDrafts = useMemo(() => composeMemorialComments(CURRENT_KIND, CURRENT_TITLE), [])

  return (
    <div className="assistant-overlay">
      {open ? (
        <MemorialPanel
          recommendation={recommendation}
          commentDrafts={commentDrafts}
          onAction={async (action) =>
            executeAssistantAction({
              action,
              favoritesFolderName: 'Bilimi 内库',
              runScript: async () => ({ ok: true, steps: [] })
            })
          }
          onClose={() => setOpen(false)}
        />
      ) : (
        <SealButton onOpen={() => setOpen(true)} />
      )}
    </div>
  )
}
