import { useState } from 'react'
import type { VideoNote } from '@shared/types'

type VideoNotesPanelProps = {
  note: VideoNote | null
  isLoading: boolean
  onGenerate: (manualTranscript?: string) => Promise<VideoNote | null>
  onSave: (note: VideoNote) => Promise<void>
}

type VideoNotesTab = 'overview' | 'transcript' | 'archive'

const tabs: Array<{ id: VideoNotesTab; label: string }> = [
  { id: 'overview', label: '速览' },
  { id: 'transcript', label: '文稿' },
  { id: 'archive', label: '归档' }
]

function formatTimestamp(seconds: number | null): string {
  if (seconds === null) {
    return '--:--'
  }

  const normalizedSeconds = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(normalizedSeconds / 60)
  const remainder = normalizedSeconds % 60

  return `${minutes.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}`
}

export function VideoNotesPanel({
  note,
  isLoading,
  onGenerate,
  onSave
}: VideoNotesPanelProps): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<VideoNotesTab>('overview')
  const [manualTranscript, setManualTranscript] = useState('')
  const [saveMessage, setSaveMessage] = useState('')

  async function handleGenerate(manualText?: string): Promise<void> {
    setSaveMessage('')
    await onGenerate(manualText)
  }

  async function handleSave(): Promise<void> {
    if (!note) {
      return
    }

    await onSave(note)
    setSaveMessage('札记已保存')
  }

  if (!note) {
    return (
      <section aria-label="视频札记">
        <button type="button" disabled={isLoading} onClick={() => void handleGenerate(undefined)}>
          {isLoading ? '整理中...' : '整理札记'}
        </button>

        <div>
          <label htmlFor="manual-transcript">粘贴文稿</label>
          <textarea
            id="manual-transcript"
            value={manualTranscript}
            onChange={(event) => setManualTranscript(event.target.value)}
          />
        </div>

        <button
          type="button"
          disabled={isLoading || manualTranscript.trim().length === 0}
          onClick={() => void handleGenerate(manualTranscript)}
        >
          整理粘贴文稿
        </button>
      </section>
    )
  }

  return (
    <section aria-label="视频札记">
      <div role="tablist" aria-label="札记页签">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`video-notes-${tab.id}`}
            id={`video-notes-tab-${tab.id}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div
          role="tabpanel"
          id="video-notes-overview"
          aria-labelledby="video-notes-tab-overview"
        >
          <section aria-label="速览摘要">
            {note.overview.shortSummary.map((summary) => (
              <p key={summary}>{summary}</p>
            ))}
          </section>

          <ol aria-label="时间线重点">
            {note.overview.timeline.map((item, index) => (
              <li key={`${item.title}-${index}`}>
                <time>{formatTimestamp(item.start)}</time>
                <strong>{item.title}</strong>
                <p>{item.detail}</p>
              </li>
            ))}
          </ol>
        </div>
      )}

      {activeTab === 'transcript' && (
        <div
          role="tabpanel"
          id="video-notes-transcript"
          aria-labelledby="video-notes-tab-transcript"
        >
          <ol aria-label="转写文稿">
            {note.transcript.map((segment, index) => (
              <li key={`${segment.start ?? 'unknown'}-${index}`}>
                <time>{formatTimestamp(segment.start)}</time>
                <p>{segment.text}</p>
              </li>
            ))}
          </ol>
        </div>
      )}

      {activeTab === 'archive' && (
        <div
          role="tabpanel"
          id="video-notes-archive"
          aria-labelledby="video-notes-tab-archive"
        >
          <dl>
            <dt>标题</dt>
            <dd>{note.source.title}</dd>
            <dt>作者</dt>
            <dd>{note.source.author ?? '未署名'}</dd>
            <dt>BV号</dt>
            <dd>{note.source.bvid ?? '未识别'}</dd>
            <dt>链接</dt>
            <dd>{note.source.url}</dd>
          </dl>

          <button type="button" onClick={() => void handleSave()}>
            保存札记
          </button>

          {saveMessage && <p role="status">{saveMessage}</p>}
        </div>
      )}
    </section>
  )
}
