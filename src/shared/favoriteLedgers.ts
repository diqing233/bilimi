import { BILIMI_LEDGER_PREFIX } from './constants'
import type { FavoriteLedger } from './types'

export { BILIMI_LEDGER_PREFIX } from './constants'

const DEFAULT_FAVORITE_LEDGER_DEFINITIONS = [
  [
    'knowledge',
    '知识学习',
    [
      '网课',
      '技能',
      '技能教程',
      '教程',
      '文史',
      '文史科普',
      '科普',
      '外语',
      '考试',
      '资料',
      '知识',
      '学习',
      '课程',
      '历史',
      '科技',
      '数码',
      '手机',
      '电脑',
      '硬件',
      '软件',
      'AI',
      '人工智能',
      '大模型',
      '工具',
      '编程',
      '开发',
      '前端',
      '后端',
      'React',
      'Vue',
      'Python',
      'JavaScript',
      '公开课',
      '论文',
      '入门',
      '教学',
      '实战',
      '测评'
    ]
  ],
  [
    'game',
    '游戏专区',
    [
      '游戏',
      '电竞',
      '攻略',
      '剧情',
      '实况',
      '解说',
      '游戏剪辑',
      '赛事',
      '单机',
      '手游',
      '主机',
      '主机游戏',
      'Steam',
      '关卡',
      '通关',
      '速通',
      'Boss',
      '配队',
      '玩法',
      '直播录像'
    ]
  ],
  [
    'movie-tv',
    '影视动漫',
    [
      '番剧',
      '二次元',
      '新番',
      '电影',
      '剧集',
      '电视剧',
      '动画解说',
      '动画',
      '国漫',
      '短片',
      '影视',
      '动漫',
      '影评',
      '剪辑',
      '剧情',
      '名场面',
      '纪录片',
      '电影解说',
      '电视剧解说',
      '预告',
      '片段',
      '幕后',
      '漫画',
      '漫改',
      '台词',
      '分镜'
    ]
  ],
  [
    'creative-aesthetic',
    '创意美学',
    [
      '绘画',
      '建模',
      '摄影',
      '调色',
      '穿搭',
      '美妆',
      '短片艺术',
      '手作',
      '手工',
      '设计',
      '插画',
      '板绘',
      '模型',
      '绘画教程',
      '摄影教程',
      '修图',
      '构图',
      '配色',
      'DIY',
      '艺术',
      '视觉',
      '建筑',
      '手帐'
    ]
  ],
  [
    'life-interest',
    '生活日常',
    [
      '美食',
      '健身',
      '运动',
      '家居',
      '护肤',
      '通勤',
      '家务',
      '家务技巧',
      '生活技巧',
      '做饭',
      '烹饪',
      '收纳',
      '日常',
      '探店',
      'vlog',
      '出行',
      '露营',
      '户外',
      '宠物',
      '健康',
      '医学',
      '养生',
      '减脂',
      '家装',
      '装修',
      '房产',
      '汽车',
      '新能源',
      '车评',
      '试驾',
      '篮球',
      '足球'
    ]
  ],
  [
    'music',
    '音乐舞台',
    [
      '歌曲',
      'MV',
      '翻唱',
      '乐器',
      '演奏',
      '演唱会',
      '纯音乐',
      '舞蹈',
      '音乐',
      '舞台',
      '音乐现场',
      '现场音乐',
      '演唱',
      '歌手',
      '乐队',
      '编曲',
      '作曲',
      '舞蹈混剪',
      '宅舞',
      '街舞',
      '音乐剧'
    ]
  ],
  [
    'entertainment',
    '搞笑杂谈',
    [
      '整活',
      '脱口秀',
      '吐槽',
      '短视频',
      '趣味科普',
      '萌宠',
      '搞笑',
      '杂谈',
      '鬼畜',
      '娱乐',
      '聊天',
      '综艺',
      '明星',
      'reaction',
      '挑战',
      '开箱',
      '名梗',
      '爆笑',
      '名场面'
    ]
  ],
  ['inbox', '暂存', ['稍后', '待看', '暂存', '收藏', '待分类']]
] as const

const DEFAULT_ENABLED_LEDGER_IDS = new Set([
  'knowledge',
  'game',
  'movie-tv',
  'creative-aesthetic',
  'life-interest',
  'music',
  'entertainment',
  'inbox'
])

const RETIRED_DEFAULT_FAVORITE_LEDGER_NAMES = new Set([
  'Bilimi·动画',
  'Bilimi·鬼畜',
  'Bilimi·音乐',
  'Bilimi·舞蹈',
  'Bilimi·影视',
  'Bilimi·娱乐',
  'Bilimi·知识',
  'Bilimi·资讯',
  'Bilimi·美食',
  'Bilimi·体育运动',
  'Bilimi·时尚美妆',
  'Bilimi·动物',
  'Bilimi·人工智能',
  'Bilimi·小剧场',
  'Bilimi·汽车',
  'Bilimi·家装房产',
  'Bilimi·旅游出行',
  'Bilimi·情感',
  'Bilimi·超高清',
  'Bilimi·vlog',
  'Bilimi·户外潮流',
  'Bilimi·三农',
  'Bilimi·生活兴趣',
  'Bilimi·视频播客',
  'Bilimi·绘画',
  'Bilimi·健身',
  'Bilimi·亲子',
  'Bilimi·生活经验',
  'Bilimi·番剧',
  'Bilimi·二次元',
  'Bilimi·番剧二次元',
  'Bilimi·游戏',
  'Bilimi·音乐舞蹈',
  'Bilimi·影视娱乐',
  'Bilimi·美食旅行',
  'Bilimi·生活消费',
  'Bilimi·运动健康',
  'Bilimi·科技数码',
  'Bilimi·健康',
  'Bilimi·公益',
  'Bilimi·见闻增广',
  'Bilimi·茶余解颐',
  'Bilimi·影剧情长',
  'Bilimi·游艺演武',
  'Bilimi·市井烟火',
  'Bilimi·工巧器用',
  'Bilimi·歌舞清音',
  'Bilimi·暂存待阅',
  'Bilimi·手工',
  'Bilimi·纪录片'
])

const DEFAULT_FAVORITE_LEDGERS: FavoriteLedger[] = DEFAULT_FAVORITE_LEDGER_DEFINITIONS.map(
  ([id, name, keywords], index) => ({
    id,
    displayName: `${BILIMI_LEDGER_PREFIX}${name}`,
    keywords: [...keywords],
    enabled: DEFAULT_ENABLED_LEDGER_IDS.has(id),
    priority: (index + 1) * 10,
    isDefault: true
  })
)

const TOPIC_NAME_SUGGESTIONS: Record<string, string[]> = {
  摄影: ['摄影', '摄影教程', '摄影灵感'],
  编程: ['编程', '编程教程', '开发工具']
}

const DEFAULT_TOPIC_NAME_SUGGESTIONS = ['精选收藏', '学习资料', '待整理']

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
  const normalized = ledgers
    .filter(
      (ledger) => !ledger.isDefault || !RETIRED_DEFAULT_FAVORITE_LEDGER_NAMES.has(ledger.displayName)
    )
    .map(cloneLedger)
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
