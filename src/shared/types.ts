export type AssistantAction = '赏' | '赐' | '表' | '阅'

export type BrowserSurfaceModel = {
  src: string
  partition: string
  allowpopups: 'true'
}

export type BrowserTabModel = {
  id: string
  title: string
  url: string
}

export type RecommendationKind = 'funny' | 'knowledge' | 'story' | 'suspicious'

export type RecommendationLabel = {
  badge: '可赏' | '可阅' | '请陛下过目' | '慎入'
  summary: string
}

export type AssistantPreferences = {
  favoritesFolderName: string
  preferenceCounts: Record<RecommendationKind, number>
}

export type AssistantAutomationResult = {
  ok: boolean
  steps: string[]
  missingTargets: string[]
  message: string
}
