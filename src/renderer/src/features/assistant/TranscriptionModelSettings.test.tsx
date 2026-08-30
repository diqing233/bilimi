import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { TranscriptionModelSettings } from './TranscriptionModelSettings'

describe('TranscriptionModelSettings', () => {
  it('uses one porcelain model trigger and groups installed and downloadable choices in a popup listbox', () => {
    render(<TranscriptionModelSettings
      accountMid="100"
      selectedModelId="whisper-small"
      models={[
        { id: 'whisper-small', bundled: false, installed: true, available: true, version: 'fixed', runtimeFamily: 'whisper.cpp', license: 'MIT', attribution: 'whisper.cpp', downloadBytes: 487601967, installedBytes: 487601967 },
        { id: 'faster-whisper-large-v3-turbo', bundled: false, installed: false, available: false, version: 'fixed', runtimeFamily: 'faster-whisper', license: 'MIT', attribution: 'faster-whisper', downloadBytes: 1, installedBytes: 1 }
      ]}
      onSelect={vi.fn()}
    />)

    const trigger = screen.getByRole('button', { name: '转写模型：Whisper small（当前模型）' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'listbox')
    expect(screen.queryByRole('listbox', { name: '转写模型选项' })).not.toBeInTheDocument()
    fireEvent.click(trigger)
    expect(screen.getByRole('listbox', { name: '转写模型选项' })).toHaveTextContent('已安装')
    expect(screen.getByRole('listbox', { name: '转写模型选项' })).toHaveTextContent('可下载')
  })

  it('keeps each model size and hardware summary inside its dropdown option', () => {
    render(<TranscriptionModelSettings
      accountMid="100"
      selectedModelId="sensevoice-small"
      models={[{ id: 'sensevoice-small', bundled: false, installed: true, available: true, version: 'fixed', runtimeFamily: 'sensevoice', license: 'FunASR', attribution: 'SenseVoice', hardware: 'Windows x64 CPU', downloadBytes: 184530773, installedBytes: 298268065 }]}
      onSelect={vi.fn()}
    />)

    expect(screen.queryByText('已安装 · 176.0 MB')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /SenseVoiceSmall/ }))
    expect(screen.getByRole('option', { name: /SenseVoiceSmall/ })).toHaveTextContent('已安装 · 176.0 MB')
    expect(screen.getByRole('option', { name: /SenseVoiceSmall/ })).toHaveTextContent('中文为主，支持中英日韩粤；速度最快；仅 CPU 转写')
  })

  it('opens the model popup from the keyboard and returns focus on Escape', async () => {
    render(<TranscriptionModelSettings
      accountMid="100"
      selectedModelId="whisper-small"
      models={[{ id: 'whisper-small', bundled: false, installed: true, available: true, version: 'fixed', runtimeFamily: 'whisper.cpp', license: 'MIT', attribution: 'whisper.cpp', downloadBytes: 1, installedBytes: 1 }]}
      onSelect={vi.fn()}
    />)

    const trigger = screen.getByRole('button', { name: '转写模型：Whisper small（当前模型）' })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    const option = await screen.findByRole('option', { name: /Whisper small/ })
    await waitFor(() => expect(option).toHaveFocus())
    fireEvent.keyDown(option, { key: 'Escape' })
    expect(trigger).toHaveFocus()
  })

  it('opens a bottom-edge model popup above its trigger with its outer box constrained to the viewport', async () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    render(<TranscriptionModelSettings
      accountMid="100"
      selectedModelId="whisper-small"
      models={[{ id: 'whisper-small', bundled: false, installed: true, available: true, version: 'fixed', runtimeFamily: 'whisper.cpp', license: 'MIT', attribution: 'whisper.cpp', downloadBytes: 1, installedBytes: 1 }]}
      onSelect={vi.fn()}
    />)

    const trigger = screen.getByRole('button', { name: '转写模型：Whisper small（当前模型）' })
    Object.defineProperty(trigger, 'getBoundingClientRect', { configurable: true, value: () => ({ top: 700, bottom: 732, left: 100, width: 160 }) })
    fireEvent.click(trigger)

    await waitFor(() => expect(screen.getByRole('listbox', { name: '转写模型选项' })).toHaveStyle({ top: '334px', maxHeight: '360px', boxSizing: 'border-box' }))
  })

  it('keeps the model row concise while showing its download size', () => {
    render(<TranscriptionModelSettings
      accountMid="100"
      selectedModelId="sensevoice-small"
      models={[
        { id: 'sensevoice-small', bundled: true, installed: false, available: false, version: '2025-09-09', runtimeFamily: 'sensevoice', license: 'FunASR', attribution: 'SenseVoice', downloadBytes: 184530773, installedBytes: 298268065 }
      ]}
      onSelect={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: /SenseVoiceSmall/ }))
    expect(screen.getByRole('option', { name: /SenseVoiceSmall/ })).toHaveTextContent('未安装 · 176.0 MB')
  })

  it('shows the model purpose and required hardware without claiming SenseVoice is the default', () => {
    render(<TranscriptionModelSettings
      accountMid="100"
      selectedModelId="sensevoice-small"
      models={[
        { id: 'sensevoice-small', bundled: true, installed: false, available: false, version: '2025-09-09', runtimeFamily: 'sensevoice', license: 'FunASR', attribution: 'SenseVoice', downloadBytes: 184530773, installedBytes: 298268065, hardware: 'Windows x64 CPU' }
      ]}
      onSelect={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: /SenseVoiceSmall/ }))
    expect(screen.getByRole('option', { name: /SenseVoiceSmall/ })).toHaveTextContent('中文为主，支持中英日韩粤；速度最快；仅 CPU 转写')
  })

  it('keeps the selected large-model hardware note concise', () => {
    render(<TranscriptionModelSettings
      accountMid="100"
      selectedModelId="faster-whisper-large-v3"
      models={[
        { id: 'faster-whisper-large-v3', bundled: false, installed: true, available: true, version: 'fixed', runtimeFamily: 'faster-whisper', license: 'MIT', attribution: 'faster-whisper', downloadBytes: 1, installedBytes: 1 }
      ]}
      gpuProbe={{ modelId: 'faster-whisper-large-v3', status: 'cpu-only', reason: 'NVIDIA CUDA runtime was not detected.' }}
      onSelect={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: /faster-whisper large-v3/ }))
    expect(screen.getByRole('option', { name: /faster-whisper large-v3/ })).toHaveTextContent('全语言最高质量；速度较慢；CPU 可用，NVIDIA 显卡可启用 GPU 加速')
  })

  it('marks faster-whisper large-v3 as recommended and uses the shared svg chevron', () => {
    render(<TranscriptionModelSettings
      accountMid="100"
      selectedModelId="faster-whisper-large-v3"
      models={[{ id: 'faster-whisper-large-v3', bundled: false, installed: true, available: true, version: 'fixed', runtimeFamily: 'faster-whisper', license: 'MIT', attribution: 'faster-whisper', downloadBytes: 1, installedBytes: 1 }]}
      onSelect={vi.fn()}
    />)

    const trigger = screen.getByRole('button', { name: '转写模型：faster-whisper large-v3（推荐）（当前模型）' })
    expect(trigger.querySelector('svg.assistant-settings__transcription-model-chevron')).not.toBeNull()
    expect(trigger).not.toHaveTextContent('⌄')
    fireEvent.click(trigger)
    expect(screen.getByRole('option', { name: /faster-whisper large-v3（推荐）（当前模型）/ })).toBeInTheDocument()
  })

  it('explains language coverage and acceleration limits for every model', () => {
    render(<TranscriptionModelSettings
      accountMid="100"
      selectedModelId="sensevoice-small"
      models={[
        { id: 'sensevoice-small', bundled: false, installed: true, available: true, version: 'fixed', runtimeFamily: 'sensevoice', license: 'FunASR', attribution: 'SenseVoice', downloadBytes: 1, installedBytes: 1 },
        { id: 'whisper-small', bundled: false, installed: true, available: true, version: 'fixed', runtimeFamily: 'whisper.cpp', license: 'MIT', attribution: 'whisper.cpp', downloadBytes: 1, installedBytes: 1 },
        { id: 'faster-whisper-large-v3-turbo', bundled: false, installed: true, available: true, version: 'fixed', runtimeFamily: 'faster-whisper', license: 'MIT', attribution: 'faster-whisper', downloadBytes: 1, installedBytes: 1 }
      ]}
      onSelect={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: /SenseVoiceSmall/ }))
    expect(screen.getByRole('option', { name: /SenseVoiceSmall/ })).toHaveTextContent('中文为主，支持中英日韩粤；速度最快；仅 CPU 转写')
    expect(screen.getByRole('option', { name: /Whisper small/ })).toHaveTextContent('全语言通用；速度中等；仅 CPU 转写')
    expect(screen.getByRole('option', { name: /faster-whisper large-v3-turbo/ })).toHaveTextContent('全语言高质量；速度较快；CPU 可用，NVIDIA 显卡可启用 GPU 加速')
  })

  it('only permits selecting installed models for the current account', () => {
    const onSelect = vi.fn()
    render(<TranscriptionModelSettings
      accountMid="100"
      selectedModelId="whisper-small"
      models={[
        { id: 'sensevoice-small', bundled: true, installed: false, available: false, version: '2025-09-09', runtimeFamily: 'sensevoice', license: 'FunASR Model Open Source License Agreement v1.1', attribution: 'SenseVoice', downloadBytes: 0, installedBytes: 298268065 },
        { id: 'whisper-small', bundled: false, installed: true, available: true, version: 'fixed', runtimeFamily: 'whisper.cpp', license: 'MIT', attribution: 'whisper.cpp', downloadBytes: 487601967, installedBytes: 487601967 },
        { id: 'faster-whisper-large-v3-turbo', bundled: false, installed: true, available: true, version: 'fixed', runtimeFamily: 'faster-whisper', license: 'MIT', attribution: 'faster-whisper', downloadBytes: 1, installedBytes: 1 }
      ]}
      onSelect={onSelect}
    />)

    fireEvent.click(screen.getByRole('button', { name: '转写模型：Whisper small（当前模型）' }))
    fireEvent.click(screen.getByRole('option', { name: /SenseVoiceSmall/ }))
    expect(screen.getByRole('button', { name: '设为当前模型' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '转写模型：SenseVoiceSmall' }))
    fireEvent.click(screen.getByRole('option', { name: /faster-whisper large-v3-turbo/ }))
    expect(screen.getByRole('button', { name: '设为当前模型' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '设为当前模型' }))
    expect(onSelect).toHaveBeenCalledWith('faster-whisper-large-v3-turbo')
  })

  it('shows the current model as status rather than offering a native set-current action', () => {
    render(<TranscriptionModelSettings
      accountMid="100"
      selectedModelId="whisper-small"
      models={[
        { id: 'whisper-small', bundled: false, installed: true, available: true, version: 'fixed', runtimeFamily: 'whisper.cpp', license: 'MIT', attribution: 'whisper.cpp', downloadBytes: 1, installedBytes: 1 }
      ]}
      onSelect={vi.fn()}
    />)

    expect(screen.queryByRole('button', { name: '设为当前模型' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '转写模型：Whisper small（当前模型）' })).toBeInTheDocument()
  })

  it('offers deletion for a non-current model managed by bilimi and asks for confirmation', () => {
    const onDelete = vi.fn()
    render(<TranscriptionModelSettings
      accountMid="100"
      selectedModelId="whisper-small"
      models={[
        { id: 'whisper-small', bundled: false, installed: true, available: true, version: 'fixed', runtimeFamily: 'whisper.cpp', license: 'MIT', attribution: 'whisper.cpp', downloadBytes: 1, installedBytes: 1 },
        { id: 'sensevoice-small', bundled: false, installed: true, available: true, removable: true, managedPath: 'C:/bilimi/transcription-models/sensevoice-small', version: 'fixed', runtimeFamily: 'sensevoice', license: 'FunASR', attribution: 'SenseVoice', downloadBytes: 1, installedBytes: 298268065 }
      ]}
      onSelect={vi.fn()}
      onDelete={onDelete}
    />)

    fireEvent.click(screen.getByRole('button', { name: /Whisper small/ }))
    fireEvent.click(screen.getByRole('option', { name: /SenseVoiceSmall/ }))
    fireEvent.click(screen.getByRole('button', { name: '删除模型' }))
    expect(screen.getByRole('dialog', { name: '确认删除模型' })).toHaveTextContent('C:/bilimi/transcription-models/sensevoice-small')
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    expect(onDelete).toHaveBeenCalledWith('sensevoice-small')
  })

  it('places setting the current model and model management actions in one action row', () => {
    render(<TranscriptionModelSettings
      accountMid="100"
      selectedModelId="whisper-small"
      models={[
        { id: 'whisper-small', bundled: false, installed: true, available: true, version: 'fixed', runtimeFamily: 'whisper.cpp', license: 'MIT', attribution: 'whisper.cpp', downloadBytes: 1, installedBytes: 1 },
        { id: 'sensevoice-small', bundled: false, installed: true, available: true, removable: true, managedPath: 'C:/bilimi/transcription-models/sensevoice-small', version: 'fixed', runtimeFamily: 'sensevoice', license: 'FunASR', attribution: 'SenseVoice', downloadBytes: 1, installedBytes: 1 }
      ]}
      onSelect={vi.fn()}
      onDelete={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: /Whisper small/ }))
    fireEvent.click(screen.getByRole('option', { name: /SenseVoiceSmall/ }))
    const row = screen.getByTestId('transcription-model-actions')
    expect(row).toContainElement(screen.getByRole('button', { name: '设为当前模型' }))
    expect(row).toContainElement(screen.getByRole('button', { name: '删除模型' }))
  })

  it('offers legacy Whisper migration into the managed model directory', () => {
    const onMigrateLegacyWhisper = vi.fn()
    render(<TranscriptionModelSettings
      accountMid="100"
      selectedModelId="sensevoice-small"
      models={[
        { id: 'sensevoice-small', bundled: false, installed: true, available: true, version: 'fixed', runtimeFamily: 'sensevoice', license: 'FunASR', attribution: 'SenseVoice', downloadBytes: 1, installedBytes: 1 },
        { id: 'whisper-small', bundled: true, installed: true, available: true, migratable: true, version: 'fixed', runtimeFamily: 'whisper.cpp', license: 'MIT', attribution: 'whisper.cpp', downloadBytes: 1, installedBytes: 1 }
      ]}
      onSelect={vi.fn()}
      onMigrateLegacyWhisper={onMigrateLegacyWhisper}
    />)

    fireEvent.click(screen.getByRole('button', { name: /SenseVoiceSmall/ }))
    fireEvent.click(screen.getByRole('option', { name: /Whisper small/ }))
    fireEvent.click(screen.getByRole('button', { name: '迁移到应用模型目录' }))
    expect(onMigrateLegacyWhisper).toHaveBeenCalledOnce()
  })

  it('uses the porcelain action token for a selectable non-current model', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/renderer/src/styles.css'), 'utf8')

    expect(styles).toContain('.assistant-settings__transcription-model-select {')
    expect(styles).toContain('.assistant-settings__transcription-model-action {')
    expect(styles).toContain('.assistant-settings__transcription-model-action--danger {')
  })

  it('uses a standard blue outlined deletion action and a compact dropdown without a chevron divider', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/renderer/src/styles.css'), 'utf8')

    expect(styles).toContain('.assistant-settings__transcription-model-action--danger { border-color: rgba(31, 99, 181, .38);')
    expect(styles).toContain('width: min(480px, calc(100vw - 16px))')
    expect(styles).toContain('.assistant-settings__transcription-model-menu { position: fixed; z-index: 1000; width: min(480px, calc(100vw - 16px)); max-height: none; overflow: visible;')
    expect(styles).not.toContain('border-left: 1px dashed #90b7df')
    expect(styles).not.toContain('.assistant-settings__group--transcription { border-top: 0; }')
  })

  it('offers a verified download only for an uninstalled optional model', () => {
    const onInstall = vi.fn()
    render(<TranscriptionModelSettings
      accountMid="100"
      selectedModelId="whisper-small"
      models={[
        { id: 'sensevoice-small', bundled: true, installed: false, available: false, version: '2025-09-09', runtimeFamily: 'sensevoice', license: 'FunASR', attribution: 'SenseVoice', downloadBytes: 184530773, installedBytes: 298268065 },
        { id: 'whisper-small', bundled: false, installed: false, available: false, version: 'fixed', runtimeFamily: 'whisper.cpp', license: 'MIT', attribution: 'whisper.cpp', downloadBytes: 487601967, installedBytes: 487601967 }
      ]}
      onSelect={vi.fn()}
      onInstall={onInstall}
    />)

    fireEvent.click(screen.getByRole('button', { name: /Whisper small/ }))
    fireEvent.click(screen.getByRole('button', { name: '下载' }))
    expect(onInstall).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: '确认下载模型' })).toHaveTextContent('Whisper small')
    fireEvent.click(screen.getByRole('button', { name: '确认下载' }))
    expect(onInstall).toHaveBeenCalledWith('whisper-small')
    expect(screen.queryByRole('button', { name: '下载 SenseVoiceSmall' })).not.toBeInTheDocument()
  })

  it('offers SenseVoiceSmall download instead of treating a missing runtime as bundled', () => {
    const onInstall = vi.fn()
    render(<TranscriptionModelSettings
      accountMid="100"
      selectedModelId="sensevoice-small"
      models={[
        { id: 'sensevoice-small', bundled: false, installed: false, available: false, version: '2025-09-09', runtimeFamily: 'sensevoice', license: 'FunASR', attribution: 'SenseVoice', downloadBytes: 184530773, installedBytes: 298268065 }
      ]}
      onSelect={vi.fn()}
      onInstall={onInstall}
    />)

    fireEvent.click(screen.getByRole('button', { name: '下载' }))
    fireEvent.click(screen.getByRole('button', { name: '确认下载' }))
    expect(onInstall).toHaveBeenCalledWith('sensevoice-small')
  })

  it('keeps CUDA and license details behind the download confirmation disclosure', () => {
    render(<TranscriptionModelSettings
      accountMid="100"
      selectedModelId="faster-whisper-large-v3"
      models={[{ id: 'faster-whisper-large-v3', bundled: false, installed: false, available: false, version: 'fixed', runtimeFamily: 'faster-whisper', license: 'MIT', attribution: 'faster-whisper', downloadBytes: 3090835702, installedBytes: 3090835702 }]}
      onSelect={vi.fn()}
      onInstall={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: '下载' }))
    const confirmation = screen.getByRole('dialog', { name: '确认下载模型' })
    expect(confirmation).toHaveTextContent('来源与许可')
    fireEvent.click(screen.getByText('来源与许可'))
    expect(confirmation).toHaveTextContent('当前 GPU 加速仅支持 NVIDIA CUDA，AMD/Intel 使用 CPU。CUDA 不随模型下载，由 NVIDIA 单独提供。')
    expect(confirmation).toHaveTextContent('许可：MIT。来源与署名：faster-whisper')
  })

  it('offers deletion for a selected managed optional model', () => {
    const onDelete = vi.fn()
    render(<TranscriptionModelSettings
      accountMid="100"
      selectedModelId="whisper-small"
      models={[
        { id: 'whisper-small', bundled: false, installed: true, available: true, version: 'fixed', runtimeFamily: 'whisper.cpp', license: 'MIT', attribution: 'whisper.cpp', downloadBytes: 487601967, installedBytes: 487601967 },
        { id: 'faster-whisper-large-v3', bundled: false, installed: true, available: true, removable: true, managedPath: 'C:/bilimi/transcription-models/faster-whisper-large-v3', version: 'fixed', runtimeFamily: 'faster-whisper', license: 'MIT', attribution: 'faster-whisper', downloadBytes: 1, installedBytes: 1 }
      ]}
      onSelect={vi.fn()}
      onDelete={onDelete}
    />)

    fireEvent.click(screen.getByRole('button', { name: /Whisper small/ }))
    fireEvent.click(screen.getByRole('option', { name: /faster-whisper large-v3/ }))
    expect(screen.getByRole('button', { name: '删除模型' })).toHaveClass('assistant-settings__transcription-model-action--danger')
    fireEvent.click(screen.getByRole('button', { name: '删除模型' }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    expect(onDelete).toHaveBeenCalledWith('faster-whisper-large-v3')
  })

  it('offers a local-folder import for any unavailable model without claiming it is installed', () => {
    const onImport = vi.fn()
    render(<TranscriptionModelSettings
      accountMid="100"
      selectedModelId="sensevoice-small"
      models={[
        { id: 'sensevoice-small', bundled: true, installed: false, available: false, version: '2025-09-09', runtimeFamily: 'sensevoice', license: 'FunASR', attribution: 'SenseVoice', downloadBytes: 184530773, installedBytes: 298268065 }
      ]}
      onSelect={vi.fn()}
      onImport={onImport}
    />)

    fireEvent.click(screen.getByRole('button', { name: '手动导入对应模型文件夹' }))
    expect(onImport).toHaveBeenCalledWith('sensevoice-small')
  })

  it('keeps the partial download resumable by exposing cancel while an optional download is active', () => {
    const onCancel = vi.fn()
    render(<TranscriptionModelSettings
      accountMid="100"
      selectedModelId="whisper-small"
      models={[
        { id: 'whisper-small', bundled: false, installed: false, available: false, version: 'fixed', runtimeFamily: 'whisper.cpp', license: 'MIT', attribution: 'whisper.cpp', downloadBytes: 487601967, installedBytes: 487601967 }
      ]}
      onSelect={vi.fn()}
      onInstall={() => new Promise(() => undefined)}
      onCancel={onCancel}
    />)

    fireEvent.click(screen.getByRole('button', { name: '下载' }))
    fireEvent.click(screen.getByRole('button', { name: '确认下载' }))
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onCancel).toHaveBeenCalledWith('whisper-small')
  })

  it('keeps a download failure actionable instead of silently returning to an unavailable state', async () => {
    render(<TranscriptionModelSettings
      accountMid="100"
      selectedModelId="whisper-small"
      models={[
        { id: 'whisper-small', bundled: false, installed: false, available: false, version: 'fixed', runtimeFamily: 'whisper.cpp', license: 'MIT', attribution: 'whisper.cpp', downloadBytes: 1, installedBytes: 1 }
      ]}
      onSelect={vi.fn()}
      onInstall={() => Promise.reject(new Error('Model download failed: source unreachable'))}
    />)

    fireEvent.click(screen.getByRole('button', { name: '下载' }))
    fireEvent.click(screen.getByRole('button', { name: '确认下载' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Model download failed: source unreachable')
    expect(screen.getByRole('button', { name: '继续/重试' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新下载' })).toBeInTheDocument()
  })

  it('shows streamed download progress, runtime validation, and a dedicated revalidation action', () => {
    const onRevalidate = vi.fn()
    render(<TranscriptionModelSettings
      accountMid="100"
      selectedModelId="whisper-small"
      models={[
        { id: 'whisper-small', bundled: false, installed: true, available: true, version: 'fixed', runtimeFamily: 'whisper.cpp', license: 'MIT', attribution: 'whisper.cpp', downloadBytes: 1, installedBytes: 1 },
        { id: 'faster-whisper-large-v3', bundled: false, installed: true, available: false, version: 'fixed', runtimeFamily: 'faster-whisper', license: 'MIT', attribution: 'faster-whisper', downloadBytes: 100, installedBytes: 100 }
      ]}
      onSelect={vi.fn()}
      onRevalidate={onRevalidate}
      progress={{ id: 'faster-whisper-large-v3', stage: 'downloading', receivedBytes: 50, totalBytes: 100, percentage: 50, bytesPerSecond: 25 }}
    />)

    fireEvent.click(screen.getByRole('button', { name: /Whisper small/ }))
    fireEvent.click(screen.getByRole('option', { name: /faster-whisper large-v3/ }))
    expect(screen.getByRole('status')).toHaveTextContent('正在下载')
    expect(screen.getByText('0.0 KB / 0.1 KB · 0.0 KB/s · 正在估算')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '取消下载' })).toBeInTheDocument()
  })

  it('shows cumulative model progress, a smoothed transfer estimate, source, and an explicit non-download stage', () => {
    render(<TranscriptionModelSettings
      accountMid="100"
      selectedModelId="whisper-small"
      models={[
        { id: 'whisper-small', bundled: false, installed: true, available: true, version: 'fixed', runtimeFamily: 'whisper.cpp', license: 'MIT', attribution: 'whisper.cpp', downloadBytes: 1, installedBytes: 1 },
        { id: 'faster-whisper-large-v3', bundled: false, installed: false, available: false, version: 'fixed', runtimeFamily: 'faster-whisper', license: 'MIT', attribution: 'faster-whisper', downloadBytes: 3090835702, installedBytes: 3090835702 }
      ]}
      onSelect={vi.fn()}
      progress={{ id: 'faster-whisper-large-v3', stage: 'merging-parts', receivedBytes: 1610612736, totalBytes: 3090835702, percentage: 52, bytesPerSecond: 8808038, etaSeconds: 180, source: 'ModelScope', sourceFallbackMessage: 'ModelScope 连接失败，正在尝试 GitHub Release' }}
    />)

    fireEvent.click(screen.getByRole('button', { name: /Whisper small/ }))
    fireEvent.click(screen.getByRole('option', { name: /faster-whisper large-v3/ }))
    expect(screen.getByRole('status')).toHaveTextContent('正在合并分片')
    expect(screen.getByText('1.5 GB / 2.9 GB · 8.4 MB/s · 预计剩余 3 分钟')).toBeInTheDocument()
    expect(screen.getByText('当前来源：ModelScope')).toBeInTheDocument()
    expect(screen.getByText('ModelScope 连接失败，正在尝试 GitHub Release')).toBeInTheDocument()
  })

  it('keeps the model chooser compact without a repeated section heading', () => {
    render(<TranscriptionModelSettings
      accountMid="100"
      selectedModelId="whisper-small"
      models={[{ id: 'whisper-small', bundled: false, installed: true, available: true, version: 'fixed', runtimeFamily: 'whisper.cpp', license: 'MIT', attribution: 'whisper.cpp', downloadBytes: 1, installedBytes: 1 }]}
      onSelect={vi.fn()}
    />)

    expect(screen.getByText('选择当前账号使用的转写模型。')).toBeInTheDocument()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })

  it('keeps the outer settings title and a full-width divider before CPU options', () => {
    const appSource = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/FloatingAssistantApp.tsx'), 'utf8')
    const styles = readFileSync(resolve(process.cwd(), 'src/renderer/src/styles.css'), 'utf8')

    expect(appSource).toContain('<legend>视频转写模型与 CPU 占用</legend>')
    expect(appSource).toContain('<div className="assistant-settings__transcription-cpu-divider" aria-hidden="true" />')
    expect(styles).toContain('.assistant-settings__transcription-cpu-divider {')
    expect(styles).toContain('border-top: var(--bilimi-divider);')
  })

  it('marks the current model beside its trigger and menu names instead of using a separate status badge', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/TranscriptionModelSettings.tsx'), 'utf8')
    const styles = readFileSync(resolve(process.cwd(), 'src/renderer/src/styles.css'), 'utf8')

    expect(source).toContain("const currentSuffix = (id: TranscriptionModelId) => id === selectedModelId ? '（当前模型）' : ''")
    expect(source).toContain('{LABELS[candidate]}{currentSuffix(candidate)}')
    expect(source).toContain('{LABELS[model.id]}{currentSuffix(model.id)}')
    expect(source).not.toContain('assistant-settings__transcription-model-current')
    expect(styles).not.toContain('.assistant-settings__group--transcription { border-top: 0; }')
  })

  it('does not create a model download queue when another model is active', () => {
    render(<TranscriptionModelSettings
      accountMid="100"
      selectedModelId="whisper-small"
      models={[
        { id: 'whisper-small', bundled: false, installed: true, available: true, version: 'fixed', runtimeFamily: 'whisper.cpp', license: 'MIT', attribution: 'whisper.cpp', downloadBytes: 1, installedBytes: 1 },
        { id: 'faster-whisper-large-v3', bundled: false, installed: false, available: false, version: 'fixed', runtimeFamily: 'faster-whisper', license: 'MIT', attribution: 'faster-whisper', downloadBytes: 100, installedBytes: 100 }
      ]}
      onSelect={vi.fn()}
      onInstall={vi.fn()}
      progress={{ id: 'faster-whisper-large-v3', stage: 'downloading', receivedBytes: 50, totalBytes: 100 }}
    />)

    expect(screen.getByText('等待当前下载完成。')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '下载' })).not.toBeInTheDocument()
  })

  it('shows the verified GPU and lets the user re-detect it', () => {
    const onProbeGpu = vi.fn()
    render(<TranscriptionModelSettings accountMid="100" selectedModelId="faster-whisper-large-v3-turbo"
      models={[{ id: 'faster-whisper-large-v3-turbo', bundled: false, installed: true, available: true, version: 'fixed', runtimeFamily: 'faster-whisper', license: 'MIT', attribution: 'faster-whisper', downloadBytes: 1, installedBytes: 1 }]}
      onSelect={vi.fn()} onProbeGpu={onProbeGpu}
      gpuProbe={{ modelId: 'faster-whisper-large-v3-turbo', status: 'available', device: 'cuda', computeType: 'float16', gpuName: 'NVIDIA GeForce RTX 4060 Ti', driverVersion: '595.97', memoryMiB: 8188, freeMemoryMiB: 6500 }} />)
    expect(screen.getByText('GPU 加速已就绪 · NVIDIA GeForce RTX 4060 Ti · CUDA float16')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新检测 GPU' }))
    expect(onProbeGpu).toHaveBeenCalledTimes(1)
  })

  it('shows the concrete CPU fallback reason instead of a capability claim', () => {
    render(<TranscriptionModelSettings accountMid="100" selectedModelId="faster-whisper-large-v3-turbo"
      models={[{ id: 'faster-whisper-large-v3-turbo', bundled: false, installed: true, available: true, version: 'fixed', runtimeFamily: 'faster-whisper', license: 'MIT', attribution: 'faster-whisper', downloadBytes: 1, installedBytes: 1 }]}
      onSelect={vi.fn()} gpuProbe={{ modelId: 'faster-whisper-large-v3-turbo', status: 'cpu-only', reason: 'CUDA 12 cuBLAS runtime is missing; CPU will be used.' }} />)
    expect(screen.getByText('当前使用 CPU · CUDA 12 cuBLAS runtime is missing; CPU will be used.')).toBeInTheDocument()
  })

  it('restores a restart-safe partial as an explicit continue download action', () => {
    const onInstall = vi.fn()
    render(<TranscriptionModelSettings
      accountMid="100"
      selectedModelId="whisper-small"
      models={[{ id: 'whisper-small', bundled: false, installed: false, resumable: true, available: false, version: 'fixed', runtimeFamily: 'whisper.cpp', license: 'MIT', attribution: 'whisper.cpp', downloadBytes: 1, installedBytes: 1 }]}
      onSelect={vi.fn()}
      onInstall={onInstall}
    />)

    fireEvent.click(screen.getByRole('button', { name: /Whisper small/ }))
    expect(screen.getByRole('option', { name: /Whisper small/ })).toHaveTextContent('已取消，可继续下载 · 0.0 KB')
    fireEvent.click(screen.getByRole('button', { name: '继续下载' }))
    expect(onInstall).toHaveBeenCalledWith('whisper-small')
  })

  it('requires confirmation before explicitly restarting and discarding a partial', () => {
    const onInstall = vi.fn()
    render(<TranscriptionModelSettings
      accountMid="100"
      selectedModelId="whisper-small"
      models={[{ id: 'whisper-small', bundled: false, installed: false, resumable: true, available: false, version: 'fixed', runtimeFamily: 'whisper.cpp', license: 'MIT', attribution: 'whisper.cpp', downloadBytes: 1, installedBytes: 1 }]}
      onSelect={vi.fn()}
      onInstall={onInstall}
    />)

    fireEvent.click(screen.getByRole('button', { name: '重新下载' }))
    expect(screen.getByRole('dialog', { name: '确认下载模型' })).toHaveTextContent('重新下载会清除已保留的部分文件，无法继续下载。')
    fireEvent.click(screen.getByRole('button', { name: '确认重新下载' }))
    expect(onInstall).toHaveBeenCalledWith('whisper-small', { restart: true })
  })
})
