import { describe, expect, it } from 'vitest'
import {
  createCloseConfirmationOptions,
  resolveMainWindowCloseAction,
  type CloseConfirmationResult
} from './mainWindowCloseBehavior'
import type { AssistantPreferences } from './store'

function createPreferences(
  overrides: Partial<AssistantPreferences> = {}
): AssistantPreferences {
  return {
    favoritesFolderName: 'bilimi 内库',
    favoriteLedgers: [],
    ledgerPromptDismissed: false,
    petStyle: 'big-head',
    petHoverShortcuts: [],
    showPetAssistantShortcut: true,
    hidePetDuringVideoFullscreen: false,
    closeBehavior: 'exit-launcher',
    confirmBeforeExit: true,
    bilibiliOperationMode: 'api-assisted',
    favoriteArchiveMultiMode: 'off',
    favoriteArchiveStrategy: 'aggressive',
    favoriteCorrectionLearningEnabled: true,
    favoriteCorrectionLearningClassificationEnabled: true,
    favoriteCorrectionRecords: [],
    favoriteKeywordSuggestions: [],
    defaultCoinCount: 1,
    commentSubmitMode: 'random',
    videoAudioTranscriptionThreadLimit: 'unlimited',
    preferenceCounts: {},
    deepseekEnabled: false,
    deepseekApiKeyStored: false,
    deepseekCommentEnabled: false,
    deepseekAutoSummaryEnabled: false,
    deepseekPetChatEnabled: false,
    deepseekDailyClassificationEnabled: false,
    deepseekDailyClassificationMode: 'all',
    deepseekModel: 'deepseek-v4-flash',
    deepseekBaseUrl: 'https://api.deepseek.com',
    permissionOnboardingCompleted: true,
    assistantSidebarWidthPx: null,
    ...overrides
  }
}

describe('main window close behavior', () => {
  it('asks every time when tray minimization is not remembered', () => {
    const result = resolveMainWindowCloseAction({
      preferences: createPreferences({
        closeBehavior: 'minimize-to-tray',
        rememberCloseChoice: false
      })
    })

    expect(result).toEqual({ kind: 'confirm-before-exit' })
  })

  it('exits immediately when the selected close behavior is remembered', () => {
    const result = resolveMainWindowCloseAction({
      preferences: createPreferences({
        closeBehavior: 'exit-launcher',
        rememberCloseChoice: true
      })
    })

    expect(result).toEqual({ kind: 'exit-launcher' })
  })

  it('asks before exiting when the selected close behavior is not remembered', () => {
    const result = resolveMainWindowCloseAction({
      preferences: createPreferences({
        closeBehavior: 'exit-launcher',
        rememberCloseChoice: false
      })
    })

    expect(result).toEqual({ kind: 'confirm-before-exit' })
  })

  it('remembers tray minimization only when the owner confirms with remember choice checked', () => {
    const result = resolveMainWindowCloseAction({
      preferences: createPreferences(),
      confirmation: { response: 0, checkboxChecked: true }
    })

    expect(result).toEqual({
      kind: 'minimize-to-tray',
      preferencePatch: {
        closeBehavior: 'minimize-to-tray',
        rememberCloseChoice: true
      }
    })
  })

  it('remembers direct exit with the explicit remember field', () => {
    const result = resolveMainWindowCloseAction({
      preferences: createPreferences(),
      confirmation: { response: 1, checkboxChecked: true }
    })

    expect(result).toEqual({
      kind: 'exit-launcher',
      preferencePatch: {
        closeBehavior: 'exit-launcher',
        rememberCloseChoice: true
      }
    })
  })

  it('does not persist the selected action when remember choice is unchecked', () => {
    const confirmation: CloseConfirmationResult = { response: 1, checkboxChecked: false }
    const result = resolveMainWindowCloseAction({
      preferences: createPreferences(),
      confirmation
    })

    expect(result).toEqual({ kind: 'exit-launcher' })
  })

  it('cancels the native close when the owner cancels confirmation', () => {
    const result = resolveMainWindowCloseAction({
      preferences: createPreferences(),
      confirmation: { response: 2, checkboxChecked: true }
    })

    expect(result).toEqual({ kind: 'cancel' })
  })

  it('uses action-specific remember choice copy in the confirmation dialog', () => {
    expect(createCloseConfirmationOptions()).toMatchObject({
      title: '关闭 bilimi？',
      message: '关闭 bilimi？',
      buttons: ['最小化到托盘', '退出 bilimi', '取消'],
      defaultId: 0,
      cancelId: 2,
      checkboxLabel: '记住选择'
    })
    expect(createCloseConfirmationOptions().detail).toContain(
      '勾选“记住选择”后，下次点关闭将直接最小化。'
    )
    expect(createCloseConfirmationOptions().detail).toContain(
      '勾选“记住选择”后，下次点关闭将直接退出。'
    )
  })
})
