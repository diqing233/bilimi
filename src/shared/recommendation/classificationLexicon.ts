export type ClassificationSignalStrength = 'strong' | 'weak'

export type ClassificationEntityAlias = {
  canonical: string
  aliases: string[]
  ledgerId: string
}

export type ClassificationConceptCluster = {
  id: string
  ledgerId: string
  phrases: string[]
}

export const GAME_ENTITY_ALIASES: ClassificationEntityAlias[] = [
  { canonical: '原神', ledgerId: 'game', aliases: ['原神', 'genshin'] },
  {
    canonical: '崩坏：星穹铁道',
    ledgerId: 'game',
    aliases: ['崩坏：星穹铁道', '崩坏星穹铁道', '星穹铁道', '星铁', '崩铁', 'hsr']
  },
  { canonical: '崩坏3', ledgerId: 'game', aliases: ['崩坏3', '崩坏三', '崩三', '崩坏学园3'] },
  { canonical: '绝区零', ledgerId: 'game', aliases: ['绝区零', 'zzz'] },
  { canonical: '明日方舟', ledgerId: 'game', aliases: ['明日方舟', '方舟', '舟游'] },
  { canonical: '鸣潮', ledgerId: 'game', aliases: ['鸣潮'] },
  { canonical: '王者荣耀', ledgerId: 'game', aliases: ['王者荣耀', '王者'] },
  { canonical: '英雄联盟', ledgerId: 'game', aliases: ['英雄联盟', 'lol', '联盟'] },
  { canonical: '无畏契约', ledgerId: 'game', aliases: ['无畏契约', '瓦', '瓦罗兰特', 'valorant'] },
  { canonical: '我的世界', ledgerId: 'game', aliases: ['我的世界', 'minecraft', 'mc'] }
]

export const CONCEPT_CLUSTERS: ClassificationConceptCluster[] = [
  {
    id: 'knowledge',
    ledgerId: 'knowledge',
    phrases: ['科普', '常识', '冷知识', '小知识', '知识点', '原理', '讲解', '教程', '课程', '公开课', '学习']
  },
  {
    id: 'life',
    ledgerId: 'life-interest',
    phrases: ['生活攻略', '旅行攻略', '出行路线', '装修避坑', '收纳技巧', '做饭教程', '健身计划', '护肤步骤', '家居改造']
  },
  {
    id: 'movie-tv',
    ledgerId: 'movie-tv',
    phrases: ['影视剧情', '番剧剧情', '电影剧情', '剧情解析', '电影解说', '电视剧解说', '名场面', '角色分析', '演员访谈', '预告片']
  },
  {
    id: 'game',
    ledgerId: 'game',
    phrases: ['游戏攻略', '游戏剧情', '配队', '抽卡', '深渊', '通关', 'boss', '主线', '支线', '实况', '赛事']
  },
  {
    id: 'creative',
    ledgerId: 'creative-aesthetic',
    phrases: ['摄影教程', '调色', '构图', '绘画教程', '建模', '手作', '设计', '穿搭']
  },
  {
    id: 'music',
    ledgerId: 'music',
    phrases: ['翻唱', '演奏', 'mv', '现场', '舞台', '编曲', '作曲']
  },
  {
    id: 'entertainment',
    ledgerId: 'entertainment',
    phrases: ['整活', '吐槽', 'reaction', '综艺', '脱口秀', '搞笑', '鬼畜']
  }
]

export const WEAK_CLASSIFICATION_TERMS = ['攻略', '剧情', '教程', '教学', '入门', '实战', '测评', '剪辑', '解说', '名场面']
