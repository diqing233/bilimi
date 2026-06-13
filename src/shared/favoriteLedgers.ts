import { BILIMI_LEDGER_PREFIX } from './constants'
import type { FavoriteLedger } from './types'

export { BILIMI_LEDGER_PREFIX } from './constants'

const DEFAULT_FAVORITE_LEDGERS: FavoriteLedger[] = [
  {
    id: 'knowledge',
    displayName: 'Bilimi·见闻增广',
    keywords: ['知识', '科普', '学习', '教程', '历史'],
    enabled: true,
    priority: 10,
    isDefault: true
  },
  {
    id: 'humor',
    displayName: 'Bilimi·茶余解颐',
    keywords: ['搞笑', '幽默', '相声', '整活', '娱乐'],
    enabled: true,
    priority: 20,
    isDefault: true
  },
  {
    id: 'story',
    displayName: 'Bilimi·影剧情长',
    keywords: ['影视', '剧情', '电影', '动画', '番剧'],
    enabled: true,
    priority: 30,
    isDefault: true
  },
  {
    id: 'play',
    displayName: 'Bilimi·游艺演武',
    keywords: ['游戏', '电竞', '实况', '攻略', '桌游'],
    enabled: true,
    priority: 40,
    isDefault: true
  },
  {
    id: 'life',
    displayName: 'Bilimi·市井烟火',
    keywords: ['生活', '美食', '旅行', '日常', '家居'],
    enabled: true,
    priority: 50,
    isDefault: true
  },
  {
    id: 'craft',
    displayName: 'Bilimi·工巧器用',
    keywords: ['手工', '数码', '工具', '科技', '制作'],
    enabled: true,
    priority: 60,
    isDefault: true
  },
  {
    id: 'music',
    displayName: 'Bilimi·歌舞清音',
    keywords: ['音乐', '舞蹈', '演奏', '翻唱', '乐器'],
    enabled: true,
    priority: 70,
    isDefault: true
  },
  {
    id: 'inbox',
    displayName: 'Bilimi·暂存待阅',
    keywords: ['稍后', '待看', '暂存', '收藏'],
    enabled: true,
    priority: 80,
    isDefault: true
  }
]

const TOPIC_NAME_SUGGESTIONS: Record<string, string[]> = {
  摄影: ['光影留真', '镜里春秋', '取景小札'],
  编程: ['码艺札记', '机杼成文', '格物编修']
}

const DEFAULT_TOPIC_NAME_SUGGESTIONS = ['雅事新编', '案头清供', '珍闻小录']

function cloneLedger(ledger: FavoriteLedger): FavoriteLedger {
  return {
    ...ledger,
    keywords: [...ledger.keywords]
  }
}

export function createDefaultFavoriteLedgers(): FavoriteLedger[] {
  return DEFAULT_FAVORITE_LEDGERS.map(cloneLedger)
}

export function normalizeFavoriteLedgers(ledgers: FavoriteLedger[]): FavoriteLedger[] {
  const normalized = ledgers.map(cloneLedger)
  const existingLedgerIds = new Set(normalized.map((ledger) => ledger.id))

  for (const defaultLedger of DEFAULT_FAVORITE_LEDGERS) {
    if (!existingLedgerIds.has(defaultLedger.id)) {
      normalized.push(cloneLedger(defaultLedger))
    }
  }

  return normalized
}

export function favoriteLedgersById(ledgers: FavoriteLedger[]): Record<string, FavoriteLedger> {
  return Object.fromEntries(ledgers.map((ledger) => [ledger.id, ledger]))
}

export function favoriteLedgerNamesById(ledgers: FavoriteLedger[]): Record<string, string> {
  return Object.fromEntries(ledgers.map((ledger) => [ledger.id, ledger.displayName]))
}

export function isBilimiManagedLedgerName(name: string): boolean {
  return name.startsWith(BILIMI_LEDGER_PREFIX)
}

export function suggestFavoriteLedgerNames(topic: string): string[] {
  const suggestions = TOPIC_NAME_SUGGESTIONS[topic.trim()] ?? DEFAULT_TOPIC_NAME_SUGGESTIONS
  return suggestions.map((name) => `${BILIMI_LEDGER_PREFIX}${name}`)
}
