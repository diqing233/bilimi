type EditableContextMenuEditFlags = {
  canUndo?: boolean
  canRedo?: boolean
  canCut?: boolean
  canCopy?: boolean
  canPaste?: boolean
  canSelectAll?: boolean
}

type EditableContextMenuParams = {
  isEditable: boolean
  x: number
  y: number
  editFlags?: EditableContextMenuEditFlags
}

type EditableContextMenuItem =
  | { role: 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll'; label: string; enabled: boolean }
  | { type: 'separator' }

type EditableContextMenuHost = {
  isDestroyed: () => boolean
  on: (event: 'context-menu', listener: (event: unknown, params: EditableContextMenuParams) => void) => void
}

type EditableContextMenuDependencies = {
  buildMenu: (template: EditableContextMenuItem[]) => { popup: (options: { x: number; y: number }) => void }
}

export function createEditableContextMenuTemplate(editFlags: EditableContextMenuEditFlags = {}): EditableContextMenuItem[] {
  return [
    { role: 'undo', label: '撤销', enabled: Boolean(editFlags.canUndo) },
    { role: 'redo', label: '重做', enabled: Boolean(editFlags.canRedo) },
    { type: 'separator' },
    { role: 'cut', label: '剪切', enabled: Boolean(editFlags.canCut) },
    { role: 'copy', label: '复制', enabled: Boolean(editFlags.canCopy) },
    { role: 'paste', label: '粘贴', enabled: Boolean(editFlags.canPaste) },
    { type: 'separator' },
    { role: 'selectAll', label: '全选', enabled: Boolean(editFlags.canSelectAll) }
  ]
}

export function installEditableContextMenu(
  webContents: EditableContextMenuHost,
  { buildMenu }: EditableContextMenuDependencies
) {
  webContents.on('context-menu', (_event, params) => {
    if (!params.isEditable || webContents.isDestroyed()) return
    buildMenu(createEditableContextMenuTemplate(params.editFlags)).popup({ x: params.x, y: params.y })
  })
}
