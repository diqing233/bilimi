import { BILIMI_LEDGER_PREFIX } from './constants'
import type { FavoriteLedger } from './types'

export { BILIMI_LEDGER_PREFIX } from './constants'

const DEFAULT_FAVORITE_LEDGER_DEFINITIONS = [
  ['animation', '动画', ['动画', '番剧', '国创', 'MAD', 'AMV']],
  ['game', '游戏', ['游戏', '电竞', '实况', '攻略', '单机']],
  ['kichiku', '鬼畜', ['鬼畜', '音MAD', '调教', '人力VOCALOID']],
  ['music', '音乐', ['音乐', '演奏', '翻唱', '乐器', '音乐现场']],
  ['dance', '舞蹈', ['舞蹈', '宅舞', '街舞', '翻跳']],
  ['movie-tv', '影视', ['影视', '电影', '电视剧', '影评', '剪辑']],
  ['entertainment', '娱乐', ['娱乐', '综艺', '明星', '搞笑', '整活']],
  ['knowledge', '知识', ['知识', '科普', '学习', '教程', '历史']],
  ['tech-digital', '科技数码', ['科技', '数码', '手机', '电脑', '硬件', '软件']],
  ['news', '资讯', ['资讯', '新闻', '热点', '时事']],
  ['food', '美食', ['美食', '探店', '烹饪', '做饭', '吃播']],
  ['inbox', '待分类', ['稍后', '待看', '暂存', '收藏']],
  ['sports', '体育运动', ['体育', '运动', '健身', '篮球', '足球']],
  ['fashion-beauty', '时尚美妆', ['时尚', '美妆', '穿搭', '护肤']],
  ['animal', '动物', ['动物', '宠物', '猫', '狗']],
  ['ai', '人工智能', ['人工智能', 'AI', '大模型', 'ChatGPT', 'AIGC']],
  ['short-drama', '小剧场', ['小剧场', '短剧', '剧情', '微电影']],
  ['car', '汽车', ['汽车', '新能源', '车评', '试驾']],
  ['home-property', '家装房产', ['家装', '房产', '装修', '买房']],
  ['travel', '旅游出行', ['旅游', '旅行', '出行', '攻略']],
  ['emotion', '情感', ['情感', '恋爱', '婚姻', '心理']],
  ['uhd', '超高清', ['超高清', '4K', '8K', 'HDR']],
  ['vlog', 'vlog', ['vlog', '日常', '生活记录']],
  ['outdoor', '户外潮流', ['户外', '露营', '潮流', '骑行']],
  ['rural', '三农', ['三农', '农村', '农业', '乡村']],
  ['life-interest', '生活兴趣', ['生活', '兴趣', '收纳', '家居']],
  ['podcast', '视频播客', ['播客', '访谈', '对谈', '聊天']],
  ['painting', '绘画', ['绘画', '画画', '插画', '板绘']],
  ['fitness', '健身', ['健身', '训练', '减脂', '增肌']],
  ['parenting', '亲子', ['亲子', '育儿', '儿童', '家庭']],
  ['life-tips', '生活经验', ['生活经验', '经验', '技巧', '避坑']],
  ['handmade', '手工', ['手工', '制作', 'DIY', '模型']],
  ['health', '健康', ['健康', '医学', '养生', '睡眠']],
  ['public-good', '公益', ['公益', '志愿', '环保', '救助']],
  ['documentary', '纪录片', ['纪录片', '纪实', '人文']]
] as const

const DEFAULT_ENABLED_LEDGER_IDS = new Set([
  'animation',
  'game',
  'kichiku',
  'music',
  'dance',
  'movie-tv',
  'entertainment',
  'knowledge',
  'tech-digital',
  'news',
  'food',
  'inbox'
])

const RETIRED_DEFAULT_FAVORITE_LEDGER_NAMES = new Set([
  'Bilimi·见闻增广',
  'Bilimi·茶余解颐',
  'Bilimi·影剧情长',
  'Bilimi·游艺演武',
  'Bilimi·市井烟火',
  'Bilimi·工巧器用',
  'Bilimi·歌舞清音',
  'Bilimi·暂存待阅'
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
