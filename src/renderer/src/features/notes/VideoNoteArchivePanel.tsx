import { useEffect, useMemo, useState } from 'react'
import type { VideoNoteArchiveEntry, VideoNoteArchiveVersion } from '@shared/types'
import { searchVideoNoteArchives } from '@shared/videoNoteArchive'

type VideoNoteArchivePanelProps = {
  archives: VideoNoteArchiveEntry[]
  onClose: () => void
  onOpenSource: (url: string) => void
  onDeleteEntry: (archiveId: string) => Promise<void>
  onDeleteVersion: (archiveId: string, versionId: string) => Promise<void>
}

type PendingDelete =
  | { type: 'entry'; archiveId: string }
  | { type: 'version'; archiveId: string; versionId: string }

function getLatestVersion(archive: VideoNoteArchiveEntry): VideoNoteArchiveVersion | null {
  return archive.versions.at(-1) ?? null
}

function formatVersionLabel(version: VideoNoteArchiveVersion, index: number): string {
  return `v${index + 1} · ${new Date(version.createdAt).toLocaleString('zh-CN')}`
}

export function VideoNoteArchivePanel({
  archives,
  onClose,
  onOpenSource,
  onDeleteEntry,
  onDeleteVersion
}: VideoNoteArchivePanelProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [hasAnnotations, setHasAnnotations] = useState(false)
  const [hasMemo, setHasMemo] = useState(false)
  const [selectedArchiveId, setSelectedArchiveId] = useState<string | null>(archives[0]?.id ?? null)
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    archives[0]?.versions.at(-1)?.id ?? null
  )
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const [statusMessage, setStatusMessage] = useState('')
  const filteredArchives = useMemo(
    () => searchVideoNoteArchives(archives, { query, hasAnnotations, hasMemo }),
    [archives, hasAnnotations, hasMemo, query]
  )
  const selectedArchive =
    filteredArchives.find((archive) => archive.id === selectedArchiveId) ?? filteredArchives[0] ?? null
  const selectedVersion =
    selectedArchive?.versions.find((version) => version.id === selectedVersionId) ??
    selectedArchive?.versions.at(-1) ??
    null

  useEffect(() => {
    if (!selectedArchive && filteredArchives[0]) {
      setSelectedArchiveId(filteredArchives[0].id)
      setSelectedVersionId(filteredArchives[0].versions.at(-1)?.id ?? null)
      return
    }

    if (selectedArchive && !selectedVersion) {
      setSelectedVersionId(selectedArchive.versions.at(-1)?.id ?? null)
    }
  }, [filteredArchives, selectedArchive, selectedVersion])

  function selectArchive(archive: VideoNoteArchiveEntry): void {
    setSelectedArchiveId(archive.id)
    setSelectedVersionId(archive.versions.at(-1)?.id ?? null)
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
        <aside className="video-note-archive__list" aria-label="视频列表">
          {filteredArchives.length > 0 ? (
            filteredArchives.map((archive) => {
              const latestVersion = getLatestVersion(archive)
              const annotationCount = archive.versions.reduce(
                (count, version) => count + version.note.annotations.length,
                0
              )

              return (
                <button
                  key={archive.id}
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
              )
            })
          ) : (
            <p>没有匹配的档案。</p>
          )}
        </aside>

        {selectedArchive && selectedVersion ? (
          <article className="video-note-archive__detail">
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
              <button
                type="button"
                onClick={() => void copyText(selectedVersion.plainTranscript, '纯文稿已复制')}
              >
                复制纯文稿
              </button>
              <button
                type="button"
                onClick={() => void copyText(selectedVersion.summaryText, '总结已复制')}
              >
                复制总结
              </button>
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

            <section>
              <h4>纯文稿</h4>
              <p>{selectedVersion.plainTranscript || '暂无文稿。'}</p>
            </section>

            <section>
              <h4>总结</h4>
              <pre>{selectedVersion.summaryText}</pre>
            </section>

            <section>
              <h4>批注和备注</h4>
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
              {selectedVersion.note.userMemo ? <p>{selectedVersion.note.userMemo}</p> : null}
            </section>
          </article>
        ) : (
          <section className="video-note-archive__detail">
            <p>暂无档案。</p>
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
