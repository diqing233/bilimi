import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { FavoriteLedger, VideoAudioTranscriptionQueueSnapshot } from '@shared/types'
import type { OldFavoriteWorkspaceSnapshot } from '@shared/oldFavoriteWorkspace'
import * as FloatingAssistantAppModule from './FloatingAssistantApp'
import { archiveSnapshotNeedsRefresh, archivesForCurrentAccount, canPublishVideoNoteArchiveLoad, createDeepSeekSummaryFeedback, createTranscriptionQueueFeedback, defaultFavoriteSystemToggleAvailable, favoriteLedgerReclassificationRequired, favoriteOrganizationStatus, findArchivedSummaryTextForNote, matchesCurrentVideoNote, resolveFavoriteOrganizationLamp, SETTINGS_JUMP_OPTIONS, settingsSectionScrollTop, statusLightNavigation, statusLightTooltip } from './FloatingAssistantApp'
import { createInitialAssistantPreferences } from '../state/assistantState'

const defaultLedger: FavoriteLedger = {
  id: 'knowledge', displayName: 'bilimi\u00b7\u77e5\u8bc6', keywords: [], enabled: true,
  priority: 10, isDefault: true
}

const emptyOverview = { shortSummary: [], keywords: [], timeline: [], highlights: [] }

function readFloatingAssistantAppRootSource(): string {
  const source = readFileSync(
    resolve(process.cwd(), 'src/renderer/src/features/assistant/FloatingAssistantApp.tsx'),
    'utf8'
  )
  const rootStart = source.indexOf('export function FloatingAssistantApp')
  return rootStart === -1 ? source : source.slice(rootStart)
}

function workspace(status: OldFavoriteWorkspaceSnapshot['status']): OldFavoriteWorkspaceSnapshot {
  return {
    version: 1, accountMid: '100', workspaceId: 'workspace', status, mode: 'incremental', scope: { kind: 'account' }, segmentSize: 2_000,
    hasMultipleSegments: false, scan: { phase: 'complete', failureCount: 0 }, sourceFolders: [],
    continuationCount: 0, segments: [], currentSegment: null, classifications: {},
    recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] }
  }
}

describe('resolveFavoriteOrganizationLamp', () => {
  it('exposes a bounded next-round old-favorite batch setting without changing the active draft', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/FloatingAssistantApp.tsx'), 'utf8')
    const start = source.indexOf('data-settings-section="old-favorite-batches"')
    const section = source.slice(start, source.indexOf('</fieldset>', start))
    const fieldStart = source.indexOf('const OldFavoriteBatchSizeField')
    const field = source.slice(fieldStart, source.indexOf('const SettingsWorkspaceContent', fieldStart))
    expect(section).toContain('当前草稿不会被重新切分')
    expect(section).toContain('2000 条（推荐）')
    expect(section).toContain('<OldFavoriteBatchSizeField')
    expect(field).toContain('type="radio"')
    expect(field).toContain('min={MIN_OLD_FAVORITE_WORKSPACE_SEGMENT_SIZE}')
    expect(field).toContain('max={MAX_OLD_FAVORITE_WORKSPACE_SEGMENT_SIZE}')
    expect(field).toContain('onBlur={commitDraft}')
    expect(field).toContain("event.key === 'Escape'")
    expect(section).toContain('onCommit={persistOldFavoriteBatchSize}')
  })

  it('routes a direct ledger-enabled intent through the narrow IPC without scanning the ledger array', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/FloatingAssistantApp.tsx'), 'utf8')
    const saveFunction = source.slice(
      source.indexOf('async function saveFavoriteLedgerEnabled'),
      source.indexOf('async function saveFavoriteLedgerRules')
    )

    expect(saveFunction).toContain('writeFavoriteLedgerEnabled')
    expect(saveFunction).not.toContain('favoriteLedgers')
    expect(saveFunction).not.toContain('JSON.stringify')
    expect(saveFunction).not.toContain('.find(')
    expect(saveFunction).not.toContain('.map(')
    expect(saveFunction).not.toContain('applyPreferenceSnapshot')
    expect(saveFunction).not.toContain('setPreferences')
    expect(saveFunction).not.toContain('requestAssistantSnapshot')
    expect(saveFunction).not.toContain('reclassify-favorite-configuration')
  })

  it('passes the direct enabled callback through the isolated ledger panel', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/FloatingAssistantApp.tsx'), 'utf8')
    const panelStart = source.indexOf('<LedgerWorkspacePanel')
    const panel = source.slice(panelStart, source.indexOf('/>', panelStart))
    expect(panel).toContain('onSaveLedgerEnabled={saveFavoriteLedgerEnabledForPanel}')
  })

  it('keeps ledger-enabled broadcasts outside the large assistant render tree', () => {
    const source = readFloatingAssistantAppRootSource()
    const effect = source.slice(
      source.indexOf('return window.bilimiDesktop?.onFavoriteLedgerEnabledChanged'),
      source.indexOf('const resolvedSnapshot')
    )

    expect(effect).toContain('applyIndexedFavoriteLedgerEnabledPatch')
    expect(effect).not.toContain('setPreferences')
    expect(effect).not.toContain('applyPreferenceSnapshot')
  })

  it('reclassifies ledger changes only for the active preview workspace of that account', () => {
    expect(favoriteLedgerReclassificationRequired(workspace('previewing'), '100')).toBe(true)
    expect(favoriteLedgerReclassificationRequired(workspace('completed'), '100')).toBe(false)
    expect(favoriteLedgerReclassificationRequired(workspace('previewing'), '200')).toBe(false)
    expect(favoriteLedgerReclassificationRequired(null, '100')).toBe(false)
  })

  it('uses the merged preference patch path for ledger saves instead of flushing the full tree', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/FloatingAssistantApp.tsx'), 'utf8')
    const saveFunction = source.slice(
      source.indexOf('async function saveFavoriteLedgerRules'),
      source.indexOf('async function setDefaultFavoriteSystemEnabled')
    )

    expect(saveFunction).toContain('scheduleAndWait')
    expect(saveFunction).not.toContain('persistPreferences(')
  })

  it('keeps ordinary ledger-rule saves local and reserves remote work for explicit sync', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/FloatingAssistantApp.tsx'), 'utf8')
    const saveFunction = source.slice(
      source.indexOf('async function saveFavoriteLedgerRules'),
      source.indexOf('async function setDefaultFavoriteSystemEnabled')
    )
    const syncFunction = source.slice(
      source.indexOf('async function syncFavoriteLedgers'),
      source.indexOf('async function retryQueuedVideoAudioTranscriptionOnCpu')
    )

    expect(saveFunction).not.toContain('saveFavoriteLedgers')
    expect(saveFunction).not.toContain('requestAssistantSnapshot')
    expect(saveFunction).not.toContain('reclassify-favorite-configuration')
    expect(syncFunction).toContain('saveFavoriteLedgers')
  })

  it('lets the backup snapshot broadcast refresh the floating assistant once', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/FloatingAssistantApp.tsx'), 'utf8')
    const ensureFunction = source.slice(
      source.indexOf('async function ensureFavoriteLedgers()'),
      source.indexOf('async function saveFavoriteLedgers(')
    )

    expect(ensureFunction).not.toContain('requestAssistantSnapshot')
  })

  it('rolls back a failed ledger-rule patch only while that mutation is still current', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/FloatingAssistantApp.tsx'), 'utf8')
    const saveFunction = source.slice(
      source.indexOf('async function saveFavoriteLedgerRules'),
      source.indexOf('async function setDefaultFavoriteSystemEnabled')
    )

    expect(source).toContain('favoriteLedgerRuleMutationIdRef')
    expect(saveFunction).toContain('mutationId === favoriteLedgerRuleMutationIdRef.current')
  })

  it('keeps sidebar-width-only broadcasts out of the large assistant render tree', () => {
    const source = readFloatingAssistantAppRootSource()
    const effect = source.slice(
      source.indexOf('return window.bilimiDesktop?.onAssistantPreferencePatchChanged'),
      source.indexOf('const resolvedSnapshot')
    )

    expect(effect).toContain("key === 'assistantSidebarWidthPx' ||")
    expect(effect).toContain("key === 'petHoverShortcuts' ||")
    expect(effect).toContain("key === 'bilibiliConnectionMode'")
    expect(effect).not.toContain("key === 'deepseekApiKeyStored'")
  })

  it('broadcasts pet shortcut previews before the deferred persistence write', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/FloatingAssistantApp.tsx'), 'utf8')
    const persistFunction = source.slice(
      source.indexOf('function persistPetHoverShortcuts'),
      source.indexOf('function deleteCorrectionRecord')
    )

    expect(persistFunction).toContain('previewPreferencePatch?.(patch, meta)')
    expect(persistFunction.indexOf('previewPreferencePatch?.(patch, meta)')).toBeLessThan(
      persistFunction.indexOf('getPreferencePatchScheduler().schedule(patch)')
    )
  })

  it('scopes stale pet shortcut echoes to one settings-window session', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/FloatingAssistantApp.tsx'), 'utf8')
    const rootSource = readFloatingAssistantAppRootSource()
    const effect = rootSource.slice(
      rootSource.indexOf('return window.bilimiDesktop?.onAssistantPreferencePatchChanged'),
      rootSource.indexOf('const resolvedSnapshot')
    )
    const persistFunction = source.slice(
      source.indexOf('function persistPetHoverShortcuts'),
      source.indexOf('function deleteCorrectionRecord')
    )

    expect(source).toContain('createAssistantPreferenceOriginId')
    expect(source).toContain('petHoverShortcutOriginIdRef')
    expect(effect).toContain('meta?.originId === petHoverShortcutOriginIdRef.current')
    expect(effect).toContain('meta.mutationId <= latestPetHoverShortcutMutationIdRef.current')
    expect(persistFunction).toContain('originId: petHoverShortcutOriginIdRef.current')
    expect(source).not.toContain("originId: 'pet_shortcuts'")
  })

  it('uses one fixed chevron for the expandable global feedback row', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/FloatingAssistantApp.tsx'), 'utf8')
    const feedbackToggle = source.slice(
      source.indexOf('className="floating-assistant-global-status__feedback-toggle"'),
      source.indexOf('</button>', source.indexOf('className="floating-assistant-global-status__feedback-toggle"'))
    )

    expect(feedbackToggle).toContain('aria-expanded={globalFeedbackExpanded}')
    expect(feedbackToggle).toContain('className="floating-assistant-global-status__feedback-chevron"')
    expect(feedbackToggle).toContain('viewBox="0 0 16 16"')
    expect(feedbackToggle).toContain('d="m3 6 5 5 5-5"')
    expect(feedbackToggle).not.toContain('<span aria-hidden="true">')
  })

  it('makes the complete global feedback row the expand and collapse control', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/FloatingAssistantApp.tsx'), 'utf8')
    const feedbackToggle = source.slice(
      source.indexOf('className="floating-assistant-global-status__feedback-toggle"'),
      source.indexOf('</button>', source.indexOf('className="floating-assistant-global-status__feedback-toggle"'))
    )

    expect(feedbackToggle).toContain('className="floating-assistant-global-status__feedback-message"')
    expect(feedbackToggle).toContain('{displayedGlobalFeedbackMessage}')
  })

  it('keeps the native status tooltip only while the global feedback row is collapsed', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/FloatingAssistantApp.tsx'), 'utf8')

    expect(source).toContain('title={globalFeedbackExpanded ? undefined : displayedGlobalFeedbackMessage}')
  })

  it('expands global feedback into live tasks and recent transient history without changing navigation', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/FloatingAssistantApp.tsx'), 'utf8')

    expect(source).toContain('createPersistentStatusTasks({')
    expect(source).toContain('className="floating-assistant-global-status__menu"')
    expect(source).toContain('后台任务')
    expect(source).toContain('当前没有后台任务')
    expect(source).toContain('最近提示')
    expect(source).toContain("openSettingsSection('transcription')")
  })

  it('merges a transcription DeepSeek-summary phase into the transcription task instead of duplicating it', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/FloatingAssistantApp.tsx'), 'utf8')

    expect(source).toContain("runningItem.progress?.step === 'summarizing-deepseek'")
    expect(source).toContain('DeepSeek 总结中')
    expect(source).not.toContain('backgroundSummaryTasks')
    expect(source).not.toContain('transcription-summary:')
  })

  it('does not reload the full archive library for a generic assistant snapshot signal', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/FloatingAssistantApp.tsx'), 'utf8')
    const effect = source.slice(
      source.indexOf('return window.bilimiDesktop?.onAssistantSnapshotChanged'),
      source.indexOf('useEffect(() => window.bilimiDesktop?.onBilibiliAccountChanged')
    )

    expect(effect).toContain('loadSnapshot({ resetVideoNote: true })')
    expect(effect).not.toContain('loadVideoNoteArchives')
  })

  it('refreshes the empty local runtime when all local data is cleared in app', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/FloatingAssistantApp.tsx'), 'utf8')
    const effect = source.slice(
      source.indexOf('onLocalDataReset'),
      source.indexOf('onAssistantPreferencesChanged', source.indexOf('onLocalDataReset'))
    )

    expect(effect).toContain('setLocalDataInfo(null)')
    expect(effect).toContain('setLocalDataUnavailable(false)')
    expect(effect).toContain('loadSnapshot({ resetVideoNote: true })')
    expect(effect).toContain('refreshLocalDataInfo({ force: true, retryTransient: true })')
    expect(effect).toContain('localDataResetInProgress.current = true')
    expect(effect).toContain('localDataResetInProgress.current = false')
  })
  it('keeps DeepSeek feature toggles behind the post-paint settings field boundary', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/FloatingAssistantApp.tsx'), 'utf8')
    const deepSeekSwitches = source.slice(
      source.indexOf('className="assistant-settings__deepseek-switches"'),
      source.indexOf('<span>DeepSeek API')
    )

    expect(deepSeekSwitches.match(/<SettingsPreferenceCheckbox/g)).toHaveLength(5)
    expect(deepSeekSwitches).not.toContain('type="checkbox"')
  })

  it('does not normalize the complete preference tree for an ordinary DeepSeek field patch', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/FloatingAssistantApp.tsx'), 'utf8')
    const updateFunction = source.slice(
      source.indexOf('function updateDeepSeekPreference'),
      source.indexOf('function toggleDeepSeekEnabled')
    )

    expect(updateFunction).toContain('applyImmediatePreferencePatch')
    expect(updateFunction).not.toContain('createInitialAssistantPreferences')
  })

  it('restores layout through the focused sidebar layout API instead of assistant preferences', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/FloatingAssistantApp.tsx'), 'utf8')
    const restoreFunction = source.slice(
      source.indexOf('function restoreDefaultLayoutSize'),
      source.indexOf('async function copyDeepSeekRecommendation')
    )

    expect(restoreFunction).toContain('restoreDefaultLayoutSize?.()')
    expect(restoreFunction).toContain('saveAssistantSidebarWidth?.(null)')
    expect(restoreFunction).not.toContain('scheduleAndWait(patch)')
    expect(restoreFunction).not.toContain('assistantSidebarWidthPx: null')
    expect(restoreFunction).not.toContain('persistPreferences(')
    expect(restoreFunction).not.toContain('createInitialAssistantPreferences')
  })

  it('resets the focused sidebar layout together with the remaining assistant settings', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/FloatingAssistantApp.tsx'), 'utf8')
    const resetFunction = source.slice(
      source.indexOf('async function resetAssistantSettings'),
      source.indexOf('function restoreDefaultLayoutSize')
    )

    expect(resetFunction).toContain('saveAssistantSidebarWidth?.(null)')
  })

  it('uses themed confirmation dialogs instead of browser confirmations for settings resets', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/FloatingAssistantApp.tsx'), 'utf8')

    expect(source).not.toContain('window.confirm(')
    expect(source).toContain('<BilimiModal title="重置 DeepSeek？"')
    expect(source).toContain('<BilimiModal title="确认重置全部设置？"')
  })

  it('creates one shared feedback event for queued transcription start, completion, and failure', () => {
    const base = {
      id: 'queue-1', url: 'https://www.bilibili.com/video/BV1queue', title: '队列视频', bvid: 'BV1queue',
      createdAt: '2026-07-28T00:00:00.000Z', updatedAt: '2026-07-28T00:01:00.000Z'
    }
    const empty = { items: [], sessionCompletedCount: 0 } satisfies VideoAudioTranscriptionQueueSnapshot
    const running = { items: [{ ...base, status: 'running' as const }], sessionCompletedCount: 0 } satisfies VideoAudioTranscriptionQueueSnapshot
    const completed = { items: [{ ...base, status: 'completed' as const, archiveRegistrationStatus: 'registered' as const, archiveNoteId: 'archive-1', archiveVersionId: 'version-1' }], sessionCompletedCount: 1 } satisfies VideoAudioTranscriptionQueueSnapshot
    const failed = { items: [{ ...base, status: 'failed' as const, errorMessage: '音频下载失败。' }], sessionCompletedCount: 0 } satisfies VideoAudioTranscriptionQueueSnapshot

    expect(createTranscriptionQueueFeedback(empty, running)).toEqual({
      tone: 'progress', globalMessage: '已开始转写：队列视频', petMessage: '小咪已经开始转写「队列视频」。'
    })
    expect(createTranscriptionQueueFeedback(running, completed)).toEqual({
      tone: 'success', globalMessage: '转写完成，文稿已保存到档案库', petMessage: '「队列视频」转写完成，文稿已保存到档案库。'
    })
    expect(createTranscriptionQueueFeedback(running, failed)).toEqual({
      tone: 'error', globalMessage: '转写失败：队列视频', petMessage: '「队列视频」转写失败：音频下载失败。'
    })
  })

  it('reports cancellation as a distinct state without an undefined progress percentage', () => {
    const base = {
      id: 'queue-cancel', url: 'https://www.bilibili.com/video/BV1cancel', title: '待取消视频', bvid: 'BV1cancel',
      createdAt: '2026-07-28T00:00:00.000Z', updatedAt: '2026-07-28T00:01:00.000Z',
      status: 'running' as const, cancelRequested: true,
      progress: { step: 'canceling' as const, message: 'Canceling transcription.' }
    }
    const status = FloatingAssistantAppModule.resolveGlobalTranscriptionStatus(
      { items: [base], sessionCompletedCount: 0 },
      'faster-whisper-large-v3-turbo'
    )

    expect(status.label).toBe('取消中')
    expect(status.detail).not.toContain('undefined')
    expect(createTranscriptionQueueFeedback(
      { items: [{ ...base, cancelRequested: undefined, progress: undefined }], sessionCompletedCount: 0 },
      { items: [{ ...base, status: 'canceled' as const, cancelRequested: undefined, progress: undefined }], sessionCompletedCount: 0 }
    )).toMatchObject({ tone: 'success', globalMessage: '已取消转写：待取消视频' })
  })

  it('uses shared feedback messages for DeepSeek summary progress, completion, and failure', () => {
    expect(createDeepSeekSummaryFeedback('progress')).toEqual({
      tone: 'progress', globalMessage: 'DeepSeek 正在生成总结。', petMessage: '小咪正在整理 DeepSeek 总结。'
    })
    expect(createDeepSeekSummaryFeedback('success')).toEqual({
      tone: 'success', globalMessage: 'DeepSeek 总结已生成。', petMessage: 'DeepSeek 总结做好啦。'
    })
    expect(createDeepSeekSummaryFeedback('error', 'DeepSeek 服务不可用。')).toEqual({
      tone: 'error', globalMessage: 'DeepSeek 服务不可用。', petMessage: 'DeepSeek 服务不可用。'
    })
  })

  it('uses a neutral explanation for the transcription speed setting', () => {
    const descriptions = FloatingAssistantAppModule as unknown as {
      transcriptionSpeedSettingDescription?: () => string
    }

    expect(descriptions.transcriptionSpeedSettingDescription?.()).toBe(
      '用于平衡视频转写速度与 CPU 占用；限制越低，电脑越不容易卡，但转写会更慢。'
    )
  })

  it('maps all global status lights to their approved workspace destinations', () => {
    expect(statusLightNavigation('deepseek', 'review')).toEqual({ tab: 'settings', section: 'deepseek' })
    expect(statusLightNavigation('transcription', 'noteArchive')).toEqual({ tab: 'notes', view: 'notes' })
    expect(statusLightNavigation('ledger', 'notes')).toEqual({ tab: 'ledger' })
  })

  it('calculates an inner settings scroll position for status-light navigation', () => {
    expect(settingsSectionScrollTop({ top: 100 }, { top: 240 }, 80)).toBe(220)
    expect(settingsSectionScrollTop({ top: 100 }, { top: 60 }, 80)).toBe(40)
  })

  it('uses the settings scroll container when opening DeepSeek from a status light', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/FloatingAssistantApp.tsx'), 'utf8')
    const openSettings = source.slice(source.indexOf('function jumpToSettingsSection'), source.indexOf('function syncSettingsJumpFromScroll'))

    expect(openSettings).toContain('settingsSectionScrollTop(')
    expect(openSettings).toContain("behavior: 'auto'")
  })

  it('puts the copy-preserving reminder before the organizing status detail', () => {
    expect(statusLightTooltip({ label: '未备册', detail: '收藏夹：未备册。\n整理收藏：完成备册后可开始。', tone: 'error' })).toBe(
      '小咪提醒：同一个视频可以保存在多个收藏夹里。整理收藏会把视频复制添加到 bilimi 收藏夹，不会移出原有的普通 B 站收藏夹，主人放心使用吧～（bilimi 收藏夹和分类视频支持删除，但需谨慎操作呦）\n\n收藏夹：未备册。\n整理收藏：完成备册后可开始。'
    )
  })

  it('keeps the wait-confirmation detail concise across the status light and task menu', () => {
    expect(favoriteOrganizationStatus(workspace('previewing'))?.detail).not.toContain('小咪提醒')
  })

  it('renders a readable custom tooltip for status lights instead of a native title tooltip', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/FloatingAssistantApp.tsx'), 'utf8')
    const styles = readFileSync(resolve(process.cwd(), 'src/renderer/src/styles.css'), 'utf8')

    expect(source).toContain('floating-assistant-global-status__light-tooltip')
    expect(source).toContain('floating-assistant-global-status__light-label')
    expect(source).toContain('aria-describedby={tooltipId}')
    expect(source).not.toContain('title={statusLightTooltip(item)}')
    expect(styles).toContain('.floating-assistant-global-status__light-tooltip')
    expect(styles).toContain('.floating-assistant-global-status__light-label')
    expect(styles).toContain('white-space: pre-line')
    expect(styles).toContain('top: calc(100% + 8px)')
    expect(styles).toContain('max-height: min(50vh, 420px)')
    expect(styles).toMatch(/\.floating-assistant-global-status \{[^}]*position: relative;/)
    expect(styles).toMatch(/\.floating-assistant-global-status__light-tooltip \{[^}]*left: 50%;[^}]*translate: -50% 0;/)
    expect(styles).not.toContain('.floating-assistant-global-status__light:last-child .floating-assistant-global-status__light-tooltip')
    expect(styles).toMatch(/\.floating-assistant-global-status__light-tooltip \{[^}]*font-size: 12px;/)
    expect(styles).toMatch(/\.floating-assistant-global-status__light-tooltip \{[^}]*font-family: "Microsoft YaHei", "Segoe UI", sans-serif;[^}]*font-size: 12px;[^}]*font-weight: 500;[^}]*line-height: 1\.55;/)
    expect(styles).toMatch(/\.floating-assistant-global-status__light-tooltip \{[^}]*transition: opacity 120ms ease-out, visibility 0s linear 120ms;/)
    expect(styles).not.toMatch(/\.floating-assistant-global-status__light-tooltip \{[^}]*transform:/)
    expect(styles).toMatch(/\.floating-assistant-global-status__light \{[^}]*overflow: visible;/)
    expect(styles).toMatch(/\.floating-assistant-global-status__menu section > strong \{[^}]*color: var\(--porcelain-text\);[^}]*font-size: 13px;[^}]*font-weight: 700;/)
    expect(styles).toMatch(/\.floating-assistant-global-status__menu p \{[^}]*color: var\(--porcelain-muted\);[^}]*font-size: 12px;[^}]*font-weight: 500;/)
    expect(styles).toMatch(/\.floating-assistant-global-status__menu-task-label \{[^}]*color: var\(--porcelain-primary\);[^}]*font-size: 12px;[^}]*font-weight: 600;[^}]*text-decoration: underline;[^}]*text-underline-offset: 2px;/)
    expect(styles).toMatch(/\.floating-assistant-global-status__menu small \{[^}]*color: var\(--porcelain-muted\);[^}]*font-size: 12px;[^}]*font-weight: 500;[^}]*line-height: 1\.45;/)
    expect(styles).toMatch(/\.floating-assistant-global-status__menu \{[^}]*font-family: "Noto Serif SC", "Songti SC", "SimSun", serif;/)
  })

  it('removes Electron IPC wrappers from DeepSeek summary feedback', () => {
    expect(createDeepSeekSummaryFeedback(
      'error',
      "Error invoking remote method 'deepseek:generate': DeepSeekServiceError: DeepSeek 总结内容不完整：缺少标题。"
    )).toMatchObject({
      globalMessage: 'DeepSeek 总结内容不完整：缺少标题。',
      petMessage: 'DeepSeek 总结内容不完整：缺少标题。'
    })
  })

  it('puts the DeepSeek model and enabled feature abbreviations before a separate task section', () => {
    const preferences = createInitialAssistantPreferences({
      deepseekModel: 'deepseek-v4-pro',
      deepseekCommentEnabled: true,
      deepseekAutoSummaryEnabled: false,
      deepseekPetChatEnabled: true,
      deepseekDailyClassificationEnabled: true,
      deepseekArchiveOrganizationEnabled: false
    })

    const detail = FloatingAssistantAppModule.formatDeepSeekRuntimeDetail(preferences, [
      { id: 'classification:1', kind: 'classification', detail: '复核《测试视频》的分类' }
    ])

    expect(detail).toBe(
      '模型：deepseek-v4-pro · 已开启：趣评、宠物、批阅\n执行任务：\n• 复核《测试视频》的分类'
    )
    expect(detail).not.toContain('会生成候选弹幕')
    expect(detail).not.toContain('DeepSeek 工作中')
  })

  it('keeps the original full DeepSeek explanation for the status-light hover detail', () => {
    const preferences = createInitialAssistantPreferences({
      deepseekModel: 'deepseek-v4-pro',
      deepseekCommentEnabled: true,
      deepseekAutoSummaryEnabled: true,
      deepseekPetChatEnabled: true,
      deepseekDailyClassificationEnabled: true,
      deepseekArchiveOrganizationEnabled: true
    })

    const detail = FloatingAssistantAppModule.formatDeepSeekRuntimeHoverDetail(preferences, [
      { id: 'classification:1', kind: 'classification', detail: '复核《测试视频》的分类' }
    ])

    expect(detail).toContain('DeepSeek 工作中\n当前模型：deepseek-v4-pro\n正在执行 1 项任务：')
    expect(detail).toContain('趣味评论：开启，会生成候选弹幕，可复制发布为评论。')
    expect(detail).toContain('收藏整理：开启，可在归档预览中手动执行 DeepSeek 整理。')
  })

  it('uses the queued transcription model and actual CUDA runtime in running status details', () => {
    const queue: VideoAudioTranscriptionQueueSnapshot = {
      activeItemId: 'running',
      sessionCompletedCount: 0,
      items: [{
        id: 'running',
        url: 'https://www.bilibili.com/video/BV1test',
        title: '测试视频',
        transcriptionModelId: 'faster-whisper-large-v3-turbo',
        status: 'running',
        actualDevice: 'cuda',
        progress: { step: 'transcribing-segment', message: '转写中', segmentIndex: 1, segmentCount: 4 },
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:01.000Z'
      }]
    }

    const status = FloatingAssistantAppModule.resolveGlobalTranscriptionStatus(
      queue,
      'whisper-small'
    )

    expect(status.detail).toBe('模型：faster-whisper large-v3-turbo · GPU 已就绪\n测试视频 正在转写')
    expect(statusLightTooltip(status)).toContain('模型：faster-whisper large-v3-turbo · GPU 已就绪')
  })

  it('shows the selected transcription model and only a matching available GPU probe as ready', () => {
    const queue: VideoAudioTranscriptionQueueSnapshot = { items: [], sessionCompletedCount: 1 }
    const matching = FloatingAssistantAppModule.resolveGlobalTranscriptionStatus(
      queue,
      'faster-whisper-large-v3',
      {
        modelId: 'faster-whisper-large-v3',
        status: 'available',
        device: 'cuda',
        computeType: 'float16',
        gpuName: 'NVIDIA GeForce RTX 4060 Ti',
        driverVersion: '595.97',
        memoryMiB: 8188,
        freeMemoryMiB: 6500
      }
    )
    const mismatched = FloatingAssistantAppModule.resolveGlobalTranscriptionStatus(
      queue,
      'whisper-small',
      {
        modelId: 'faster-whisper-large-v3',
        status: 'available',
        device: 'cuda',
        computeType: 'float16',
        gpuName: 'NVIDIA GeForce RTX 4060 Ti',
        driverVersion: '595.97',
        memoryMiB: 8188,
        freeMemoryMiB: 6500
      }
    )

    expect(matching.detail).toContain('模型：faster-whisper large-v3 · GPU 已就绪')
    expect(mismatched.detail).toContain('模型：Whisper small')
    expect(mismatched.detail).not.toContain('GPU 已就绪')
  })

  it('does not treat a completed transcription for another part as the current video', () => {
    const note = {
      id: 'bvid:BV1old', source: { accountMid: '100', aid: 7, cid: 70, bvid: 'BV1old', title: 'Old', tags: [], url: '' },
      transcriptSource: 'audio' as const, transcript: [], chapters: [], overview: emptyOverview, annotations: [], userMemo: '', starred: false,
      createdAt: '2026-07-28T00:00:00.000Z', updatedAt: '2026-07-28T00:00:00.000Z'
    }
    const currentSnapshot = {
      accountMid: '100',
      videoContentContext: { aid: 8, cid: 80, bvid: 'BV1new' }
    } as never

    expect(matchesCurrentVideoNote(note, currentSnapshot)).toBe(false)
  })

  it('does not guess a summary from the newest archive version when the current note identity is ambiguous', () => {
    const note = {
      id: 'note-1', source: { accountMid: '100', aid: 7, cid: 70, bvid: 'BV1same', title: 'Video', tags: [], url: '' },
      transcriptSource: 'audio' as const, transcript: [], chapters: [], overview: emptyOverview, annotations: [], userMemo: '', starred: false,
      createdAt: '2026-07-27T00:00:00.000Z', updatedAt: '2026-07-27T00:00:00.000Z'
    }
    expect(findArchivedSummaryTextForNote([{ id: 'bvid:BV1same', source: note.source, createdAt: note.createdAt, updatedAt: note.updatedAt, versions: [
      { id: 'version-1', createdAt: note.createdAt, note, plainTranscript: '', summaryText: 'older summary' },
      { id: 'version-2', createdAt: '2026-07-27T01:00:00.000Z', note, plainTranscript: '', summaryText: 'newer unrelated summary' }
    ] }], note)).toBe('')
  })

  it('does not retain another account archive when the signed-in account changes', () => {
    expect(archivesForCurrentAccount([
      { id: 'old', source: { accountMid: '100', title: 'Old', tags: [], url: '' }, versions: [], createdAt: '2026-07-28T00:00:00.000Z', updatedAt: '2026-07-28T00:00:00.000Z' },
      { id: 'current', source: { accountMid: '200', title: 'Current', tags: [], url: '' }, versions: [], createdAt: '2026-07-28T00:00:00.000Z', updatedAt: '2026-07-28T00:00:00.000Z' }
    ], '200').map((archive) => archive.id)).toEqual(['current'])
    expect(archivesForCurrentAccount([], '').length).toBe(0)
  })

  it('rejects an archive response captured before account-change invalidation', () => {
    expect(canPublishVideoNoteArchiveLoad(3, 4)).toBe(false)
    expect(canPublishVideoNoteArchiveLoad(4, 4)).toBe(true)
  })

  it('refreshes a missing exact archive version for a completed queue item without guessing another version', () => {
    const item = {
      id: 'account:100:bvid:BV1done', accountMid: '100', bvid: 'BV1done', url: 'https://www.bilibili.com/video/BV1done', title: 'Video', status: 'completed' as const,
      archiveRegistrationStatus: 'registered' as const, archiveNoteId: 'bvid:BV1done', archiveVersionId: 'version-done',
      createdAt: '2026-07-28T00:00:00.000Z', updatedAt: '2026-07-28T00:00:01.000Z'
    }
    const otherVersion = {
      id: 'version-other', createdAt: item.createdAt, plainTranscript: '', summaryText: '',
      note: { id: 'bvid:BV1done', source: { accountMid: '100', bvid: 'BV1done', title: 'Video', tags: [], url: '' }, transcriptSource: 'audio' as const, transcript: [], chapters: [], overview: emptyOverview, annotations: [], userMemo: '', starred: false, createdAt: item.createdAt, updatedAt: item.updatedAt }
    }

    expect(archiveSnapshotNeedsRefresh([], [item], '100')).toBe(true)
    expect(archiveSnapshotNeedsRefresh([{ id: 'bvid:BV1done', source: otherVersion.note.source, versions: [otherVersion], createdAt: item.createdAt, updatedAt: item.updatedAt }], [item], '100')).toBe(true)
    expect(archiveSnapshotNeedsRefresh([{ id: 'bvid:BV1done', source: otherVersion.note.source, versions: [{ ...otherVersion, id: 'version-done' }], createdAt: item.createdAt, updatedAt: item.updatedAt }], [item], '100')).toBe(false)
  })

  it('places local data and motion tuning after the Bilibili connection setting', () => {
    expect(SETTINGS_JUMP_OPTIONS.slice(-5).map((option) => option.value)).toEqual([
      'motion-tuning',
      'review-actions',
      'bilibili-connection',
      'local-data',
      'close'
    ])
  })

  it('requires a Bilibili account before editing the account-scoped default favorite system', () => {
    expect(defaultFavoriteSystemToggleAvailable(undefined)).toBe(false)
    expect(defaultFavoriteSystemToggleAvailable('100')).toBe(true)
  })

  it('keeps a default-system-disabled account idle instead of reporting a backup gap', () => {
    expect(resolveFavoriteOrganizationLamp({
      snapshot: null,
      defaultFavoriteSystemEnabled: false,
      ledgers: [defaultLedger],
      favoriteLedgerStatus: null
    })).toMatchObject({ label: '\u6574\u7406\u7a7a\u95f2', tone: 'idle' })
  })

  it('\u7ed9\u540c\u540d\u8fdc\u7a0b\u6536\u85cf\u5939\u51b2\u7a81\u663e\u793a\u5907\u518c\u5f02\u5e38', () => {
    expect(resolveFavoriteOrganizationLamp({
      snapshot: null,
      defaultFavoriteSystemEnabled: true,
      ledgers: [defaultLedger],
      favoriteLedgerStatus: {
        ok: false,
        ledgers: [defaultLedger],
        missingLedgerIds: ['knowledge'],
        backupConflictLedgerIds: ['knowledge'],
        message: '\u53d1\u73b0\u540c\u540d\u6536\u85cf\u5939'
      }
    })).toMatchObject({ label: '\u5907\u518c\u5f02\u5e38', tone: 'error' })
  })

  it('uses the backup status only when no real organization round is active', () => {
    const status = resolveFavoriteOrganizationLamp({
      snapshot: null,
      defaultFavoriteSystemEnabled: true,
      ledgers: [defaultLedger],
      favoriteLedgerStatus: null
    })
    expect(status).toMatchObject({ label: '\u672a\u5907\u518c', tone: 'error' })
    expect(status.detail.split('\n')).toEqual(expect.arrayContaining([
      expect.stringMatching(/^收藏夹：/),
      expect.stringMatching(/^整理收藏：/)
    ]))

    expect(resolveFavoriteOrganizationLamp({
      snapshot: workspace('scanning'),
      defaultFavoriteSystemEnabled: true,
      ledgers: [defaultLedger],
      favoriteLedgerStatus: null
    })).toMatchObject({ label: '\u6574\u7406\u626b\u63cf\u4e2d', tone: 'running' })
  })

  it.each([
    ['previewing', '\u7b49\u5f85\u786e\u8ba4'],
    ['frozen', '\u7b49\u5f85\u6267\u884c'],
    ['executing', '\u6574\u7406\u6267\u884c\u4e2d'],
    ['reconciling', '\u540c\u6b65\u5f85\u68c0\u67e5'],
    ['completed', '\u6574\u7406\u5b8c\u6210']
  ] as const)('prioritizes the %s workspace state over backup status', (status, label) => {
    expect(resolveFavoriteOrganizationLamp({
      snapshot: workspace(status),
      defaultFavoriteSystemEnabled: true,
      ledgers: [defaultLedger],
      favoriteLedgerStatus: null
    }).label).toBe(label)
  })

  it('returns to idle only for the completed workspace the user acknowledged', () => {
    expect(resolveFavoriteOrganizationLamp({
      snapshot: workspace('completed'),
      acknowledgedWorkspaceId: 'workspace',
      defaultFavoriteSystemEnabled: true,
      ledgers: [defaultLedger],
      favoriteLedgerStatus: null
    })).toMatchObject({ label: '整理空闲', tone: 'idle' })

    expect(resolveFavoriteOrganizationLamp({
      snapshot: { ...workspace('completed'), workspaceId: 'workspace-next' },
      acknowledgedWorkspaceId: 'workspace',
      defaultFavoriteSystemEnabled: true,
      ledgers: [defaultLedger],
      favoriteLedgerStatus: null
    })).toMatchObject({ label: '整理完成' })
  })
})
