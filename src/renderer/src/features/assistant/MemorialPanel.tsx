import type { AssistantAction, RecommendationLabel } from '@shared/types'

type MemorialPanelProps = {
  recommendation: RecommendationLabel
  commentDrafts: string[]
  onAction: (action: AssistantAction) => Promise<unknown>
  onClose: () => void
}

export function MemorialPanel({ recommendation, onAction, onClose }: MemorialPanelProps) {
  return (
    <section className="memorial-panel" aria-label="案头奏折">
      <div className="memorial-panel__paper">
        <div className="memorial-panel__header">
          <span>今日所陈</span>
          <h2>御前待阅折</h2>
          <span>司礼监掌印官谨呈</span>
        </div>
        <div className="memorial-panel__body">
          <aside className="memorial-panel__meta">
            <p>题名：早八生存实录</p>
            <p>类目：解闷小品</p>
            <p>签语：{recommendation.badge}</p>
          </aside>
          <div className="memorial-panel__copy">
            <p>{recommendation.summary}</p>
            <p>臣谨以此条进呈陛下，若准其留档，臣便代行轻赏。</p>
          </div>
          <aside className="memorial-panel__verdict">
            <h3>朱批</h3>
            <p>此物可先过目，不必骤然重赐。</p>
          </aside>
          <div className="memorial-panel__actions">
            {(['赏', '赐', '表', '阅'] as const).map((action) => (
              <button key={action} type="button" onClick={() => void onAction(action)}>
                {action}
              </button>
            ))}
          </div>
        </div>
        <button className="memorial-panel__close" type="button" onClick={onClose}>
          合折
        </button>
      </div>
    </section>
  )
}
