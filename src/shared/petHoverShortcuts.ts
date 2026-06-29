import type { AssistantAction } from './types'

export const PET_HOVER_SHORTCUT_LIMIT = 4

export type PetHoverShortcutId =
  | 'like'
  | 'favorite'
  | 'coin'
  | 'comment'
  | 'assistant'
  | 'transcribe'
  | 'library'
  | 'prepare-ledgers'
  | 'organize-old-favorites'

export type PetHoverShortcut = {
  id: PetHoverShortcutId
  label: string
  title: string
  action?: AssistantAction
  intent: 'video-action' | 'workspace'
}

export const PET_HOVER_SHORTCUTS: PetHoverShortcut[] = [
  { id: 'like', label: '赏', title: '轻赏此条', action: '赏', intent: 'video-action' },
  { id: 'favorite', label: '藏', title: '归入内库', action: '藏', intent: 'video-action' },
  { id: 'coin', label: '赐', title: '投币厚赏', action: '赐', intent: 'video-action' },
  { id: 'comment', label: '表', title: '拟奏短评', action: '表', intent: 'video-action' },
  { id: 'assistant', label: '咪', title: '打开小咪', intent: 'workspace' },
  { id: 'transcribe', label: '转', title: '转写音频', intent: 'workspace' },
  { id: 'library', label: '库', title: '打开档案库', intent: 'workspace' },
  { id: 'prepare-ledgers', label: '备', title: '备齐册目', intent: 'workspace' },
  { id: 'organize-old-favorites', label: '整', title: '整理旧藏', intent: 'workspace' }
]

export const DEFAULT_PET_HOVER_SHORTCUTS: PetHoverShortcutId[] = [
  'like',
  'coin',
  'assistant',
  'transcribe'
]

const PET_HOVER_SHORTCUT_IDS = new Set(PET_HOVER_SHORTCUTS.map((shortcut) => shortcut.id))

export function normalizePetHoverShortcuts(value: unknown): PetHoverShortcutId[] {
  if (!Array.isArray(value)) {
    return DEFAULT_PET_HOVER_SHORTCUTS
  }

  const normalized: PetHoverShortcutId[] = []

  for (const item of value) {
    if (
      typeof item === 'string' &&
      PET_HOVER_SHORTCUT_IDS.has(item as PetHoverShortcutId) &&
      !normalized.includes(item as PetHoverShortcutId)
    ) {
      normalized.push(item as PetHoverShortcutId)
    }

    if (normalized.length >= PET_HOVER_SHORTCUT_LIMIT) {
      break
    }
  }

  return normalized
}

export function resolvePetHoverShortcuts(value: unknown): PetHoverShortcut[] {
  const ids = normalizePetHoverShortcuts(value)

  return ids
    .map((id) => PET_HOVER_SHORTCUTS.find((shortcut) => shortcut.id === id))
    .filter((shortcut): shortcut is PetHoverShortcut => Boolean(shortcut))
}
