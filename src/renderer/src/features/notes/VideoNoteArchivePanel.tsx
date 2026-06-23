import { useEffect, useMemo, useState } from 'react'
import type { VideoNote, VideoNoteArchiveEntry, VideoNoteArchiveVersion } from '@shared/types'
import { createPlainTranscriptText, searchVideoNoteArchives } from '@shared/videoNoteArchive'

type VideoNoteArchivePanelProps = {
  archives: VideoNoteArchiveEntry[]
  onClose: () => void
  onOpenSource: (url: string) => void
  onUpdateVersion: (
    archiveId: string,
    versionId: string,
    note: VideoNote
  ) => Promise<VideoNoteArchiveEntry[] | void>
  onDeleteEntry: (archiveId: string) => Promise<void>
  onDeleteVersion: (archiveId: string, versionId: string) => Promise<void>
}

type ArchiveResultTab = 'plain' | 'timed' | 'summary'

const archiveResultTabs: Array<{ id: ArchiveResultTab; label: string; description: string }> = [
  { id: 'plain', label: '无时间线文稿', description: '纯文稿连续阅读，提供复制全文。' },
  { id: 'timed', label: '带时间线文稿', description: '按时间段阅读，提供复制全文。' },
  { id: 'summary', label: 'DeepSeek 总结', description: '更丰富精细的结构化摘要，提供复制全文。' }
]

type PendingDelete =
  | { type: 'entry'; archiveId: string }
  | { type: 'version'; archiveId: string; versionId: string }

function getLatestVersion(archive: VideoNoteArchiveEntry): VideoNoteArchiveVersion | null {
  return archive.versions.at(-1) ?? null
}

function formatVersionLabel(version: VideoNoteArchiveVersion, index: number): string {
  return `v${index + 1} · ${new Date(version.createdAt).toLocaleString('zh-CN')}`
}

function formatTimestamp(seconds: number | null): string {
  if (seconds === null) return '--:--'
  const normalizedSeconds = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(normalizedSeconds / 60)
  const remainder = normalizedSeconds % 60
  return minutes.toString().padStart(2, '0') + ':' + remainder.toString().padStart(2, '0')
}

function createTimedTranscriptText(note: VideoNote): string {
  return note.transcript
    .map((segment) => `[${formatTimestamp(segment.start)}] ${segment.text.trim()}`)
    .filter((line) => line.trim().length > 0)
    .join('\n\n')
}

export function VideoNoteArchivePanel({
  archives,
  onClose,
  onOpenSource,
  onUpdateVersion,
  onDeleteEntry,
  onDeleteVersion
}: VideoNoteArchivePanelProps): React.JSX.Element {
  const [localArchives, setLocalArchives] = useState<VideoNoteArchiveEntry[]>(archives)
  const [query, setQuery] = useState('')
  const [hasAnnotations, setHasAnnotations] = useState(false)
  const [hasMemo, setHasMemo] = useState(false)
  const [selectedArchiveId, setSelectedArchiveId] = useState<string | null>(null)
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null)
  const [activeResultTab, setActiveResultTab] = useState<ArchiveResultTab>('plain')
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const [statusMessage, setStatusMessage] = useState('')
  const filteredArchives = useMemo(
    () => searchVideoNoteArchives(localArchives, { query, hasAnnotations, hasMemo }),
    [localArchives, hasAnnotations, hasMemo, query]
  )
  const selectedArchive =
    filteredArchives.find((archive) => archive.id === selectedArchiveId) ?? null
  const selectedVersion =
    selectedArchive?.versions.find((version) => version.id === selectedVersionId) ??
    selectedArchive?.versions.at(-1) ??
    null

  useEffect(() => {
    setLocalArchives(archives)
  }, [archives])

  useEffect(() => {
    if (selectedArchiveId && !selectedArchive) {
      setSelectedArchiveId(null)
      setSelectedVersionId(null)
      return
    }

    if (selectedArchive && !selectedVersion) {
      setSelectedVersionId(selectedArchive.versions.at(-1)?.id ?? null)
    }
  }, [selectedArchive, selectedArchiveId, selectedVersion])

  function selectArchive(archive: VideoNoteArchiveEntry): void {
    setSelectedArchiveId(archive.id)
    setSelectedVersionId(archive.versions.at(-1)?.id ?? null)
    setActiveResultTab('plain')
  }

  async function copyText(value: string, message: string): Promise<void> {
    await navigator.clipboard.writeText(value)
    setStatusMessage(message)
  }

  async function confirmDelete(): Promise<void> {
    if (!pendingDelete) {
      return
    }

    if (pendingDelete.type === 'entry') {
      await onDeleteEntry(pendingDelete.archiveId)
    } else {
      await onDeleteVersion(pendingDelete.archiveId, pendingDelete.versionId)
    }

    setPendingDelete(null)
  }

  async function updateSelectedNote(note: VideoNote): Promise<void> {
    if (!selectedArchive || !selectedVersion) return

    const nextArchives = localArchives.map((archive) =>
      archive.id === selectedArchive.id
        ? {
            ...archive,
            source: note.source,
            versions: archive.versions.map((version) =>
              version.id === selectedVersion.id
                ? {
                    ...version,
                    note,
                    plainTranscript: createPlainTranscriptText(note),
                    summaryText: selectedVersion.summaryText
                  }
                : version
            ),
            updatedAt: note.updatedAt
          }
        : archive
    )
    setLocalArchives(nextArchives)
    await onUpdateVersion(selectedArchive.id, selectedVersion.id, note)
  }

  function updateAnnotationDraft(field: 'title' | 'body', value: string): void {
    if (!selectedVersion) return
    const now = new Date().toISOString()
    const existing = selectedVersion.note.annotations[0]
    const nextAnnotation = {
      id: existing?.id ?? `archive-annotation:${now}`,
      start: existing?.start ?? null,
      title: field === 'title' ? value : (existing?.title ?? ''),
      body: field === 'body' ? value : (existing?.body ?? ''),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    }
    const nextNote = {
      ...selectedVersion.note,
      annotations: [nextAnnotation, ...selectedVersion.note.annotations.slice(1)],
      updatedAt: now
    }

    void updateSelectedNote(nextNote)
  }

  function updateMemo(value: string): void {
    if (!selectedVersion) return
    void updateSelectedNote({
      ...selectedVersion.note,
      userMemo: value,
      updatedAt: new Date().toISOString()
    })
  }

  function renderResultTabs(): React.JSX.Element {
    return (
      <div className="video-notes__result-tabs" role="tablist" aria-label="档案文稿">
        {archiveResultTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeResultTab === tab.id}
            aria-controls={'video-note-archive-' + tab.id}
            id={'video-note-archive-tab-' + tab.id}
            onClick={() => setActiveResultTab(tab.id)}
          >
            <strong>{tab.label}</strong>
            <small>{tab.description}</small>
          </button>
        ))}
      </div>
    )
  }

  function renderActiveResult(version: VideoNoteArchiveVersion): React.JSX.Element {
    const copyTextByTab: Record<ArchiveResultTab, string> = {
      plain: version.plainTranscript,
      timed: createTimedTranscriptText(version.note),
      summary: version.summaryText
    }
    const titleByTab: Record<ArchiveResultTab, string> = {
      plain: '无时间线文稿',
      timed: '带时间线文稿',
      summary: 'DeepSeek 总结'
    }
    const copyTextValue = copyTextByTab[activeResultTab]

    return (
      <section
        className="video-note-archive__result-panel"
        role="tabpanel"
        id={'video-note-archive-' + activeResultTab}
        aria-labelledby={'video-note-archive-tab-' + activeResultTab}
      >
        <div className="video-notes__panel-header">
          <strong>{titleByTab[activeResultTab]}</strong>
          <button type="button" onClick={() => void copyText(copyTextValue, '全文已复制')}>
            复制
          </button>
        </div>
        {activeResultTab === 'timed' ? (
          <ol aria-label="带时间线文稿">
            {version.note.transcript.map((segment, index) => (
              <li key={String(segment.start ?? 'unknown') + '-' + index}>
                <time>{formatTimestamp(segment.start)}</time>
                <p>{segment.text}</p>
              </li>
            ))}
          </ol>
        ) : activeResultTab === 'summary' ? (
          <pre>{version.summaryText || '暂无 DeepSeek 总结。'}</pre>
        ) : (
          <div className="video-notes__plain-text">
            {version.plainTranscript || '暂无文稿。'}
          </div>
        )}
      </section>
    )
  }

  return (
    <section className="video-note-archive" aria-label="全局档案库">
      <header className="video-note-archive__header">
        <div>
          <span>全局档案库</span>
          <h2>所有视频历史</h2>
        </div>
        <button type="button" onClick={onClose}>
          返回札记
        </button>
      </header>

      <div className="video-note-archive__toolbar">
        <label>
          搜索档案
          <input
            type="search"
            role="searchbox"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={hasAnnotations}
            onChange={(event) => setHasAnnotations(event.target.checked)}
          />
          有批注
        </label>
        <label>
          <input
            type="checkbox"
            checked={hasMemo}
            onChange={(event) => setHasMemo(event.target.checked)}
          />
          有备注
        </label>
      </div>

      <div className="video-note-archive__body">
        <ul className="video-note-archive__list" aria-label="视频列表">
          {filteredArchives.length > 0 ? (
            filteredArchives.map((archive) => {
              const latestVersion = getLatestVersion(archive)
              const annotationCount = archive.versions.reduce(
                (count, version) => count + version.note.annotations.length,
                0
              )

              return (
                <li key={archive.id}>
                  <button
                    type="button"
                    aria-pressed={archive.id === selectedArchive?.id}
                    onClick={() => selectArchive(archive)}
                  >
                    <strong>{archive.source.title}</strong>
                    <small>
                      {archive.source.author ?? '未署名'} · {archive.source.bvid ?? '未识别'} ·{' '}
                      {archive.versions.length} 次转写 · {annotationCount} 条批注
                    </small>
                    <small>{latestVersion ? latestVersion.createdAt : archive.updatedAt}</small>
                  </button>
                </li>
              )
            })
          ) : (
            <p>没有匹配的档案。</p>
          )}
        </ul>

        {selectedArchive && selectedVersion ? (
          <article className="video-note-archive__detail" aria-label={selectedArchive.source.title}>
            <header>
              <h3>{selectedArchive.source.title}</h3>
              <p>
                {selectedArchive.source.author ?? '未署名'} · {selectedArchive.source.bvid ?? '未识别'}
              </p>
            </header>

            <label>
              历史版本
              <select
                value={selectedVersion.id}
                onChange={(event) => setSelectedVersionId(event.target.value)}
              >
                {selectedArchive.versions.map((version, index) => (
                  <option key={version.id} value={version.id}>
                    {formatVersionLabel(version, index)}
                  </option>
                ))}
              </select>
            </label>

            <div className="video-note-archive__actions">
              <button type="button" onClick={() => onOpenSource(selectedArchive.source.url)}>
                打开来源
              </button>
              <button
                type="button"
                onClick={() =>
                  setPendingDelete({
                    type: 'version',
                    archiveId: selectedArchive.id,
                    versionId: selectedVersion.id
                  })
                }
              >
                删除当前版本
              </button>
              <button
                type="button"
                onClick={() => setPendingDelete({ type: 'entry', archiveId: selectedArchive.id })}
              >
                删除视频档案
              </button>
            </div>

            {renderResultTabs()}
            {renderActiveResult(selectedVersion)}

            <section className="video-note-archive__editor">
              <h4>批注和备注</h4>
              <label>
                批注标题
                <input
                  type="text"
                  value={selectedVersion.note.annotations[0]?.title ?? ''}
                  onChange={(event) => updateAnnotationDraft('title', event.currentTarget.value)}
                />
              </label>
              <label>
                批注正文
                <textarea
                  value={selectedVersion.note.annotations[0]?.body ?? ''}
                  onChange={(event) => updateAnnotationDraft('body', event.currentTarget.value)}
                />
              </label>
              <label>
                本地备注
                <textarea
                  value={selectedVersion.note.userMemo}
                  onChange={(event) => updateMemo(event.currentTarget.value)}
                />
              </label>
              {selectedVersion.note.annotations.length > 0 ? (
                <ol>
                  {selectedVersion.note.annotations.map((annotation) => (
                    <li key={annotation.id}>
                      <strong>{annotation.title}</strong>
                      {annotation.body ? <p>{annotation.body}</p> : null}
                    </li>
                  ))}
                </ol>
              ) : (
                <p>暂无批注。</p>
              )}
            </section>
          </article>
        ) : (
          <section className="video-note-archive__detail">
            <p>请选择上方档案查看文稿、批注和备注。</p>
          </section>
        )}
      </div>

      {statusMessage ? <p role="status">{statusMessage}</p> : null}

      {pendingDelete ? (
        <div role="dialog" aria-label="确认删除" className="video-note-archive__dialog">
          <p>
            {pendingDelete.type === 'entry'
              ? '确认删除这个视频档案及全部历史版本？'
              : '确认删除当前历史版本？'}
          </p>
          <button type="button" onClick={() => void confirmDelete()}>
            确认删除
          </button>
          <button type="button" onClick={() => setPendingDelete(null)}>
            取消
          </button>
        </div>
      ) : null}
    </section>
  )
}
