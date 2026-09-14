import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { installEditableContextMenu } from './editableContextMenu'

type ContextMenuParams = {
  isEditable: boolean
  x: number
  y: number
  editFlags?: {
    canUndo?: boolean
    canRedo?: boolean
    canCut?: boolean
    canCopy?: boolean
    canPaste?: boolean
    canSelectAll?: boolean
  }
}

function createWebContentsHost() {
  let listener: ((event: unknown, params: ContextMenuParams) => void) | undefined
  return {
    isDestroyed: () => false,
    on: vi.fn((_event: 'context-menu', nextListener: (event: unknown, params: ContextMenuParams) => void) => {
      listener = nextListener
    }),
    emit: (params: ContextMenuParams) => listener?.({}, params)
  }
}

describe('installEditableContextMenu', () => {
  it('opens standard editing roles for an editable target using Chromium edit flags', () => {
    const host = createWebContentsHost()
    const popup = vi.fn()
    const buildMenu = vi.fn(() => ({ popup }))

    installEditableContextMenu(host, { buildMenu })
    host.emit({
      isEditable: true,
      x: 12,
      y: 24,
      editFlags: {
        canUndo: true,
        canRedo: false,
        canCut: true,
        canCopy: true,
        canPaste: true,
        canSelectAll: true
      }
    })

    expect(buildMenu).toHaveBeenCalledWith([
      { role: 'undo', enabled: true },
      { role: 'redo', enabled: false },
      { type: 'separator' },
      { role: 'cut', enabled: true },
      { role: 'copy', enabled: true },
      { role: 'paste', enabled: true },
      { type: 'separator' },
      { role: 'selectAll', enabled: true }
    ])
    expect(popup).toHaveBeenCalledWith({ x: 12, y: 24 })
  })

  it('does not create a menu for a non-editable page target', () => {
    const host = createWebContentsHost()
    const buildMenu = vi.fn()

    installEditableContextMenu(host, { buildMenu })
    host.emit({ isEditable: false, x: 12, y: 24 })

    expect(buildMenu).not.toHaveBeenCalled()
  })

  it('installs the helper for both the application WebContents and WebView guests', () => {
    const source = readFileSync(resolve(import.meta.dirname, 'index.ts'), 'utf8')

    expect(source).toContain('installEditableContextMenu(win.webContents')
    const guestAttachmentStart = source.indexOf("win.webContents.on('did-attach-webview'")
    const guestAttachment = guestAttachmentStart === -1 ? '' : source.slice(guestAttachmentStart, guestAttachmentStart + 3_000)
    expect(guestAttachment).toContain('installEditableContextMenu(webContents')
  })
})
