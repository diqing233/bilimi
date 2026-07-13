import { createDefaultFavoriteLedgers } from '@shared/favoriteLedgers'
import { parseFavoriteLedgerRules } from '@shared/favoriteLedgerConstraints'
import type {
  FavoriteLedger,
  FavoriteLedgerClassification,
  FavoriteLedgerClassificationDiagnostic
} from '@shared/types'
import {
  CONCEPT_CLUSTERS,
  GAME_ENTITY_ALIASES,
  WEAK_CLASSIFICATION_TERMS
} from './classificationLexicon'
import { normalizeClassificationText } from './classificationText'

export type VideoContentContext = {
  aid?: number
  title?: string
  author?: string
  description?: string
  pageText?: string
  tags?: string[]
  category?: string
}

const RISK_KEYWORDS = ['带货', '广告', '软广', '恰饭', '推广', '避雷', '割韭菜', '骗局', '夸大', '引流', '标题党']

const DEFAULT_LEDGER_KEYWORD_SUPPLEMENTS: Record<string, string[]> = {
  knowledge: ['软件教程', '效率'],
  'life-interest': ['探店', 'vlog'],
  entertainment: ['鬼畜']
}

const FIELD_WEIGHTS = {
  title: 2,
  author: 1.5,
  description: 1,
  pageText: 0.5,
  category: 2.5,
  tags: 3
} as const

type LedgerScore = {
  ledger: FavoriteLedger
  explicitScore: number
  matchedKeywords: string[]
  score: number
  strongSignals: string[]
  weakSignals: string[]
  entityAliases: string[]
  conceptClusters: string[]
  positiveRules: string[]
  negativeRules: string[]
}

type AmbiguousCombinationRule = {
  ledgerId: string
  contexts: string[]
  ambiguousTerms: string[]
  bonus: number
  label: string
}

type ReverseConstraintRule = {
  ledgerId: string
  contexts: string[]
  ambiguousTerms: string[]
  penalty: number
  label: string
  when?: (text: string, score: LedgerScore) => boolean
}

const EPISODE_PATTERN = /第[一二三四五六七八九十百千万0-9]+集/

const AMBIGUOUS_COMBINATION_RULES: AmbiguousCombinationRule[] = [
  {
    ledgerId: 'game',
    contexts: ['游戏', '电竞', 'steam', '手游', '单机'],
    ambiguousTerms: ['攻略', '剧情', '解说', '实况', '主线', '支线'],
    bonus: 8,
    label: '游戏实体/语境 + 攻略/剧情/解说/实况'
  },
  {
    ledgerId: 'movie-tv',
    contexts: ['电影', '番剧', '电视剧', '演员', '台词'],
    ambiguousTerms: ['剧情', '名场面', '解析'],
    bonus: 8,
    label: '影视语境 + 剧情/名场面/解析'
  },
  {
    ledgerId: 'life-interest',
    contexts: ['旅行', '城市', '签证', '酒店', '路线', '装修', '收纳', '护肤', '健身'],
    ambiguousTerms: ['攻略', '教程', '避坑'],
    bonus: 8,
    label: '生活语境 + 攻略/教程/避坑'
  },
  {
    ledgerId: 'knowledge',
    contexts: ['软件', '编程', '课程', '公开课', '原理', '科普', '数码', '工具'],
    ambiguousTerms: ['教程', '讲解', '入门', '测评'],
    bonus: 8,
    label: '知识语境 + 教程/讲解/入门/测评'
  },
  {
    ledgerId: 'creative-aesthetic',
    contexts: ['摄影', '绘画', '建模', '设计', '调色'],
    ambiguousTerms: ['教程', '入门'],
    bonus: 8,
    label: '创作语境 + 教程/入门'
  }
]

const REVERSE_CONSTRAINT_RULES: ReverseConstraintRule[] = [
  {
    ledgerId: 'game',
    contexts: ['旅行', '装修', '收纳', '护肤', '健身'],
    ambiguousTerms: ['攻略'],
    penalty: 6,
    label: '生活语境压低裸攻略的游戏解释'
  },
  {
    ledgerId: 'game',
    contexts: ['电影', '番剧', '电视剧', '第'],
    ambiguousTerms: ['剧情'],
    penalty: 6,
    label: '影视语境压低裸剧情的游戏解释'
  },
  {
    ledgerId: 'movie-tv',
    contexts: [],
    ambiguousTerms: ['剧情'],
    penalty: 8,
    label: '游戏实体压低裸剧情的影视解释',
    when: (text) => gameEntitySignalsInText(text).length > 0
  },
  {
    ledgerId: 'knowledge',
    contexts: ['消费', '护肤', '汽车', '美食', '车评', '试驾'],
    ambiguousTerms: ['测评'],
    penalty: 8,
    label: '消费语境压低裸测评的知识解释'
  }
]

function buildSearchText(context: VideoContentContext) {
  return normalizeClassificationText(
    [
      context.title,
      context.author,
      context.description,
      context.pageText,
      context.category,
      ...(context.tags ?? [])
    ]
      .filter(Boolean)
      .join(' ')
  )
}

function matchedKeywords(text: string, keywords: string[]) {
  return keywords.filter((keyword) => text.includes(normalizeClassificationText(keyword)))
}

function scoreKeywordFields(
  keywords: string[],
  fieldTexts: Array<{ text: string; weight: number }>,
  options: { scoreWeakTerms?: boolean } = {}
) {
  const matchedKeywords: string[] = []
  let score = 0

  for (const keyword of keywords) {
    const normalizedKeyword = normalizeClassificationText(keyword)
    const keywordScore = fieldTexts.reduce(
      (total, field) => (field.text.includes(normalizedKeyword) ? total + field.weight : total),
      0
    )

    if (keywordScore > 0) {
      matchedKeywords.push(keyword)
      score +=
        options.scoreWeakTerms && WEAK_CLASSIFICATION_TERMS.includes(keyword)
          ? 1.5
          : keywordScore
    }
  }

  return { matchedKeywords, score }
}

function scoreKeywords(context: VideoContentContext, keywords: string[]) {
  return scoreKeywordFields(
    keywords,
    [
      { text: normalizeClassificationText(context.title), weight: FIELD_WEIGHTS.title },
      { text: normalizeClassificationText(context.author), weight: FIELD_WEIGHTS.author },
      { text: normalizeClassificationText(context.description), weight: FIELD_WEIGHTS.description },
      { text: normalizeClassificationText(context.pageText), weight: FIELD_WEIGHTS.pageText },
      { text: normalizeClassificationText(context.category), weight: FIELD_WEIGHTS.category },
      {
        text: normalizeClassificationText((context.tags ?? []).join(' ')),
        weight: FIELD_WEIGHTS.tags
      }
    ],
    { scoreWeakTerms: true }
  )
}

function scoreExplicitContextKeywords(context: VideoContentContext, keywords: string[]) {
  return scoreKeywordFields(keywords, [
    { text: normalizeClassificationText(context.category), weight: FIELD_WEIGHTS.category },
    { text: normalizeClassificationText((context.tags ?? []).join(' ')), weight: FIELD_WEIGHTS.tags }
  ])
}

function ledgerKeywords(ledger: FavoriteLedger) {
  if (ledgerRuleType(ledger) === 'deepseek') {
    return []
  }

  return [
    ...parseFavoriteLedgerRules(ledger).localKeywords,
    ...(DEFAULT_LEDGER_KEYWORD_SUPPLEMENTS[ledger.id] ?? [])
  ]
}

function ledgerRuleType(ledger: FavoriteLedger) {
  return ledger.ruleType ?? 'keyword'
}

function weakSignalsInText(text: string) {
  return WEAK_CLASSIFICATION_TERMS.filter((term) =>
    text.includes(normalizeClassificationText(term))
  )
}

function entitySignalsForLedger(text: string, ledger: FavoriteLedger) {
  if (ledger.id !== 'game') {
    return []
  }

  return gameEntitySignalsInText(text)
}

function gameEntitySignalsInText(text: string) {
  return GAME_ENTITY_ALIASES.filter((entity) =>
    entity.aliases.some((alias) => text.includes(normalizeClassificationText(alias)))
  ).map((entity) => entity.canonical)
}

function conceptSignalsForLedger(text: string, ledger: FavoriteLedger) {
  return CONCEPT_CLUSTERS.filter(
    (cluster) =>
      cluster.ledgerId === ledger.id &&
      cluster.phrases.some(
        (phrase) =>
          !WEAK_CLASSIFICATION_TERMS.includes(phrase) &&
          text.includes(normalizeClassificationText(phrase))
      )
  ).map((cluster) => cluster.id)
}

function hasAny(text: string, signals: string[]) {
  return signals.some((signal) => text.includes(normalizeClassificationText(signal)))
}

function applyCombinationRules(text: string, score: LedgerScore) {
  for (const rule of AMBIGUOUS_COMBINATION_RULES) {
    const hasContext =
      hasAny(text, rule.contexts) ||
      (rule.ledgerId === 'game' && score.entityAliases.length > 0) ||
      (rule.ledgerId === 'movie-tv' && EPISODE_PATTERN.test(text))
    if (score.ledger.id === rule.ledgerId && hasContext && hasAny(text, rule.ambiguousTerms)) {
      score.score += rule.bonus
      score.strongSignals.push(rule.label)
      score.positiveRules.push(rule.label)
    }
  }

  for (const rule of REVERSE_CONSTRAINT_RULES) {
    const hasContext = hasAny(text, rule.contexts) || rule.when?.(text, score)
    if (score.ledger.id === rule.ledgerId && hasContext && hasAny(text, rule.ambiguousTerms)) {
      score.score -= rule.penalty
      score.negativeRules.push(rule.label)
    }
  }
}

function scoreLedger(context: VideoContentContext, ledger: FavoriteLedger): LedgerScore {
  const keywords = ledgerKeywords(ledger)
  const text = buildSearchText(context)
  const globalWeakSignals = weakSignalsInText(text)

  if (ledgerRuleType(ledger) === 'author') {
    const scored = scoreKeywordFields(keywords, [
      { text: normalizeClassificationText(context.author), weight: FIELD_WEIGHTS.author + 8 }
    ])
    return {
      ledger,
      explicitScore: 0,
      ...scored,
      strongSignals: scored.matchedKeywords,
      weakSignals: scored.matchedKeywords.filter((match) => globalWeakSignals.includes(match)),
      entityAliases: [],
      conceptClusters: [],
      positiveRules: [],
      negativeRules: []
    }
  }

  if (ledgerRuleType(ledger) === 'tag') {
    const scored = scoreKeywordFields(keywords, [
      {
        text: normalizeClassificationText((context.tags ?? []).join(' ')),
        weight: FIELD_WEIGHTS.tags + 7
      }
    ])
    return {
      ledger,
      explicitScore: 0,
      ...scored,
      strongSignals: scored.matchedKeywords,
      weakSignals: scored.matchedKeywords.filter((match) => globalWeakSignals.includes(match)),
      entityAliases: [],
      conceptClusters: [],
      positiveRules: [],
      negativeRules: []
    }
  }

  const scored = {
    ledger,
    explicitScore: scoreExplicitContextKeywords(context, keywords).score,
    ...scoreKeywords(context, keywords),
    strongSignals: [] as string[],
    weakSignals: globalWeakSignals,
    entityAliases: entitySignalsForLedger(text, ledger),
    conceptClusters: conceptSignalsForLedger(text, ledger),
    positiveRules: [] as string[],
    negativeRules: [] as string[]
  }

  if (scored.entityAliases.length > 0) {
    scored.score += scored.entityAliases.length * 18
    scored.strongSignals.push(...scored.entityAliases)
  }

  if (scored.conceptClusters.length > 0) {
    scored.score += scored.conceptClusters.length * 6
    scored.strongSignals.push(...scored.conceptClusters)
  }

  scored.strongSignals.push(
    ...scored.matchedKeywords.filter((match) => !globalWeakSignals.includes(match))
  )
  applyCombinationRules(text, scored)

  return scored
}

function inboxLedger(ledgers: FavoriteLedger[]) {
  return (
    ledgers.find((ledger) => ledger.id === 'inbox') ??
    createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'inbox')!
  )
}

function emptyDiagnostic(): FavoriteLedgerClassificationDiagnostic {
  return {
    score: 0,
    scoreGap: 0,
    confidence: 'low',
    lowConfidence: true,
    matchedKeywords: [],
    strongSignals: [],
    weakSignals: [],
    entityAliases: [],
    conceptClusters: [],
    positiveRules: [],
    negativeRules: []
  }
}

function confidenceForScore(score: LedgerScore, runnerUp?: LedgerScore) {
  const runnerUpScore = runnerUp?.score ?? 0
  const scoreGap = score.score - runnerUpScore
  const onlyWeakSignals =
    score.strongSignals.length === 0 &&
    score.weakSignals.length > 0 &&
    score.matchedKeywords.every((match) => score.weakSignals.includes(match))

  if (onlyWeakSignals || score.score < 7 || scoreGap < 2.5 || score.negativeRules.length > 0) {
    return 'low'
  }

  if (score.score >= 10 && scoreGap >= 3 && score.strongSignals.length > 0) {
    return 'high'
  }

  return 'medium'
}

function diagnosticForScore(score: LedgerScore, runnerUp?: LedgerScore): FavoriteLedgerClassificationDiagnostic {
  const confidence = confidenceForScore(score, runnerUp)
  const runnerUpScore = runnerUp?.score
  return {
    score: score.score,
    runnerUpLedgerId: runnerUp?.ledger.id,
    runnerUpScore,
    scoreGap: score.score - (runnerUpScore ?? 0),
    confidence,
    lowConfidence: confidence === 'low',
    matchedKeywords: score.matchedKeywords,
    strongSignals: Array.from(new Set(score.strongSignals)),
    weakSignals: Array.from(new Set(score.weakSignals)),
    entityAliases: Array.from(new Set(score.entityAliases)),
    conceptClusters: Array.from(new Set(score.conceptClusters)),
    positiveRules: Array.from(new Set(score.positiveRules)),
    negativeRules: Array.from(new Set(score.negativeRules))
  }
}

function rankedLedgerScores(context: VideoContentContext, ledgers: FavoriteLedger[]) {
  return ledgers
    .filter((ledger) => ledger.id !== 'inbox')
    .map((ledger) => scoreLedger(context, ledger))
    .filter(
      (entry) =>
        entry.score > 0 &&
        (entry.ledger.enabled || (entry.ledger.isDefault && entry.explicitScore > 0))
    )
    .sort((left, right) => {
      if (left.ledger.isDefault !== right.ledger.isDefault) {
        return left.ledger.isDefault ? 1 : -1
      }

      if (ledgerRuleType(left.ledger) !== ledgerRuleType(right.ledger)) {
        return ledgerRuleType(left.ledger) === 'keyword' ? 1 : -1
      }

      if (right.score !== left.score) {
        return right.score - left.score
      }

      if (right.matchedKeywords.length !== left.matchedKeywords.length) {
        return right.matchedKeywords.length - left.matchedKeywords.length
      }

      return left.ledger.priority - right.ledger.priority
    })
}

function classificationForScore(
  score: LedgerScore,
  runnerUp: LedgerScore | undefined,
  inbox: FavoriteLedger
): FavoriteLedgerClassification {
  const diagnostic = diagnosticForScore(score, runnerUp)

  if (score.ledger.isDefault && !score.ledger.enabled) {
    return {
      ledgerId: inbox.id,
      displayName: inbox.displayName,
      matchedKeywords: score.matchedKeywords,
      reviewRequired: true,
      suggestedLedgerId: score.ledger.id,
      suggestedDisplayName: score.ledger.displayName,
      diagnostic
    }
  }

  return {
    ledgerId: score.ledger.id,
    displayName: score.ledger.displayName,
    matchedKeywords: score.matchedKeywords,
    reviewRequired: false,
    diagnostic
  }
}

function strongestCompetingScore(scored: LedgerScore[], current: LedgerScore) {
  return scored
    .filter((entry) => entry.ledger.id !== current.ledger.id)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }
      if (right.matchedKeywords.length !== left.matchedKeywords.length) {
        return right.matchedKeywords.length - left.matchedKeywords.length
      }
      return left.ledger.priority - right.ledger.priority
    })[0]
}

export function classifyVideoContentCandidates(
  context: VideoContentContext,
  ledgers: FavoriteLedger[] = createDefaultFavoriteLedgers()
): FavoriteLedgerClassification[] {
  const text = buildSearchText(context)
  const riskMatches = matchedKeywords(text, RISK_KEYWORDS)

  if (!text || riskMatches.length > 0) {
    return []
  }

  const inbox = inboxLedger(ledgers)
  const scored = rankedLedgerScores(context, ledgers)

  return scored.map((entry) => classificationForScore(entry, strongestCompetingScore(scored, entry), inbox))
}

export function classifyVideoContent(
  context: VideoContentContext,
  ledgers: FavoriteLedger[] = createDefaultFavoriteLedgers()
): FavoriteLedgerClassification {
  const text = buildSearchText(context)
  const inbox = inboxLedger(ledgers)
  const riskMatches = matchedKeywords(text, RISK_KEYWORDS)

  if (!text) {
    return {
      ledgerId: inbox.id,
      displayName: inbox.displayName,
      matchedKeywords: [],
      reviewRequired: false,
      diagnostic: emptyDiagnostic()
    }
  }

  if (riskMatches.length > 0) {
    return {
      ledgerId: inbox.id,
      displayName: inbox.displayName,
      matchedKeywords: riskMatches,
      reviewRequired: true,
      diagnostic: {
        ...emptyDiagnostic(),
        matchedKeywords: riskMatches,
        weakSignals: riskMatches,
        negativeRules: ['风险词进入暂存复核']
      }
    }
  }

  const scored = rankedLedgerScores(context, ledgers)
  const best = scored[0]
  const runnerUp = scored[1]

  if (!best) {
    return {
      ledgerId: inbox.id,
      displayName: inbox.displayName,
      matchedKeywords: [],
      reviewRequired: false,
      diagnostic: emptyDiagnostic()
    }
  }

  return classificationForScore(best, strongestCompetingScore(scored, best) ?? runnerUp, inbox)
}

export function buildVideoContentContextScript(): string {
  return `
    (() => {
      const readMeta = (name) =>
        document.querySelector('meta[name="' + name + '"],meta[property="' + name + '"]')?.getAttribute('content') || '';

      const readText = (selectors) =>
        selectors
          .map((selector) => Array.from(document.querySelectorAll(selector)).map((node) => node.textContent || '').join(' '))
          .filter(Boolean)
          .join(' ');
      const initialState = window.__INITIAL_STATE__ || {};
      const videoData = initialState.videoData || initialState.videoInfo || {};
      const aid = Number(videoData.aid || initialState.aid || 0);

      const tags = Array.from(
        document.querySelectorAll('.tag-link,.tag,.video-tag,[class*="tag"] a,[class*="tag"] span')
      )
        .map((node) => (node.textContent || '').replace(/\\s+/g, ' ').trim())
        .filter(Boolean)
        .slice(0, 20);

      return {
        aid: Number.isFinite(aid) && aid > 0 ? aid : undefined,
        title: document.querySelector('h1')?.textContent || document.title || '',
        author: document.querySelector('.up-name,.username,[class*="up-name"]')?.textContent || videoData.owner?.name || '',
        description: readMeta('description') || readText(['.desc-info-text', '.video-desc', '[class*="desc"]']),
        pageText: readText(['h1', '.video-info-title', '.video-desc', '.desc-info-text', '.up-info', '.tag-panel']),
        tags
      };
    })();
  `
}
