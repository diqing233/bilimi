import type { AssistantPreferences, DeepSeekGenerateRequest } from '../../src/shared/types'

export function canRunDeepSeekRequest(
  preferences: AssistantPreferences,
  kind: DeepSeekGenerateRequest['kind']
): boolean {
  switch (kind) {
    case 'review-comment':
      return preferences.deepseekCommentEnabled
    case 'note-poster':
      return preferences.deepseekAutoSummaryEnabled
    case 'pet-chat':
      return preferences.deepseekPetChatEnabled
    case 'favorite-daily-classify-review':
      return preferences.deepseekDailyClassificationEnabled
    case 'favorite-archive-organize':
      return preferences.deepseekArchiveOrganizationEnabled
  }
}

export function assertDeepSeekRequestEnabled(
  preferences: AssistantPreferences,
  kind: DeepSeekGenerateRequest['kind']
): void {
  if (!canRunDeepSeekRequest(preferences, kind)) {
    throw new Error('This DeepSeek feature is disabled.')
  }
}
