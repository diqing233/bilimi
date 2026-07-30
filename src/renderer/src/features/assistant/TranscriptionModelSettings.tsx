import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { TranscriptionGpuProbe, TranscriptionModelId, TranscriptionModelInstallation, TranscriptionModelInstallProgress } from '@shared/types'

type Props = {
  accountMid?: string
  selectedModelId: TranscriptionModelId
  models: TranscriptionModelInstallation[]
  onSelect: (id: TranscriptionModelId) => void
  onInstall?: (id: TranscriptionModelId, options?: { restart?: boolean }) => void | Promise<void>
  onCancel?: (id: TranscriptionModelId) => void
  onDelete?: (id: TranscriptionModelId) => void
  onImport?: (id: TranscriptionModelId) => void
  onMigrateLegacyWhisper?: () => void
  onRevalidate?: (id: TranscriptionModelId) => void
  onProbeGpu?: () => void
  gpuProbe?: TranscriptionGpuProbe
  progress?: TranscriptionModelInstallProgress
}

const LABELS: Record<TranscriptionModelId, string> = {
  'sensevoice-small': 'SenseVoiceSmall',
  'whisper-small': 'Whisper small',
  'faster-whisper-large-v3-turbo': 'faster-whisper large-v3-turbo',
  'faster-whisper-large-v3': 'faster-whisper large-v3'
}

const PURPOSES: Record<TranscriptionModelId, string> = {
  'sensevoice-small': '中文为主，支持中英日韩粤；速度最快；仅 CPU 转写',
  'whisper-small': '全语言通用；速度中等；仅 CPU 转写',
  'faster-whisper-large-v3-turbo': '全语言高质量；速度较快；CPU 可用，NVIDIA 显卡可启用 GPU 加速',
  'faster-whisper-large-v3': '全语言最高质量；速度较慢；CPU 可用，NVIDIA 显卡可启用 GPU 加速'
}

const HARDWARE: Record<TranscriptionModelId, string> = {
  'sensevoice-small': '仅 CPU 转写',
  'whisper-small': '仅 CPU 转写',
  'faster-whisper-large-v3-turbo': '仅 NVIDIA 显卡可启用 GPU 加速',
  'faster-whisper-large-v3': '仅 NVIDIA 显卡可启用 GPU 加速'
}

function bytesLabel(value: number) {
  return value > 0 ? transferBytesLabel(value) : '随运行时提供'
}

function transferBytesLabel(value: number) {
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`
  if (value < 1024 * 1024) return `${Math.max(0, value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function etaLabel(seconds: number | undefined) {
  if (!seconds || !Number.isFinite(seconds) || seconds < 10) return '正在估算'
  const minutes = Math.ceil(seconds / 60)
  return minutes < 60 ? `预计剩余 ${minutes} 分钟` : `预计剩余 ${Math.ceil(minutes / 60)} 小时`
}

const INSTALL_STAGE_LABELS: Record<TranscriptionModelInstallProgress['stage'], string> = {
  connecting: '正在连接下载源',
  downloading: '正在下载',
  'downloading-part': '正在下载分片',
  verifying: '正在校验文件',
  'merging-parts': '正在合并分片',
  installing: '正在安装',
  'validating-runtime': '正在验证运行时',
  available: '安装完成',
  failed: '下载或验证失败',
  canceled: '已暂停，可继续下载'
}

export function TranscriptionModelSettings({ accountMid, selectedModelId, models, onSelect, onInstall, onCancel, onDelete, onImport, onMigrateLegacyWhisper, onRevalidate, onProbeGpu, gpuProbe, progress }: Props) {
  const [candidate, setCandidate] = useState<TranscriptionModelId>(selectedModelId)
  const [installing, setInstalling] = useState<TranscriptionModelId | null>(null)
  const [installationError, setInstallationError] = useState<string | null>(null)
  const [confirmationModel, setConfirmationModel] = useState<TranscriptionModelInstallation | null>(null)
  const [deleteConfirmationModel, setDeleteConfirmationModel] = useState<TranscriptionModelInstallation | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number; maxHeight: number }>()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const focusFirstOptionOnOpenRef = useRef(false)
  const selected = models.find((model) => model.id === candidate)
  const canSelect = Boolean(accountMid && selected?.available)
  const installedModels = models.filter((model) => model.installed || model.bundled)
  const downloadableModels = models.filter((model) => !model.installed && !model.bundled)
  const selectedProgress = progress?.id === selected?.id ? progress : undefined
  const downloadActive = selectedProgress && !['available', 'failed', 'canceled'].includes(selectedProgress.stage)
  const anotherDownloadActive = progress && progress.id !== selected?.id && !['available', 'failed', 'canceled'].includes(progress.stage)

  function startInstallation(id: TranscriptionModelId, options?: { restart?: boolean }) {
    setInstallationError(null)
    setInstalling(id)
    const installation = options ? onInstall?.(id, options) : onInstall?.(id)
    if (installation && typeof installation.then === 'function') {
      void installation.catch((error: unknown) => {
        setInstallationError(error instanceof Error ? error.message : String(error))
      }).finally(() => setInstalling(null))
    } else {
      setInstalling(null)
    }
  }

  useEffect(() => setCandidate(selectedModelId), [selectedModelId])
  useEffect(() => {
    if (!menuOpen) return
    if (focusFirstOptionOnOpenRef.current) {
      focusFirstOptionOnOpenRef.current = false
      menuRef.current?.querySelector<HTMLButtonElement>("[role='option']")?.focus()
    }
    const reposition = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return
      const width = Math.min(480, window.innerWidth - 16)
      const viewportPadding = 8
      const gap = 6
      const menuMaxHeight = 360
      const belowTop = rect.bottom + gap
      const availableBelow = Math.max(0, window.innerHeight - belowTop - viewportPadding)
      const availableAbove = Math.max(0, rect.top - gap - viewportPadding)
      const openAbove = availableBelow < menuMaxHeight && availableAbove > availableBelow
      const maxHeight = Math.min(menuMaxHeight, openAbove ? availableAbove : availableBelow)
      setMenuPosition({
        top: openAbove ? Math.max(viewportPadding, rect.top - gap - maxHeight) : Math.max(viewportPadding, belowTop),
        left: Math.max(viewportPadding, Math.min(window.innerWidth - width - viewportPadding, rect.left + rect.width / 2 - width / 2)),
        maxHeight
      })
    }
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!triggerRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMenuOpen(false); triggerRef.current?.focus() }
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    reposition()
    return () => { document.removeEventListener('pointerdown', closeOnOutsidePointer); document.removeEventListener('keydown', closeOnEscape); window.removeEventListener('resize', reposition); window.removeEventListener('scroll', reposition, true) }
  }, [menuOpen])
  const modelStatus = (model: TranscriptionModelInstallation) =>
    model.available ? '已安装' : model.installed ? '已安装待验证' : model.resumable ? '已取消，可继续下载' : '未安装'
  const currentSuffix = (id: TranscriptionModelId) => id === selectedModelId ? '（当前模型）' : ''
  const modelSummary = (model: TranscriptionModelInstallation) => PURPOSES[model.id]
  const renderOption = (model: TranscriptionModelInstallation) => <button key={model.id} type="button" role="option" aria-selected={candidate === model.id} onClick={() => { setCandidate(model.id); setMenuOpen(false); triggerRef.current?.focus() }}><strong>{LABELS[model.id]}{currentSuffix(model.id)}</strong><span>{modelStatus(model)} · {bytesLabel(model.downloadBytes)}</span><small>{modelSummary(model)}</small></button>

  return <div className="assistant-settings__transcription-models">
    <p>选择当前账号使用的转写模型。</p>
    <button ref={triggerRef} type="button" className="assistant-settings__transcription-model-trigger" aria-haspopup="listbox" aria-expanded={menuOpen} aria-label={`转写模型：${LABELS[candidate]}${currentSuffix(candidate)}`} onClick={() => setMenuOpen((open) => !open)} onKeyDown={(event) => {
      if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        focusFirstOptionOnOpenRef.current = true
        setMenuOpen(true)
      }
    }}><span>{LABELS[candidate]}{currentSuffix(candidate)}</span><span className="assistant-settings__transcription-model-chevron" aria-hidden="true">⌄</span></button>
    {menuOpen ? createPortal(<div ref={menuRef} className="assistant-settings__transcription-model-menu" style={{ ...(menuPosition ?? { top: 8, left: 8, maxHeight: 360 }), boxSizing: 'border-box' }} role="listbox" aria-label="转写模型选项" tabIndex={-1}>{installedModels.length ? <div role="group" aria-label="已安装"><strong>已安装</strong>{installedModels.map(renderOption)}</div> : null}{downloadableModels.length ? <div role="group" aria-label="可下载"><strong>可下载</strong>{downloadableModels.map(renderOption)}</div> : null}</div>, document.body) : null}
    {selected?.runtimeFamily === 'faster-whisper' && selected.installed ? <div className="assistant-settings__transcription-gpu-status">
      <p aria-live="polite">{gpuProbe?.status === 'available'
        ? `GPU 加速已就绪 · ${gpuProbe.gpuName} · CUDA ${gpuProbe.computeType}`
        : `当前使用 CPU · ${gpuProbe?.reason ?? '正在检测 NVIDIA GPU…'}`}</p>
      {onProbeGpu ? <button type="button" className="assistant-settings__transcription-model-action" onClick={onProbeGpu}>重新检测 GPU</button> : null}
    </div> : null}
    {downloadActive ? <div className="assistant-settings__transcription-model-download" aria-live="polite">
      <p role="status" className="assistant-settings__transcription-model-progress">{INSTALL_STAGE_LABELS[selectedProgress.stage]}{selectedProgress.stage === 'downloading-part' && selectedProgress.partIndex && selectedProgress.partCount ? `分片 ${selectedProgress.partIndex}/${selectedProgress.partCount}` : selectedProgress.percentage !== undefined ? ` · ${selectedProgress.percentage}%` : ''}</p>
      {selectedProgress.receivedBytes !== undefined && selectedProgress.totalBytes !== undefined ? <><p className="assistant-settings__transcription-model-progress-detail">{transferBytesLabel(selectedProgress.receivedBytes)} / {transferBytesLabel(selectedProgress.totalBytes)}{selectedProgress.bytesPerSecond ? ` · ${transferBytesLabel(selectedProgress.bytesPerSecond)}/s · ${etaLabel(selectedProgress.etaSeconds)}` : ' · 正在估算'}</p><progress max={selectedProgress.totalBytes} value={selectedProgress.receivedBytes} aria-label="模型下载进度" /></> : <progress aria-label="模型下载进度" />}
      {selectedProgress.source ? <p>当前来源：{selectedProgress.source}</p> : null}
      {selectedProgress.sourceFallbackMessage ? <p>{selectedProgress.sourceFallbackMessage}</p> : null}
      <button type="button" className="assistant-settings__transcription-model-action" onClick={() => selected && onCancel?.(selected.id)}>取消下载</button>
    </div> : null}
    {!downloadActive ? <div className="assistant-settings__transcription-model-actions" data-testid="transcription-model-actions">
      {candidate !== selectedModelId && <button type="button" className="assistant-settings__transcription-model-select" disabled={!canSelect} onClick={() => onSelect(candidate)}>设为当前模型</button>}
      {!anotherDownloadActive && selected && !selected.installed && !selected.bundled && onInstall && (
        installing === selected.id
          ? <button type="button" className="assistant-settings__transcription-model-action" onClick={() => { onCancel?.(selected.id); setInstalling(null) }}>取消</button>
          : <><button type="button" className="assistant-settings__transcription-model-action assistant-settings__transcription-model-action--primary" onClick={() => selected.resumable ? startInstallation(selected.id) : setConfirmationModel(selected)}>{selected.resumable ? '继续下载' : installationError ? '继续/重试' : '下载'}</button>{selected.resumable || installationError ? <button type="button" className="assistant-settings__transcription-model-action" onClick={() => setConfirmationModel(selected)}>重新下载</button> : null}</>
      )}
      {selected && selected.installed && !selected.available && onRevalidate && (
        <button type="button" className="assistant-settings__transcription-model-action" onClick={() => onRevalidate(selected.id)}>验证模型</button>
      )}
      {selected?.migratable && onMigrateLegacyWhisper && (
        <button type="button" className="assistant-settings__transcription-model-action" onClick={onMigrateLegacyWhisper}>迁移到应用模型目录</button>
      )}
      {selected && selected.installed && selected.removable && selected.id !== selectedModelId && onDelete && (
        <button type="button" className="assistant-settings__transcription-model-action assistant-settings__transcription-model-action--danger" onClick={() => setDeleteConfirmationModel(selected)}>删除模型</button>
      )}
    </div> : null}
    {anotherDownloadActive ? <small>等待当前下载完成。</small> : null}
    {!downloadActive && selected && !selected.installed && onImport && (
      <button type="button" className="assistant-settings__transcription-model-action" onClick={() => onImport(selected.id)}>手动导入对应模型文件夹</button>
    )}
    {!accountMid && <small>登录 B 站后可为当前账号选择模型。</small>}
    {installationError && <p className="assistant-settings__transcription-model-error" role="alert">{installationError}</p>}
    {selectedProgress?.stage === 'failed' && selectedProgress.error && <p className="assistant-settings__transcription-model-error" role="alert">{selectedProgress.error}</p>}
    {confirmationModel ? <div className="assistant-settings__transcription-model-confirmation" role="dialog" aria-modal="true" aria-label="确认下载模型">
      <h3>确认下载 {LABELS[confirmationModel.id]}</h3>
      <p>{confirmationModel.resumable ? '重新下载会清除已保留的部分文件，无法继续下载。' : ''}</p>
      <p>下载 {bytesLabel(confirmationModel.downloadBytes)}，安装后占用 {bytesLabel(confirmationModel.installedBytes)}。</p>
      <p>{modelSummary(confirmationModel)}。</p>
      <details><summary>来源与许可</summary><p>{confirmationModel.id.startsWith('faster-whisper') ? '当前 GPU 加速仅支持 NVIDIA CUDA，AMD/Intel 使用 CPU。CUDA 不随模型下载，由 NVIDIA 单独提供。' : ''}</p><p>许可：{confirmationModel.license}。来源与署名：{confirmationModel.attribution}</p></details>
      <div>
        <button type="button" className="assistant-settings__transcription-model-action" onClick={() => setConfirmationModel(null)}>取消</button>
        <button type="button" className="assistant-settings__transcription-model-action assistant-settings__transcription-model-action--primary" onClick={() => { const { id, resumable } = confirmationModel; setConfirmationModel(null); startInstallation(id, resumable ? { restart: true } : undefined) }}>{confirmationModel.resumable ? '确认重新下载' : '确认下载'}</button>
      </div>
    </div> : null}
    {deleteConfirmationModel ? <div className="assistant-settings__transcription-model-confirmation" role="dialog" aria-modal="true" aria-label="确认删除模型">
      <h3>确认删除 {LABELS[deleteConfirmationModel.id]}</h3>
      <p>将释放约 {bytesLabel(deleteConfirmationModel.installedBytes)}。</p>
      <p>仅删除 bilimi 管理的模型文件：{deleteConfirmationModel.managedPath}</p>
      <div>
        <button type="button" className="assistant-settings__transcription-model-action" onClick={() => setDeleteConfirmationModel(null)}>取消</button>
        <button type="button" className="assistant-settings__transcription-model-action assistant-settings__transcription-model-action--danger" onClick={() => { onDelete?.(deleteConfirmationModel.id); setDeleteConfirmationModel(null) }}>确认删除</button>
      </div>
    </div> : null}
  </div>
}
