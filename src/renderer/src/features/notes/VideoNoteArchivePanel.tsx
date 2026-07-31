import { type ComponentProps, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  NotePosterSummary,
  VideoNote,
  VideoNoteArchiveEntry,
  VideoNoteArchiveVersion,
  VideoNoteSourceMetadata
} from '@shared/types'
import {
  createNotePosterCopyParts,
  normalizeNotePosterTextForDisplay,
  createPlainTranscriptText,
  searchVideoNoteArchives
} from '@shared/videoNoteArchive'
import { CopySplitButton, ExportButton, type DownloadFormat } from './CopySplitButton'
import { formatDeepSeekErrorMessage } from '../assistant/deepSeekErrorMessage'
import { VideoNoteBatchExportDialog } from './VideoNoteBatchExportDialog'
import { LocalMemoEditor } from './LocalMemoEditor'
import { NoteSelectionCheckbox, NoteSelectionStore, NoteSelectionSubscriber } from './noteSelectionStore'
import idlePetUrl from '../../assets/pet/blue-white-maid/character/big-head/idle.png'
import './VideoNoteArchivePanel.css'

type VideoNoteArchivePanelProps = {
  archives: VideoNoteArchiveEntry[]
  accountMid?: string
  onClose: () => void
  onOpenSource: (url: string) => void
  onOpenArchiveSource?: (source: VideoNoteSourceMetadata) => void
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
  onArchivePosterSummary?: (
    archiveId: string,
    versionId: string,
    note: VideoNote,
    poster: NotePosterSummary
  ) => Promise<ArchivedPosterSummary | void>
  selectedArchiveId?: string | null
  selectedVersionId?: string | null
  activeResultTab?: ArchiveResultTab | null
  onSelectionChange?: (selection: VideoNoteArchiveSelection) => void
  onSeekSource?: (source: VideoNoteSourceMetadata, seconds: number) => void
  onCopyFeedback?: (feedback: { tone: 'success' | 'error'; message: string }) => void
}

type ArchiveResultTab = 'plain' | 'timed' | 'summary'

export type ArchivedPosterSummary = {
  archives: VideoNoteArchiveEntry[]
  archiveId: string
  versionId: string
}

export type VideoNoteArchiveSelection = {
  archiveId: string | null
  versionId: string | null
  activeResultTab: ArchiveResultTab | null
}

const archiveResultTabs: Array<{ id: ArchiveResultTab; label: string; description: string }> = [
  { id: 'plain', label: '无时间线文稿', description: '查看纯文稿，适合连续阅读' },
  { id: 'timed', label: '带时间线文稿', description: '查看时间线文稿，可点击时间跳转' },
  { id: 'summary', label: 'DeepSeek 总结', description: '查看结构化总结与精修文稿' }
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

function isValidTimestamp(seconds: number | null): seconds is number {
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0
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

function archivesForPanelAccount(archives: VideoNoteArchiveEntry[], accountMid: string | undefined) {
  return accountMid ? archives.filter((archive) => archive.source.accountMid === accountMid) : archives
}

export function VideoNoteArchivePanel({
  archives,
  accountMid,
  onClose,
  onOpenSource,
  onOpenArchiveSource,
  onUpdateVersion,
  onDeleteEntry,
  onDeleteVersion,
  deepSeekEnabled = false,
  onGeneratePoster,
  onArchivePosterSummary,
  selectedArchiveId: controlledSelectedArchiveId,
  selectedVersionId: controlledSelectedVersionId,
  activeResultTab: controlledActiveResultTab,
  onSelectionChange,
  onSeekSource,
  onCopyFeedback
}: VideoNoteArchivePanelProps): React.JSX.Element {
  const archiveRootRef = useRef<HTMLElement | null>(null)
  const moreMenuRef = useRef<HTMLDivElement | null>(null)
  const moreMenuTriggerRef = useRef<HTMLButtonElement | null>(null)
  const [localArchives, setLocalArchives] = useState<VideoNoteArchiveEntry[]>(() =>
    archivesForPanelAccount(archives, accountMid)
  )
  const [query, setQuery] = useState('')
  const [hasMemo, setHasMemo] = useState(false)
  const [hasStarred, setHasStarred] = useState(false)
  const [uncontrolledSelectedArchiveId, setUncontrolledSelectedArchiveId] =
    useState<string | null>(null)
  const [uncontrolledSelectedVersionId, setUncontrolledSelectedVersionId] =
    useState<string | null>(null)
  const [uncontrolledActiveResultTab, setUncontrolledActiveResultTab] =
    useState<ArchiveResultTab | null>(null)
  const [memoOpen, setMemoOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const [statusMessage, setStatusMessage] = useState('')
  const [versionMenuOpen, setVersionMenuOpen] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [summaryGenerating, setSummaryGenerating] = useState(false)
  const [batchMode, setBatchMode] = useState(false)
  const [archiveSelection] = useState(() => new NoteSelectionStore())
  const [batchExport, setBatchExport] = useState<{
    accountMid: string
    selections: Array<{ archiveId: string; versionId: string }>
    hasNotes: boolean
    scope: 'current' | 'complete'
    currentContent?: ArchiveResultTab
    formats: DownloadFormat[]
    initialSkippedCount?: number
  } | null>(null)
  const subscribeBatchProgress = useCallback<NonNullable<ComponentProps<typeof VideoNoteBatchExportDialog>['onProgress']>>(
    (callback) => window.bilimiDesktop.onVideoNoteArchiveBatchProgress?.(callback) ?? (() => undefined),
    []
  )
  const previousAccountMidRef = useRef(accountMid)
  const accountMidRef = useRef(accountMid)
  accountMidRef.current = accountMid
  const openArchiveSource = (source: VideoNoteSourceMetadata) => {
    if (onOpenArchiveSource) onOpenArchiveSource(source)
    else onOpenSource(source.url)
  }
  const filteredArchives = useMemo(
    () => searchVideoNoteArchives(localArchives, { query, hasMemo, hasStarred }),
    [localArchives, hasMemo, hasStarred, query]
  )
  const filteredArchiveIds = useMemo(() => new Set(filteredArchives.map((archive) => archive.id)), [filteredArchives])
  const selectedArchiveId =
    controlledSelectedArchiveId !== undefined
      ? controlledSelectedArchiveId
      : uncontrolledSelectedArchiveId
  const selectedVersionId =
    controlledSelectedVersionId !== undefined
      ? controlledSelectedVersionId
      : uncontrolledSelectedVersionId
  const activeResultTab =
    controlledActiveResultTab !== undefined
      ? controlledActiveResultTab
      : uncontrolledActiveResultTab
  const selectedArchive =
    localArchives.find((archive) => archive.id === selectedArchiveId) ?? null
  const selectedVersion =
    selectedArchive?.versions.find((version) => version.id === selectedVersionId) ??
    selectedArchive?.versions.at(-1) ??
    null

  function setArchiveSelection(selection: VideoNoteArchiveSelection): void {
    if (controlledSelectedArchiveId === undefined) {
      setUncontrolledSelectedArchiveId(selection.archiveId)
    }
    if (controlledSelectedVersionId === undefined) {
      setUncontrolledSelectedVersionId(selection.versionId)
    }
    if (controlledActiveResultTab === undefined) {
      setUncontrolledActiveResultTab(selection.activeResultTab)
    }
    onSelectionChange?.(selection)
  }

  useEffect(() => {
    const accountArchives = archivesForPanelAccount(archives, accountMid)
    setLocalArchives(accountArchives)
    archiveSelection.retain(new Set(accountArchives.map((archive) => archive.id)))
  }, [accountMid, archiveSelection, archives])

  useEffect(() => {
    if (previousAccountMidRef.current !== accountMid) {
      setBatchExport(null)
      archiveSelection.clear()
      previousAccountMidRef.current = accountMid
    }
  }, [accountMid, archiveSelection])

  useEffect(() => {
    if (!moreMenuOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (!moreMenuRef.current?.contains(event.target as Node)) setMoreMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setMoreMenuOpen(false)
      moreMenuTriggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [moreMenuOpen])

  useEffect(() => {
    if (selectedArchiveId && !selectedArchive) {
      if (localArchives.length === 0) {
        return
      }
      setArchiveSelection({ archiveId: null, versionId: null, activeResultTab: null })
      return
    }

    if (selectedArchive && !selectedVersion) {
      setArchiveSelection({
        archiveId: selectedArchive.id,
        versionId: selectedArchive.versions.at(-1)?.id ?? null,
        activeResultTab
      })
    }
  }, [activeResultTab, selectedArchive, selectedArchiveId, selectedVersion])

  useEffect(() => {
    if (!selectedArchive) {
      return
    }

    archiveRootRef.current
      ?.querySelector<HTMLElement>('.video-note-archive__list button[aria-pressed="true"]')
      ?.scrollIntoView?.({ block: 'nearest' })
  }, [selectedArchive])

  function selectArchive(archive: VideoNoteArchiveEntry): void {
    if (selectedArchiveId === archive.id) {
      setArchiveSelection({ archiveId: null, versionId: null, activeResultTab: null })
      setMemoOpen(false)
      setVersionMenuOpen(false)
      setMoreMenuOpen(false)
      return
    }

    setArchiveSelection({
      archiveId: archive.id,
      versionId: archive.versions.at(-1)?.id ?? null,
      activeResultTab: null
    })
    setMemoOpen(false)
    setVersionMenuOpen(false)
    setMoreMenuOpen(false)
  }

  async function copyText(value: string, message: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value)
      onCopyFeedback?.({ tone: 'success', message })
    } catch (error) {
      onCopyFeedback?.({
        tone: 'error',
        message: error instanceof Error ? error.message : '复制失败。'
      })
    }
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
      setArchiveSelection({ archiveId: null, versionId: null, activeResultTab: null })
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
        setArchiveSelection({
          archiveId: selectedArchiveId,
          versionId: remainingVersion?.id ?? null,
          activeResultTab
        })
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

  function saveMemoDraft(nextMemo: string): void {
    if (!selectedVersion) return
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
    setArchiveSelection({
      archiveId: selectedArchiveId,
      versionId: selectedVersionId,
      activeResultTab: activeResultTab === tab ? null : tab
    })
  }

  async function generateSummary(version: VideoNoteArchiveVersion): Promise<void> {
    if (!deepSeekEnabled) {
      setStatusMessage('请先到设置启用 DeepSeek 后再生成总结。')
      return
    }

    if (!onGeneratePoster || summaryGenerating || !selectedArchive) return

    const archiveId = selectedArchive.id
    const requestAccountMid = accountMid

    setSummaryGenerating(true)
    setStatusMessage('')
    try {
      const poster = await onGeneratePoster(version.note)
      const archived = await onArchivePosterSummary?.(
        archiveId,
        version.id,
        version.note,
        poster
      )
      if (archived) {
        if (accountMidRef.current !== requestAccountMid) return
        const accountArchives = archivesForPanelAccount(archived.archives, requestAccountMid)
        const savedVersion = accountArchives.find((archive) => archive.id === archived.archiveId)
          ?.versions.find((candidate) => candidate.id === archived.versionId)
        if (!savedVersion) throw new Error('DeepSeek summary save did not return its archive version.')
        setLocalArchives(accountArchives)
        setArchiveSelection({
          archiveId: archived.archiveId,
          versionId: archived.versionId,
          activeResultTab: 'summary'
        })
      } else {
        throw new Error('DeepSeek 总结未能保存为新版本。')
      }
      setStatusMessage('DeepSeek 总结已生成。')
    } catch (error) {
      setStatusMessage(formatDeepSeekErrorMessage(error, 'DeepSeek 总结生成失败。'))
    } finally {
      setSummaryGenerating(false)
    }
  }

  function openExportDialog(scope: 'current' | 'complete' = 'complete', currentContent?: ArchiveResultTab, formats: DownloadFormat[] = ['markdown']): void {
    if (!selectedArchive || !selectedVersion || !selectedArchive.source.accountMid || !/^\d+$/.test(selectedArchive.source.accountMid)) return
    setBatchExport({
      accountMid: selectedArchive.source.accountMid,
      selections: [{ archiveId: selectedArchive.id, versionId: selectedVersion.id }],
      hasNotes: Boolean(selectedVersion.note.userMemo.trim() || selectedVersion.note.annotations.length),
      scope,
      currentContent,
      formats
    })
  }

  function leaveBatchMode(): void {
    setBatchMode(false)
    archiveSelection.clear()
  }

  function openBatchExportDialog(): void {
    const selectedArchiveIds = archiveSelection.getSelectedIds()
    const selectedIds = new Set(selectedArchiveIds)
    const selectedArchives = localArchives.filter((archive) => selectedIds.has(archive.id))
    const exportAccountMid = accountMid && /^\d+$/.test(accountMid)
      ? accountMid
      : selectedArchives.find((archive) => archive.source.accountMid && /^\d+$/.test(archive.source.accountMid))?.source.accountMid
    if (!exportAccountMid) return
    const exportable = selectedArchives.flatMap((archive) => {
      const latestVersion = archive.versions.at(-1)
      if (!latestVersion || archive.source.accountMid !== exportAccountMid) return []
      return [{ archive, latestVersion }]
    })
    setBatchExport({
      accountMid: exportAccountMid,
      selections: exportable.map(({ archive, latestVersion }) => ({ archiveId: archive.id, versionId: latestVersion.id })),
      hasNotes: exportable.some(({ latestVersion }) => Boolean(latestVersion.note.userMemo.trim() || latestVersion.note.annotations.length)),
      scope: 'complete',
      formats: ['markdown'],
      initialSkippedCount: selectedArchiveIds.length - exportable.length
    })
  }

  function renderResultTabs(): React.JSX.Element {
    return (
      <div
        className="video-notes__result-tabs video-note-archive__result-tabs"
        role="tablist"
        aria-label="档案文稿"
      >
        {archiveResultTabs.map((tab) => {
          const tooltip = `${tab.label}：${tab.description}`

          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeResultTab === tab.id}
              aria-controls={'video-note-archive-' + tab.id}
              id={'video-note-archive-tab-' + tab.id}
              title={tooltip}
              onClick={() => toggleResultTab(tab.id)}
            >
              <strong>{tab.label}</strong>
              <small>{tab.description}</small>
            </button>
          )
        })}
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
    const copyTextValue = activeResultTab === 'summary'
      ? normalizeNotePosterTextForDisplay(copyTextByTab.summary)
      : copyTextByTab[activeResultTab]
    const deepSeekCopyParts =
      createNotePosterCopyParts(version.summaryText)
    const preciseSummaryText = deepSeekCopyParts.summaryText.replace(/(?:^|\n)##\s+详细内容提要[\s\S]*$/u, '').trim()
    const unifiedCopyOptions = [
      { id: 'plain', label: '复制无时间线文稿', text: copyTextByTab.plain, message: '无时间线文稿已复制', disabled: !copyTextByTab.plain },
      { id: 'timed', label: '复制带时间线文稿', text: copyTextByTab.timed, message: '带时间线文稿已复制', disabled: !copyTextByTab.timed },
      { id: 'summary-full', label: '复制 DeepSeek 总结全文', text: normalizeNotePosterTextForDisplay(copyTextByTab.summary), message: '总结全文已复制', disabled: !copyTextByTab.summary },
      { id: 'divider', label: '', text: '', message: '', disabled: true },
      { id: 'summary-precise', label: '仅复制精准总结', text: preciseSummaryText, message: '精准总结已复制', disabled: !preciseSummaryText },
      { id: 'summary-outline', label: '仅复制详细内容提要', text: deepSeekCopyParts.detailedOutlineText, message: '详细内容提要已复制', disabled: !deepSeekCopyParts.detailedOutlineText },
      { id: 'summary-polished', label: '仅复制精修文稿', text: deepSeekCopyParts.polishedTranscriptText, message: '精修文稿已复制', disabled: !deepSeekCopyParts.polishedTranscriptText }
    ]
    const canGenerateSummary = activeResultTab === 'summary' && version.plainTranscript.trim()
    const summaryButtonLabel = version.summaryText.trim() ? '重新总结' : '生成总结'
    const canDownloadCurrent = Boolean(selectedArchive?.source.accountMid && /^\d+$/.test(selectedArchive.source.accountMid))
    const downloadCurrent = (formats: DownloadFormat[]) => openExportDialog('current', activeResultTab, formats)

    return (
      <section
        className="video-note-archive__result-panel porcelain-full-bleed-divider"
        role="tabpanel"
        id={'video-note-archive-' + activeResultTab}
        aria-labelledby={'video-note-archive-tab-' + activeResultTab}
      >
        <div className="video-notes__panel-header">
          <strong>{titleByTab[activeResultTab]}</strong>
          {activeResultTab === 'summary' ? (
            <div className="video-notes__panel-actions">
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
                menuLabel="复制"
                onCopy={copyText}
                options={unifiedCopyOptions}
              />
              <ExportButton groupLabel="档案 DeepSeek 总结导出" disabled={!canDownloadCurrent} title={!canDownloadCurrent ? '此历史档案缺少账号标识，无法安全导出文稿。' : undefined} onExport={() => downloadCurrent(['markdown'])} />
            </div>
          ) : (
            <div className="video-notes__panel-actions">
              <CopySplitButton
                groupLabel={`${titleByTab[activeResultTab]}复制`}
                menuLabel="复制"
                onCopy={copyText}
                options={unifiedCopyOptions}
              />
              <ExportButton groupLabel={`${titleByTab[activeResultTab]}导出`} disabled={!canDownloadCurrent} title={!canDownloadCurrent ? '此历史档案缺少账号标识，无法安全导出文稿。' : undefined} onExport={() => downloadCurrent(['markdown'])} />
            </div>
          )}
        </div>
        <div className="video-notes__result-body">
          {activeResultTab === 'timed' ? (
            <div className="video-notes__timeline" aria-label="带时间线文稿">
              {version.note.transcript.map((segment, index) => (
                <div className="video-notes__timeline-row" key={String(segment.start ?? 'unknown') + '-' + index}>
                  {isValidTimestamp(segment.start) && onSeekSource && selectedArchive ? (
                    <button
                      type="button"
                      className="video-note-archive__timestamp-button"
                      onClick={() => onSeekSource(selectedArchive.source, segment.start!)}
                    >
                      {formatTimestamp(segment.start)}
                    </button>
                  ) : (
                    <time>{formatTimestamp(segment.start)}</time>
                  )}
                  <p>{segment.text}</p>
                </div>
              ))}
            </div>
          ) : activeResultTab === 'summary' ? (
            version.summaryText ? (
              <>
                {extractMarkdownHeading(version.summaryText) ? (
                  <h4>{extractMarkdownHeading(version.summaryText)}</h4>
                ) : null}
                <pre>{copyTextValue}</pre>
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
        </div>
      </section>
    )
  }

  return (
    <section
      ref={archiveRootRef}
      className="video-note-archive"
      aria-label="全局档案库"
      data-result-expanded={activeResultTab ? 'true' : 'false'}
    >
      <div className="video-note-archive__history-card" data-batch-mode={batchMode ? 'true' : undefined}>
        <header className="video-note-archive__header">
          <div>
            <span>全局档案库</span>
            <h2>所有视频历史</h2>
          </div>
          <div className="video-note-archive__header-actions">
            {!batchMode ? <button type="button" disabled={!localArchives.length} onClick={() => setBatchMode(true)}>批量导出</button> : null}
            <button
              type="button"
              className="video-note-archive__return-button"
              onClick={onClose}
            >
              <span className="video-note-archive__return-label">返回</span>
              <img className="video-note-archive__return-pet" src={idlePetUrl} alt="小咪" />
              <span className="video-note-archive__return-label">札记</span>
            </button>
          </div>
        </header>

        <div className="video-note-archive__toolbar porcelain-full-bleed-divider">
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

        {batchMode ? <NoteSelectionSubscriber store={archiveSelection}>{({ ids: selectedIds, count }) => <div className="video-note-archive__batch-toolbar porcelain-full-bleed-divider">
          <span className="video-note-archive__batch-status">
            已选 {count} 项{[...selectedIds].filter((archiveId) => !filteredArchiveIds.has(archiveId)).length > 0 ? `，其中 ${[...selectedIds].filter((archiveId) => !filteredArchiveIds.has(archiveId)).length} 项不在当前筛选结果中` : ''}
          </span>
          <div className="video-note-archive__batch-actions">
            <button type="button" onClick={() => archiveSelection.replace(localArchives.map((archive) => archive.id))}>全选全部档案</button>
            <button type="button" aria-label="清除选择" disabled={!count} onClick={() => archiveSelection.clear()}>清除</button>
            <button type="button" aria-label="取消批量" onClick={leaveBatchMode}>取消</button>
            <button type="button" aria-label="导出所选档案" disabled={!count} onClick={openBatchExportDialog}>导出</button>
          </div>
        </div>}</NoteSelectionSubscriber> : null}

        <ul className="video-note-archive__list porcelain-full-bleed-divider" aria-label="视频列表">
          {filteredArchives.length > 0 ? (
            filteredArchives.map((archive) => {
              const latestVersion = getLatestVersion(archive)
              const isSelected = archive.id === selectedArchive?.id
              return (
                <li className="video-note-archive__list-item" key={archive.id}>
                  {batchMode ? <NoteSelectionCheckbox store={archiveSelection} id={archive.id} label={`选择档案：${archive.source.title}`} /> : null}
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
                      openArchiveSource(selectedArchive.source)
                    }}
                  >
                    {selectedArchive.source.title}
                  </a>
                </h3>
                <div ref={moreMenuRef} className="video-note-archive__more">
                  <button
                    ref={moreMenuTriggerRef}
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
                          openArchiveSource(selectedArchive.source)
                        }}
                      >
                        打开视频来源
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        disabled={!selectedArchive.source.accountMid || !/^\d+$/.test(selectedArchive.source.accountMid)}
                        onClick={() => {
                          setMoreMenuOpen(false)
                          openExportDialog('complete')
                        }}
                      >
                        导出完整档案
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
                  <span className="disclosure-arrow" aria-hidden="true">▾</span>
                </button>
                <select
                  className="video-note-archive__version-native"
                  aria-label="历史版本"
                  value={selectedVersion.id}
                  onChange={(event) =>
                    setArchiveSelection({
                      archiveId: selectedArchive.id,
                      versionId: event.target.value,
                      activeResultTab
                    })
                  }
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
                            setArchiveSelection({
                              archiveId: selectedArchive.id,
                              versionId: version.id,
                              activeResultTab
                            })
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
              <section className="video-note-archive__editor porcelain-full-bleed-divider" aria-label="备注">
                <label>
                  本地备注
                  <LocalMemoEditor
                    identity={selectedVersion.id}
                    value={selectedVersion.note.userMemo}
                    onCommit={saveMemoDraft}
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

      {statusMessage ? (
        <div className="video-notes__feedback" aria-live="polite">
          <p role="status">{statusMessage}</p>
        </div>
      ) : null}

      {batchExport && (!accountMid || batchExport.accountMid === accountMid) ? <VideoNoteBatchExportDialog
        open
        accountMid={batchExport.accountMid}
        selections={batchExport.selections}
        hasNotes={batchExport.hasNotes}
        initialSkippedCount={batchExport.initialSkippedCount}
        initialScope={batchExport.scope}
        currentContent={batchExport.currentContent}
        initialFormats={batchExport.formats}
        onClose={() => setBatchExport(null)}
        preview={(request) => window.bilimiDesktop.previewVideoNoteArchiveBatch?.(request) ?? Promise.resolve({ selectedCount: request.selections.length, exportableCount: 0, skippedCount: request.selections.length })}
        start={(request) => window.bilimiDesktop.startVideoNoteArchiveBatch?.(request) as Promise<{ folderPath?: string; succeededCount: number; skippedCount: number; failedCount: number }>}
        cancel={(input) => window.bilimiDesktop.cancelVideoNoteArchiveBatch?.(input) ?? Promise.resolve(false)}
        openFolder={(input) => window.bilimiDesktop.openVideoNoteArchiveBatchFolder?.(input) ?? Promise.resolve(undefined)}
        onProgress={subscribeBatchProgress}
      /> : null}

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
