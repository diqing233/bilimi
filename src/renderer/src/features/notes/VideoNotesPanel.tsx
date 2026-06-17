import { useLayoutEffect, useMemo, useState } from 'react'
import type { VideoAudioTranscriptionProgress, VideoNote, VideoNoteAnnotation } from '@shared/types'
import { createPlainTranscriptText, createSummaryText } from '@shared/videoNoteArchive'
import { createVideoNoteMarkdown } from './videoNoteMarkdown'
import {
  removeVideoNoteAnnotation,
  saveVideoNoteAnnotation,
  sortVideoNoteAnnotations
} from './videoNoteAnnotations'

type VideoNotesPanelProps = {
  note: VideoNote | null
  isLoading: boolean
  onGenerate: (manualTranscript?: string) => Promise<VideoNote | null>
  onSave: (note: VideoNote) => Promise<void>
  onChange?: (note: VideoNote) => void
  onGetCurrentTime?: () => Promise<number>
  onSeekToTime?: (seconds: number) => Promise<boolean>
  onTranscribeAudio?: () => Promise<VideoNote | null>
  onOpenArchive?: () => void
  transcriptionProgress?: VideoAudioTranscriptionProgress | null
}

type VideoNotesResultTab = 'plain' | 'timed' | 'summary'

const resultTabs: Array<{ id: VideoNotesResultTab; label: string; description: string }> = [
  { id: 'plain', label: '无时间线文稿', description: '纯文稿连续阅读，提供复制全文。' },
  { id: 'timed', label: '带时间线文稿', description: '按时间段阅读，可跳回视频、可加批注。' },
  { id: 'summary', label: '一图流总结', description: '结构化摘要，支持复制。' }
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

function createAnnotationTitle(value: string): string {
  return value
    .replace(/^(先|再|然后|接着|最后)?(介绍|说明|讲解|解释|总结)/, '')
    .replace(/[。！？!?.,，、；;：:]+$/g, '')
    .trim()
    .slice(0, 18)
}

export function VideoNotesPanel({
  note,
  isLoading,
  onGenerate,
  onSave,
  onChange,
  onGetCurrentTime,
  onSeekToTime,
  onTranscribeAudio,
  onOpenArchive,
  transcriptionProgress = null
}: VideoNotesPanelProps): React.JSX.Element {
  const [activeResultTab, setActiveResultTab] = useState<VideoNotesResultTab>('plain')
  const [manualTranscript, setManualTranscript] = useState('')
  const [localGenerating, setLocalGenerating] = useState(false)
  const [transcribingAudio, setTranscribingAudio] = useState(false)
  const [generateFailed, setGenerateFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [memoDraft, setMemoDraft] = useState(note?.userMemo ?? '')
  const [annotationId, setAnnotationId] = useState<string | null>(null)
  const [annotationStart, setAnnotationStart] = useState<number | null>(null)
  const [annotationTitle, setAnnotationTitle] = useState('')
  const [annotationBody, setAnnotationBody] = useState('')
  const generationBusy = isLoading || localGenerating || transcribingAudio
  const markdown = useMemo(() => (note ? createVideoNoteMarkdown(note) : ''), [note])
  const plainTranscript = useMemo(() => (note ? createPlainTranscriptText(note) : ''), [note])
  const summaryText = useMemo(() => (note ? createSummaryText(note) : ''), [note])
  const sortedAnnotations = useMemo(
    () => sortVideoNoteAnnotations(note?.annotations ?? []),
    [note?.annotations]
  )

  useLayoutEffect(() => {
    setMemoDraft(note?.userMemo ?? '')
  }, [note?.id, note?.userMemo])

  async function handleGenerate(manualText?: string): Promise<void> {
    if (generationBusy) {
      return
    }

    if (!manualText?.trim() && onTranscribeAudio) {
      await handleTranscribeAudio()
      return
    }

    setLocalGenerating(true)
    setGenerateFailed(false)
    setStatusMessage('')
    setErrorMessage('')

    try {
      const generatedNote = await onGenerate(manualText)

      if (generatedNote) {
        setStatusMessage('札记已整理')
      }
    } catch (error) {
      setGenerateFailed(true)
      setErrorMessage(error instanceof Error ? error.message : '整理札记时遇到未知差错。')
    } finally {
      setLocalGenerating(false)
    }
  }

  async function handleTranscribeAudio(): Promise<void> {
    if (!onTranscribeAudio || generationBusy) {
      return
    }

    setTranscribingAudio(true)
    setStatusMessage('')
    setErrorMessage('')

    try {
      const generatedNote = await onTranscribeAudio()

      if (generatedNote) {
        setStatusMessage('音频转写已完成')
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '音频转写失败。')
    } finally {
      setTranscribingAudio(false)
    }
  }

  async function handleSave(): Promise<void> {
    if (!note || saving) {
      return
    }

    setSaving(true)
    setStatusMessage('')
    setErrorMessage('')

    try {
      const nextNote = {
        ...note,
        userMemo: memoDraft
      }

      await onSave(nextNote)
      onChange?.(nextNote)
      setStatusMessage('札记已保存')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '保存札记时遇到未知差错。')
    } finally {
      setSaving(false)
    }
  }

  async function handleGetCurrentTime(): Promise<void> {
    if (!onGetCurrentTime) {
      setErrorMessage('当前页面暂不能读取视频时间。')
      setStatusMessage('')
      return
    }

    try {
      const seconds = await onGetCurrentTime()
      setAnnotationStart(seconds)
      setErrorMessage('')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '读取当前视频时间失败。')
      setStatusMessage('')
    }
  }

  function resetAnnotationDraft(): void {
    setAnnotationId(null)
    setAnnotationStart(null)
    setAnnotationTitle('')
    setAnnotationBody('')
  }

  function startAnnotationDraft(start: number | null, title: string): void {
    setAnnotationId(null)
    setAnnotationStart(start)
    setAnnotationTitle(createAnnotationTitle(title))
    setAnnotationBody('')
    setStatusMessage('')
    setErrorMessage('')
  }

  async function handleSaveAnnotation(): Promise<void> {
    if (!note || saving) {
      return
    }

    if (!annotationTitle.trim() && !annotationBody.trim()) {
      setErrorMessage('请先填写批注标题或批注正文。')
      setStatusMessage('')
      return
    }

    if (!onChange) {
      setErrorMessage('当前窗口暂不能更新批注。')
      setStatusMessage('')
      return
    }

    const existing = annotationId
      ? (note.annotations ?? []).find((annotation) => annotation.id === annotationId)
      : null
    const now = new Date().toISOString()
    const annotation: VideoNoteAnnotation = {
      id: annotationId ?? `annotation-${now}-${Math.random().toString(36).slice(2)}`,
      start: annotationStart,
      title: annotationTitle,
      body: annotationBody,
      createdAt: existing?.createdAt ?? now,
      updatedAt: existing?.updatedAt ?? now
    }

    const nextNote = saveVideoNoteAnnotation(note, annotation, now)
    setSaving(true)
    setStatusMessage('')
    setErrorMessage('')

    try {
      await onSave(nextNote)
      onChange(nextNote)
      resetAnnotationDraft()
      setStatusMessage('批注已保存')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '保存批注时遇到未知差错。')
    } finally {
      setSaving(false)
    }
  }

  function handleEditAnnotation(annotation: VideoNoteAnnotation): void {
    setAnnotationId(annotation.id)
    setAnnotationStart(annotation.start)
    setAnnotationTitle(annotation.title)
    setAnnotationBody(annotation.body)
  }

  async function handleDeleteAnnotation(annotationIdToDelete: string): Promise<void> {
    if (!note || saving) {
      return
    }

    if (!onChange) {
      setErrorMessage('当前窗口暂不能更新批注。')
      setStatusMessage('')
      return
    }

    const nextNote = removeVideoNoteAnnotation(note, annotationIdToDelete, new Date().toISOString())
    setSaving(true)
    setStatusMessage('')
    setErrorMessage('')

    try {
      await onSave(nextNote)
      onChange(nextNote)

      if (annotationId === annotationIdToDelete) {
        resetAnnotationDraft()
      }

      setStatusMessage('批注已删除')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '删除批注时遇到未知差错。')
    } finally {
      setSaving(false)
    }
  }

  async function handleSeekToTime(seconds: number | null): Promise<void> {
    if (seconds === null) {
      return
    }

    if (!onSeekToTime) {
      setErrorMessage('当前页面暂不能跳转视频时间。')
      setStatusMessage('')
      return
    }

    try {
      const didSeek = await onSeekToTime(seconds)

      if (!didSeek) {
        setErrorMessage('未能跳转到该视频时间。')
        setStatusMessage('')
        return
      }

      setErrorMessage('')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '跳转视频时间失败。')
      setStatusMessage('')
    }
  }

  async function handleCopyMarkdown(): Promise<void> {
    try {
      await navigator.clipboard.writeText(markdown)
      setStatusMessage('Markdown 已复制')
      setErrorMessage('')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '复制 Markdown 失败。')
      setStatusMessage('')
    }
  }

  async function copyText(value: string, successMessage: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value)
      setStatusMessage(successMessage)
      setErrorMessage('')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '复制失败。')
      setStatusMessage('')
    }
  }

  if (!note) {
    return (
      <section className="video-notes" aria-label="视频札记">
        <button type="button" disabled={generationBusy} onClick={() => void handleGenerate(undefined)}>
          {generationBusy ? '整理中...' : generateFailed ? '重新整理' : '整理札记'}
        </button>

        <button
          type="button"
          disabled={!onTranscribeAudio || generationBusy}
          onClick={() => void handleTranscribeAudio()}
        >
          {transcribingAudio ? '转写中...' : '转写音频'}
        </button>
        <button type="button" disabled={!onOpenArchive} onClick={onOpenArchive}>
          档案库
        </button>
        {transcriptionProgress ? <p>{transcriptionProgress.message}</p> : null}

        <div>
          <label htmlFor="manual-transcript">粘贴文稿</label>
          <textarea
            id="manual-transcript"
            value={manualTranscript}
            disabled={generationBusy}
            onChange={(event) => setManualTranscript(event.target.value)}
          />
        </div>

        <button
          type="button"
          disabled={generationBusy || manualTranscript.trim().length === 0}
          onClick={() => void handleGenerate(manualTranscript)}
        >
          整理粘贴文稿
        </button>
        {errorMessage ? <p role="alert">{errorMessage}</p> : null}
        {statusMessage ? <p role="status">{statusMessage}</p> : null}
      </section>
    )
  }

  return (
    <section className="video-notes" aria-label="视频札记">
      <section className="video-notes__source" aria-label="当前视频详情">
        <span>当前视频</span>
        <h3>{note.source.title}</h3>
        <dl>
          <dt>UP</dt>
          <dd>{note.source.author ?? '未署名'}</dd>
          <dt>BV</dt>
          <dd>{note.source.bvid ?? '未识别'}</dd>
          <dt>链接</dt>
          <dd>{note.source.url}</dd>
        </dl>
      </section>

      <section className="video-notes__primary-actions" aria-label="生成与归档">
        <div>
          <strong>生成与归档</strong>
          <p>转写完成后可保存到全局档案库。</p>
        </div>
        <button
          type="button"
          disabled={!onTranscribeAudio || generationBusy}
          onClick={() => void handleTranscribeAudio()}
        >
          {transcribingAudio ? '转写中...' : '转写音频'}
        </button>
        <button type="button" disabled={!onOpenArchive} onClick={onOpenArchive}>
          档案库
        </button>
      </section>

      {transcriptionProgress ? (
        <div className="video-notes__progress" role="status">
          <div>
            <strong>{transcriptionProgress.message}</strong>
            {transcriptionProgress.segmentIndex && transcriptionProgress.segmentCount ? (
              <span>
                第 {transcriptionProgress.segmentIndex} / {transcriptionProgress.segmentCount} 段
              </span>
            ) : null}
          </div>
          {transcriptionProgress.segmentIndex && transcriptionProgress.segmentCount ? (
            <progress
              max={transcriptionProgress.segmentCount}
              value={transcriptionProgress.segmentIndex}
            />
          ) : null}
        </div>
      ) : null}
      {note.transcript.length === 0 ? (
        <div>
          <p>尚未取得文稿。点击「转写音频」开始；如果当前视频无法下载，可粘贴文稿整理。</p>
        </div>
      ) : null}

      <div className="video-notes__result-tabs" role="tablist" aria-label="札记结果">
        {resultTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeResultTab === tab.id}
            aria-controls={`video-notes-${tab.id}`}
            id={`video-notes-tab-${tab.id}`}
            onClick={() => setActiveResultTab(tab.id)}
          >
            <strong>{tab.label}</strong>
            <small>{tab.description}</small>
          </button>
        ))}
      </div>

      {activeResultTab === 'plain' && (
        <div
          role="tabpanel"
          id="video-notes-plain"
          aria-labelledby="video-notes-tab-plain"
        >
          <div className="video-notes__panel-header">
            <strong>无时间线文稿</strong>
            <button type="button" onClick={() => void copyText(plainTranscript, '全文已复制')}>
              复制全文
            </button>
          </div>
          <div className="video-notes__plain-text">
            {plainTranscript ? plainTranscript : '暂无文稿。'}
          </div>
        </div>
      )}

      {activeResultTab === 'timed' && (
        <div
          role="tabpanel"
          id="video-notes-timed"
          aria-labelledby="video-notes-tab-timed"
        >
          <ol aria-label="带时间线文稿">
            {note.transcript.map((segment, index) => (
              <li key={`${segment.start ?? 'unknown'}-${index}`}>
                <button type="button" onClick={() => void handleSeekToTime(segment.start)}>
                  {formatTimestamp(segment.start)}
                </button>
                <p>{segment.text}</p>
                <button type="button" onClick={() => startAnnotationDraft(segment.start, segment.text)}>
                  加批注
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}

      {activeResultTab === 'summary' && (
        <div
          role="tabpanel"
          id="video-notes-summary"
          aria-labelledby="video-notes-tab-summary"
        >
          <div className="video-notes__panel-header">
            <strong>一图流总结</strong>
            <button type="button" onClick={() => void copyText(summaryText, '总结已复制')}>
              复制总结
            </button>
          </div>
          <section aria-label="速览摘要">
            {note.overview.shortSummary.map((summary) => (
              <p key={summary}>{summary}</p>
            ))}
          </section>
          {note.overview.keywords.length > 0 ? (
            <ul className="video-notes__keywords" aria-label="关键词">
              {note.overview.keywords.map((keyword) => (
                <li key={keyword}>{keyword}</li>
              ))}
            </ul>
          ) : null}
          <ol aria-label="时间线重点">
            {note.overview.timeline.map((item, index) => (
              <li key={`${item.title}-${index}`}>
                <time>{formatTimestamp(item.start)}</time>
                <strong>{item.title}</strong>
                <p>{item.detail}</p>
                <button type="button" onClick={() => startAnnotationDraft(item.start, item.title)}>
                  加批注
                </button>
              </li>
            ))}
          </ol>
          {note.overview.highlights.length > 0 ? (
            <ol className="video-notes__highlights" aria-label="高光片段">
              {note.overview.highlights.map((item, index) => (
                <li key={`${item.title}-${index}`}>
                  <time>{formatTimestamp(item.start)}</time>
                  <strong>{item.title}</strong>
                  <p>{item.detail}</p>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      )}

      <section className="video-notes__annotations" aria-label="批注">
        <div
          id="video-notes-annotations"
        >
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void handleSaveAnnotation()
            }}
          >
            <button type="button" onClick={() => void handleGetCurrentTime()}>
              取当前时间
            </button>
            {annotationStart !== null ? (
              <button type="button" onClick={() => void handleSeekToTime(annotationStart)}>
                {formatTimestamp(annotationStart)}
              </button>
            ) : null}

            <div>
              <label htmlFor="video-note-annotation-title">批注标题</label>
              <input
                id="video-note-annotation-title"
                value={annotationTitle}
                onChange={(event) => setAnnotationTitle(event.target.value)}
              />
            </div>

            <div>
              <label htmlFor="video-note-annotation-body">批注正文</label>
              <textarea
                id="video-note-annotation-body"
                value={annotationBody}
                onChange={(event) => setAnnotationBody(event.target.value)}
              />
            </div>

            <button type="submit" disabled={saving}>保存批注</button>
            {annotationId ? (
              <button type="button" onClick={resetAnnotationDraft}>
                取消编辑
              </button>
            ) : null}
          </form>

          {sortedAnnotations.length > 0 ? (
            <ol aria-label="已有批注">
              {sortedAnnotations.map((annotation) => (
                <li key={annotation.id}>
                  {annotation.start !== null ? (
                    <button type="button" onClick={() => void handleSeekToTime(annotation.start)}>
                      {formatTimestamp(annotation.start)}
                    </button>
                  ) : (
                    <span>{formatTimestamp(annotation.start)}</span>
                  )}
                  <strong>{annotation.title}</strong>
                  {annotation.body ? <p>{annotation.body}</p> : null}
                  <button type="button" disabled={saving} onClick={() => handleEditAnnotation(annotation)}>
                    编辑
                  </button>
                  <button type="button" disabled={saving} onClick={() => void handleDeleteAnnotation(annotation.id)}>
                    删除
                  </button>
                </li>
              ))}
            </ol>
          ) : null}

        </div>
      </section>

      <section className="video-notes__memo" aria-label="归档备注">
        <div>
          <label htmlFor="video-note-user-memo">本地备注</label>
          <textarea
            id="video-note-user-memo"
            value={memoDraft}
            onChange={(event) => setMemoDraft(event.target.value)}
          />
        </div>

        <button type="button" disabled={saving} onClick={() => void handleSave()}>
          {saving ? '保存中...' : '保存札记'}
        </button>

        <label htmlFor="video-note-markdown-preview">Markdown 预览</label>
        <textarea id="video-note-markdown-preview" value={markdown} readOnly />
        <button type="button" onClick={() => void handleCopyMarkdown()}>
          复制 Markdown
        </button>

      </section>
      {errorMessage ? <p role="alert">{errorMessage}</p> : null}
      {statusMessage ? <p role="status">{statusMessage}</p> : null}
    </section>
  )
}
