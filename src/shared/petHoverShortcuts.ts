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
  description: string
  action?: AssistantAction
  intent: 'video-action' | 'workspace'
}

export const PET_HOVER_SHORTCUTS: PetHoverShortcut[] = [
  {
    id: 'like',
    label: '赏',
    title: '轻赏此条',
    description: '一键点赞，并归类收藏到 bilimi',
    action: '赏',
    intent: 'video-action'
  },
  {
    id: 'favorite',
    label: '藏',
    title: '归入内库',
    description: '一键归类收藏，不点赞不投币',
    action: '藏',
    intent: 'video-action'
  },
  {
    id: 'coin',
    label: '赐',
    title: '投币厚赏',
    description: '一键三连',
    action: '赐',
    intent: 'video-action'
  },
  {
    id: 'comment',
    label: '表',
    title: '随机弹幕',
    description: '随机生成一条并直接发送，不改变设置',
    action: '表',
    intent: 'video-action'
  },
  {
    id: 'assistant',
    label: '咪',
    title: '打开小咪',
    description: '打开小咪功能窗口',
    intent: 'workspace'
  },
  {
    id: 'transcribe',
    label: '转',
    title: '转写音频',
    description: '将当前视频音频加入本地转写队列',
    intent: 'workspace'
  },
  {
    id: 'library',
    label: '库',
    title: '打开档案库',
    description: '打开档案库，查看已保存的札记',
    intent: 'workspace'
  },
  {
    id: 'prepare-ledgers',
    label: '备',
    title: '备齐册目',
    description: '创建或补齐 bilimi 专属收藏夹',
    intent: 'workspace'
  },
  {
    id: 'organize-old-favorites',
    label: '整',
    title: '整理旧藏',
    description: '打开掌库，开始整理旧藏',
    intent: 'workspace'
  }
]

export const DEFAULT_PET_HOVER_SHORTCUTS: PetHoverShortcutId[] = [
  'like',
  'coin',
  'comment',
  'transcribe'
]

const PET_HOVER_SHORTCUT_IDS = new Set(PET_HOVER_SHORTCUTS.map((shortcut) => shortcut.id))
export const PET_SORTABLE_HOVER_SHORTCUTS = PET_HOVER_SHORTCUTS.filter(
  (shortcut) =>
    shortcut.id !== 'assistant' &&
    shortcut.id !== 'library' &&
    shortcut.id !== 'prepare-ledgers' &&
    shortcut.id !== 'organize-old-favorites'
)
const PET_SORTABLE_HOVER_SHORTCUT_IDS = new Set(
  PET_SORTABLE_HOVER_SHORTCUTS.map((shortcut) => shortcut.id)
)

export function hasLegacyAssistantHoverShortcut(value: unknown): boolean {
  return Array.isArray(value) && value.includes('assistant')
}

export function normalizePetHoverShortcuts(value: unknown): PetHoverShortcutId[] {
  if (!Array.isArray(value)) {
    return DEFAULT_PET_HOVER_SHORTCUTS
  }

  const normalized: PetHoverShortcutId[] = []

  for (const item of value) {
    if (
      typeof item === 'string' &&
      PET_HOVER_SHORTCUT_IDS.has(item as PetHoverShortcutId) &&
      PET_SORTABLE_HOVER_SHORTCUT_IDS.has(item as PetHoverShortcutId) &&
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
