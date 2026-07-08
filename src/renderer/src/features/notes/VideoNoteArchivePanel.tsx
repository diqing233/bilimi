import { useEffect, useMemo, useState } from 'react'
import type {
  NotePosterSummary,
  VideoNote,
  VideoNoteArchiveEntry,
  VideoNoteArchiveVersion
} from '@shared/types'
import {
  createNotePosterText,
  createNotePosterCopyParts,
  createPlainTranscriptText,
  searchVideoNoteArchives
} from '@shared/videoNoteArchive'
import { CopySplitButton } from './CopySplitButton'

type VideoNoteArchivePanelProps = {
  archives: VideoNoteArchiveEntry[]
  onClose: () => void
  onOpenSource: (url: string) => void
  onUpdateVersion: (
    archiveId: string,
    versionId: string,
    note: VideoNote,
    summaryText?: string
  ) => Promise<VideoNoteArchiveEntry[] | void>
  onDeleteEntry: (archiveId: string) => Promise<void>
  onDeleteVersion: (archiveId: string, versionId: string) => Promise<void>
  deepSeekEnabled?: boolean
  onGeneratePoster?: (note: VideoNote) => Promise<NotePosterSummary>
  onArchivePosterSummary?: (note: VideoNote, poster: NotePosterSummary) => Promise<void>
}

type ArchiveResultTab = 'plain' | 'timed' | 'summary'

const archiveResultTabs: Array<{ id: ArchiveResultTab; label: string }> = [
  { id: 'plain', label: '无时间线文稿' },
  { id: 'timed', label: '带时间线文稿' },
  { id: 'summary', label: 'DeepSeek 总结' }
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

function extractMarkdownHeading(text: string): string {
  const lines = text.split('\n').map((line) => line.trim())
  return (
    lines.find((line) => /^###\s+/.test(line))?.replace(/^###\s+/, '').trim() ??
    lines.find((line) => /^##\s+/.test(line))?.replace(/^##\s+/, '').trim() ??
    ''
  )
}

export function VideoNoteArchivePanel({
  archives,
  onClose,
  onOpenSource,
  onUpdateVersion,
  onDeleteEntry,
  onDeleteVersion,
  deepSeekEnabled = false,
  onGeneratePoster,
  onArchivePosterSummary
}: VideoNoteArchivePanelProps): React.JSX.Element {
  const [localArchives, setLocalArchives] = useState<VideoNoteArchiveEntry[]>(archives)
  const [query, setQuery] = useState('')
  const [hasMemo, setHasMemo] = useState(false)
  const [hasStarred, setHasStarred] = useState(false)
  const [selectedArchiveId, setSelectedArchiveId] = useState<string | null>(null)
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null)
  const [activeResultTab, setActiveResultTab] = useState<ArchiveResultTab | null>(null)
  const [memoOpen, setMemoOpen] = useState(false)
  const [memoDraft, setMemoDraft] = useState('')
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const [statusMessage, setStatusMessage] = useState('')
  const [versionMenuOpen, setVersionMenuOpen] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [summaryGenerating, setSummaryGenerating] = useState(false)
  const filteredArchives = useMemo(
    () => searchVideoNoteArchives(localArchives, { query, hasMemo, hasStarred }),
    [localArchives, hasMemo, hasStarred, query]
  )
  const selectedArchive =
    localArchives.find((archive) => archive.id === selectedArchiveId) ?? null
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

  useEffect(() => {
    setMemoDraft(selectedVersion?.note.userMemo ?? '')
  }, [selectedVersion?.id, selectedVersion?.note.userMemo])

  function selectArchive(archive: VideoNoteArchiveEntry): void {
    if (selectedArchiveId === archive.id) {
      setSelectedArchiveId(null)
      setSelectedVersionId(null)
      setActiveResultTab(null)
      setMemoOpen(false)
      setVersionMenuOpen(false)
      setMoreMenuOpen(false)
      return
    }

    setSelectedArchiveId(archive.id)
    setSelectedVersionId(archive.versions.at(-1)?.id ?? null)
    setActiveResultTab(null)
    setMemoOpen(false)
    setVersionMenuOpen(false)
    setMoreMenuOpen(false)
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
      setLocalArchives((current) =>
        current.filter((archive) => archive.id !== pendingDelete.archiveId)
      )
      setSelectedArchiveId(null)
      setSelectedVersionId(null)
    } else {
      await onDeleteVersion(pendingDelete.archiveId, pendingDelete.versionId)
      setLocalArchives((current) =>
        current
          .map((archive) =>
            archive.id === pendingDelete.archiveId
              ? {
                  ...archive,
                  versions: archive.versions.filter(
                    (version) => version.id !== pendingDelete.versionId
                  )
                }
              : archive
          )
          .filter((archive) => archive.versions.length > 0)
      )

      if (selectedVersionId === pendingDelete.versionId) {
        const remainingVersion =
          selectedArchive?.versions.find((version) => version.id !== pendingDelete.versionId) ??
          null
        setSelectedVersionId(remainingVersion?.id ?? null)
      }
    }

    setPendingDelete(null)
  }

  async function updateSelectedNote(note: VideoNote, summaryText?: string): Promise<void> {
    if (!selectedArchive || !selectedVersion) return
    const nextSummaryText = summaryText ?? selectedVersion.summaryText

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
                    summaryText: nextSummaryText
                  }
                : version
            ),
            updatedAt: note.updatedAt
          }
        : archive
    )
    setLocalArchives(nextArchives)
    if (summaryText === undefined) {
      await onUpdateVersion(selectedArchive.id, selectedVersion.id, note)
    } else {
      await onUpdateVersion(selectedArchive.id, selectedVersion.id, note, summaryText)
    }
  }

  function saveMemoDraft(): void {
    if (!selectedVersion) return
    const nextMemo = memoDraft
    if (nextMemo === selectedVersion.note.userMemo) return

    void updateSelectedNote({
      ...selectedVersion.note,
      userMemo: nextMemo,
      updatedAt: new Date().toISOString()
    })
  }

  function toggleStarred(): void {
    if (!selectedVersion) return
    void updateSelectedNote({
      ...selectedVersion.note,
      starred: !selectedVersion.note.starred,
      updatedAt: new Date().toISOString()
    })
  }

  function toggleResultTab(tab: ArchiveResultTab): void {
    setActiveResultTab((current) => (current === tab ? null : tab))
  }

  async function generateSummary(version: VideoNoteArchiveVersion): Promise<void> {
    if (!deepSeekEnabled) {
      setStatusMessage('请先到设置启用 DeepSeek 后再生成总结。')
      return
    }

    if (!onGeneratePoster || summaryGenerating) return

    setSummaryGenerating(true)
    setStatusMessage('')
    try {
      const poster = await onGeneratePoster(version.note)
      const summaryText = createNotePosterText(poster)
      await onArchivePosterSummary?.(version.note, poster)
      await updateSelectedNote(
        {
          ...version.note,
          overview: {
            ...version.note.overview,
            shortSummary: [poster.subtitle, ...poster.keyPoints].filter(Boolean),
            keywords: poster.keywords.length > 0 ? poster.keywords : version.note.overview.keywords
          },
          updatedAt: new Date().toISOString()
        },
        summaryText
      )
      setStatusMessage('DeepSeek 总结已生成。')
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'DeepSeek 总结生成失败。')
    } finally {
      setSummaryGenerating(false)
    }
  }

  function renderResultTabs(): React.JSX.Element {
    return (
      <div
        className="video-notes__result-tabs video-note-archive__result-tabs"
        role="tablist"
        aria-label="档案文稿"
      >
        {archiveResultTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeResultTab === tab.id}
            aria-controls={'video-note-archive-' + tab.id}
            id={'video-note-archive-tab-' + tab.id}
            onClick={() => toggleResultTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
    )
  }

  function renderActiveResult(version: VideoNoteArchiveVersion): React.JSX.Element | null {
    if (!activeResultTab) {
      return null
    }

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
    const deepSeekCopyParts =
      activeResultTab === 'summary' ? createNotePosterCopyParts(version.summaryText) : null
    const canGenerateSummary = activeResultTab === 'summary' && version.plainTranscript.trim()
    const summaryButtonLabel = version.summaryText.trim() ? '重新总结' : '生成总结'

    return (
      <section
        className="video-note-archive__result-panel"
        role="tabpanel"
        id={'video-note-archive-' + activeResultTab}
        aria-labelledby={'video-note-archive-tab-' + activeResultTab}
      >
        <div className="video-notes__panel-header">
          <strong>{titleByTab[activeResultTab]}</strong>
          {activeResultTab === 'summary' ? (
            <>
              <button
                type="button"
                className="video-notes__summary-generate"
                disabled={!canGenerateSummary || summaryGenerating || !deepSeekEnabled}
                onClick={() => void generateSummary(version)}
              >
                {summaryGenerating ? '生成中...' : summaryButtonLabel}
              </button>
              <CopySplitButton
                groupLabel="档案 DeepSeek 复制"
                buttonLabel="复制全文"
                menuLabel="更多复制"
                text={copyTextValue}
                message="全文已复制"
                onCopy={copyText}
                options={[
                  {
                    id: 'polished',
                    label: '复制精修文',
                    text: deepSeekCopyParts?.polishedTranscriptText ?? '',
                    message: '精修文稿已复制',
                    disabled: !deepSeekCopyParts?.polishedTranscriptText
                  },
                  {
                    id: 'summary',
                    label: '复制总结',
                    text: deepSeekCopyParts?.summaryText ?? '',
                    message: '总结已复制',
                    disabled: !deepSeekCopyParts?.summaryText
                  }
                ]}
              />
            </>
          ) : (
            <button type="button" onClick={() => void copyText(copyTextValue, '全文已复制')}>
              复制
            </button>
          )}
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
          version.summaryText ? (
            <>
              {extractMarkdownHeading(version.summaryText) ? (
                <h4>{extractMarkdownHeading(version.summaryText)}</h4>
              ) : null}
              <pre>{version.summaryText}</pre>
            </>
          ) : deepSeekEnabled ? (
            <p>
              <span>暂无 DeepSeek 总结。</span>
              <span>已有文稿，可以点击生成总结。</span>
            </p>
          ) : (
            <p>请先到设置启用 DeepSeek 后再生成总结。</p>
          )
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
      <div className="video-note-archive__history-card">
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
          <button
            type="button"
            className="video-note-archive__star-button video-note-archive__star-filter"
            aria-label="星标"
            aria-pressed={hasStarred}
            title="星标"
            onClick={() => setHasStarred((current) => !current)}
          >
            ⭐
          </button>
          <button
            type="button"
            className="video-note-archive__memo-filter"
            aria-pressed={hasMemo}
            onClick={() => setHasMemo((current) => !current)}
          >
            已备注
          </button>
        </div>

        <ul className="video-note-archive__list" aria-label="视频列表">
          {filteredArchives.length > 0 ? (
            filteredArchives.map((archive) => {
              const latestVersion = getLatestVersion(archive)
              const isSelected = archive.id === selectedArchive?.id
              return (
                <li key={archive.id}>
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => selectArchive(archive)}
                  >
                    <strong>{archive.source.title}</strong>
                    <small>
                      {archive.source.author ?? '未署名'} · {archive.source.bvid ?? '未识别'} ·{' '}
                      {archive.versions.length} 次转写
                      {archive.versions.some((version) => version.note.starred) ? ' · 已星标' : ''}
                    </small>
                    <small>{latestVersion ? latestVersion.createdAt : archive.updatedAt}</small>
                    <span className="video-note-archive__list-state">
                      {isSelected ? '已展开' : '详情'}
                    </span>
                  </button>
                </li>
              )
            })
          ) : (
            <p>没有匹配的档案。</p>
          )}
        </ul>
      </div>

      {selectedArchive && selectedVersion ? (
        <article className="video-note-archive__detail" aria-label={selectedArchive.source.title}>
            <header>
              <div className="video-note-archive__detail-title-row">
                <h3>
                  <a
                    href={selectedArchive.source.url}
                    onClick={(event) => {
                      event.preventDefault()
                      onOpenSource(selectedArchive.source.url)
                    }}
                  >
                    {selectedArchive.source.title}
                  </a>
                </h3>
                <div className="video-note-archive__more">
                  <button
                    type="button"
                    aria-label="更多档案操作"
                    aria-haspopup="menu"
                    aria-expanded={moreMenuOpen}
                    onClick={() => setMoreMenuOpen((open) => !open)}
                  >
                    ⋯
                  </button>
                  {moreMenuOpen ? (
                    <div className="video-note-archive__menu" role="menu">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMoreMenuOpen(false)
                          onOpenSource(selectedArchive.source.url)
                        }}
                      >
                        打开视频来源
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMoreMenuOpen(false)
                          setPendingDelete({ type: 'entry', archiveId: selectedArchive.id })
                        }}
                      >
                        删除视频档案
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
              <p className="video-note-archive__detail-meta">
                {selectedArchive.source.author ?? '未知作者'} · {selectedArchive.source.bvid ?? '未识别'} ·{' '}
                {selectedArchive.versions.length} 次转写
              </p>
              <div className="video-note-archive__version-controls">
              <div className="video-note-archive__version-picker">
                <span id="video-note-archive-version-label">历史版本</span>
                <button
                  type="button"
                  aria-label="展开历史版本"
                  aria-haspopup="listbox"
                  aria-expanded={versionMenuOpen}
                  onClick={() => setVersionMenuOpen((open) => !open)}
                >
                  {formatVersionLabel(
                    selectedVersion,
                    selectedArchive.versions.findIndex((version) => version.id === selectedVersion.id)
                  )}
                  <span aria-hidden="true">▾</span>
                </button>
                <select
                  className="video-note-archive__version-native"
                  aria-label="历史版本"
                  value={selectedVersion.id}
                  onChange={(event) => setSelectedVersionId(event.target.value)}
                >
                  {selectedArchive.versions.map((version, index) => (
                    <option key={version.id} value={version.id}>
                      {formatVersionLabel(version, index)}
                    </option>
                  ))}
                </select>
                {versionMenuOpen ? (
                  <div className="video-note-archive__version-menu" role="listbox">
                    {selectedArchive.versions.map((version, index) => (
                      <div
                        key={version.id}
                        className="video-note-archive__version-row"
                        role="option"
                        aria-selected={version.id === selectedVersion.id}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedVersionId(version.id)
                            setVersionMenuOpen(false)
                          }}
                        >
                          {formatVersionLabel(version, index)}
                        </button>
                        <button
                          type="button"
                          aria-label={`删除版本 v${index + 1}`}
                          disabled={selectedArchive.versions.length <= 1}
                          onClick={() => {
                            setVersionMenuOpen(false)
                            setPendingDelete({
                              type: 'version',
                              archiveId: selectedArchive.id,
                              versionId: version.id
                            })
                          }}
                        >
                          删除
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className="video-note-archive__star-button"
                aria-label="星标收藏"
                aria-pressed={Boolean(selectedVersion.note.starred)}
                title="星标收藏"
                onClick={toggleStarred}
              >
                ⭐
              </button>
              <button type="button" aria-pressed={memoOpen} onClick={() => setMemoOpen((open) => !open)}>
                备注
              </button>
            </div>
            </header>

            {memoOpen ? (
              <section className="video-note-archive__editor" aria-label="备注">
                <label>
                  本地备注
                  <textarea
                    value={memoDraft}
                    onChange={(event) => setMemoDraft(event.currentTarget.value)}
                    onBlur={saveMemoDraft}
                  />
                </label>
              </section>
            ) : null}

            {renderResultTabs()}
            {renderActiveResult(selectedVersion)}

        </article>
      ) : (
        <section className="video-note-archive__detail">
          <p>请选择上方档案查看文稿、备注和星标。</p>
        </section>
      )}

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
