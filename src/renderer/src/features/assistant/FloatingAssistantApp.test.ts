import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { FavoriteLedger, VideoAudioTranscriptionQueueSnapshot } from '@shared/types'
import type { OldFavoriteWorkspaceSnapshot } from '@shared/oldFavoriteWorkspace'
import * as FloatingAssistantAppModule from './FloatingAssistantApp'
import { archiveSnapshotNeedsRefresh, archivesForCurrentAccount, canPublishVideoNoteArchiveLoad, createDeepSeekSummaryFeedback, createTranscriptionQueueFeedback, defaultFavoriteSystemToggleAvailable, favoriteLedgerReclassificationRequired, favoriteOrganizationStatus, findArchivedSummaryTextForNote, ledgersForFavoriteBackup, matchesCurrentVideoNote, reconcileFavoriteLedgerBindingProjection, resolveFavoriteOrganizationLamp, SETTINGS_JUMP_OPTIONS, settingsSectionScrollTop, statusLightNavigation, statusLightTooltip, statusLightTooltipParts, suppressRemoteDraftReminder } from './FloatingAssistantApp'
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
  it('projects newly bound first and capacity shards without overwriting local rule edits', () => {
    const projected = reconcileFavoriteLedgerBindingProjection([
      {
        id: 'honker233', displayName: 'bilimi·honker233', keywords: ['new local keyword'], enabled: true,
        priority: 20, isDefault: false, bindingState: 'unbacked'
      },
      {
        id: 'game', displayName: 'bilimi·游戏专区', keywords: ['game'], enabled: true,
        priority: 10, isDefault: false, bilibiliFolderId: 'game-1', bilibiliFolderIds: ['game-1'], bindingState: 'bound'
      }
    ], [
      {
        id: 'honker233', displayName: 'bilimi·honker233', keywords: ['stale'], enabled: true,
        priority: 20, isDefault: false, bilibiliFolderId: 'honker-1', bilibiliFolderIds: ['honker-1'],
        bilibiliFolderTitle: 'bilimi·honker233', bindingState: 'bound'
      },
      {
        id: 'game', displayName: 'bilimi·游戏专区', keywords: ['stale'], enabled: true,
        priority: 10, isDefault: false, bilibiliFolderId: 'game-1', bilibiliFolderIds: ['game-1', 'game-2'],
        bilibiliFolderTitle: 'bilimi·游戏专区', bindingState: 'bound'
      }
    ])

    expect(projected).toEqual([
      expect.objectContaining({
        id: 'honker233', keywords: ['new local keyword'], bindingState: 'bound',
        bilibiliFolderId: 'honker-1', bilibiliFolderIds: ['honker-1']
      }),
      expect.objectContaining({
        id: 'game', keywords: ['game'], bindingState: 'bound',
        bilibiliFolderId: 'game-1', bilibiliFolderIds: ['game-1', 'game-2']
      })
    ])
  })

  it('keeps recovered remote drafts in the full local snapshot passed to backup', () => {
    const recoveredDraft: FavoriteLedger = {
      id: 'custom-remote-game', displayName: 'bilimi·游戏专区', keywords: [], enabled: false,
      priority: 20_000, bilibiliFolderId: '88', bilibiliFolderIds: ['88'],
      bindingState: 'unbound', syncState: 'local-draft', isDefault: false
    }

    expect(ledgersForFavoriteBackup([recoveredDraft])).toEqual([recoveredDraft])
    expect(ledgersForFavoriteBackup([{ ...recoveredDraft, enabled: true, syncState: undefined }])).toEqual([
      expect.objectContaining({ id: recoveredDraft.id, enabled: true, syncState: undefined })
    ])
  })

  it('keeps unsaved and disabled ledgers in the full local snapshot passed to backup', () => {
    const savedEnabled: FavoriteLedger = {
      id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true,
      priority: 10, isDefault: true
    }
    const unsavedEnabled: FavoriteLedger = {
      id: 'recommended-up', displayName: 'bilimi·推荐 UP', keywords: [], enabled: true,
      priority: 20, syncState: 'local-draft', isDefault: false
    }
    const savedDisabled: FavoriteLedger = {
      id: 'reading', displayName: 'bilimi·阅读', keywords: [], enabled: false,
      priority: 30, isDefault: true
    }

    expect(ledgersForFavoriteBackup([savedEnabled, unsavedEnabled, savedDisabled])).toEqual([
      savedEnabled,
      unsavedEnabled,
      savedDisabled
    ])
  })

  it('suppresses a dismissed remote-only draft from refreshed favorite status', () => {
    const remoteDraftStatus = {
      ok: true,
      ledgers: [defaultLedger],
      missingLedgerIds: [],
      remoteOnlyDraftLedgerIds: ['custom-remote-hello', 'custom-remote-world']
    }

    expect(suppressRemoteDraftReminder(remoteDraftStatus, 'custom-remote-hello')).toMatchObject({
      remoteOnlyDraftLedgerIds: ['custom-remote-world']
    })
  })

  it('announces only manual page changes to both channels and keeps the first review entry global only', () => {
    const resolveAnnouncement = (FloatingAssistantAppModule as unknown as {
      resolveWorkspaceGuidanceAnnouncement: (
        activeTab: 'review' | 'notes' | 'ledger' | 'settings',
        nextTab: 'review' | 'notes' | 'ledger' | 'settings',
        source: 'top-tab' | 'initial-floating-review' | 'internal'
      ) => 'none' | 'global-only' | 'both'
    }).resolveWorkspaceGuidanceAnnouncement

    expect(resolveAnnouncement('review', 'notes', 'top-tab')).toBe('both')
    expect(resolveAnnouncement('review', 'review', 'top-tab')).toBe('none')
    expect(resolveAnnouncement('review', 'review', 'initial-floating-review')).toBe('global-only')
    expect(resolveAnnouncement('notes', 'ledger', 'internal')).toBe('none')
  })

  it('uses the completed enabled wording in DeepSeek status help', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/FloatingAssistantApp.tsx'), 'utf8')

    expect(source).toContain('趣味评论：已开启')
    expect(source).toContain('自动总结：已开启')
    expect(source).toContain('宠物对话：已开启')
    expect(source).toContain('批阅辅助：已开启')
    expect(source).toContain('复核全部分类')
    expect(source).toContain('仅复核不太稳的分类')
    expect(source).toContain('收藏整理：已开启')
    expect(source).toContain('createPortal(<div')
  })

  it('exposes a bounded next-round old-favorite batch setting without changing the active draft', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/FloatingAssistantApp.tsx'), 'utf8')
    const start = source.indexOf('data-settings-section="old-favorite-batches"')
    const section = source.slice(start, source.indexOf('</fieldset>', start))
    const fieldStart = source.indexOf('const OldFavoriteBatchSizeField')
    const field = source.slice(fieldStart, source.indexOf('const SettingsWorkspaceContent', fieldStart))
    expect(section).toContain('当前正在整理的草稿不会被重新切分')
    expect(section).toContain('<legend>整理收藏批次</legend>')
    expect(section).toContain('请按照设备性能调整，设置下一轮整理时每批最多加载的详细视频数；当前正在整理的草稿不会被重新切分。')
    expect(section).toContain('2000 条（推荐）')
    expect(section).toContain('<OldFavoriteBatchSizeField')
    expect(field).toContain('type="radio"')
    expect(field).toContain('min={MIN_OLD_FAVORITE_WORKSPACE_SEGMENT_SIZE}')
    expect(field).toContain('max={MAX_OLD_FAVORITE_WORKSPACE_SEGMENT_SIZE}')
    expect(field).toContain('onBlur={commitDraft}')
    expect(field).toContain("event.key === 'Escape'")
    expect(section).toContain('onCommit={persistOldFavoriteBatchSize}')
  })

  it('persists a direct ledger-enabled save without scanning the ledger array', () => {
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
    expect(saveFunction).not.toContain("{ type: 'reclassify-favorite-configuration' }")
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

  it('does not use the parent organization snapshot as the rule-directory reclassification gate', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/FloatingAssistantApp.tsx'), 'utf8')
    const enabledSave = source.slice(
      source.indexOf('async function saveFavoriteLedgerEnabled'),
      source.indexOf('async function saveFavoriteLedgerRules')
    )
    const ruleSave = source.slice(
      source.indexOf('async function saveFavoriteLedgerRules'),
      source.indexOf('async function setDefaultFavoriteSystemEnabled')
    )

    expect(enabledSave).not.toContain('favoriteLedgerReclassificationRequired(')
    expect(ruleSave).not.toContain('favoriteLedgerReclassificationRequired(')
    expect(enabledSave).not.toContain("type: 'reclassify-favorite-configuration'")
    expect(ruleSave).not.toContain("type: 'reclassify-favorite-configuration'")
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

  it('persists a saved rule-directory change without starting Bilibili sync', () => {
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
    expect(saveFunction).not.toContain("{ type: 'reclassify-favorite-configuration' }")
    expect(syncFunction).toContain('saveFavoriteLedgers')
  })

  it('leaves rule-directory reclassification to the workspace owner for every ledger persistence', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/FloatingAssistantApp.tsx'), 'utf8')
    const saveFunction = source.slice(
      source.indexOf('async function saveFavoriteLedgerRules'),
      source.indexOf('async function setDefaultFavoriteSystemEnabled')
    )

    expect(saveFunction).not.toContain('options?.recommendationOnly !== true')
    expect(saveFunction).not.toContain("{ type: 'reclassify-favorite-configuration' }")
  })

  it('lets the backup snapshot broadcast refresh the floating assistant once', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/FloatingAssistantApp.tsx'), 'utf8')
    const ensureFunction = source.slice(
      source.indexOf('async function ensureFavoriteLedgers()'),
      source.indexOf('async function saveFavoriteLedgers(')
    )

    expect(ensureFunction).not.toContain('requestAssistantSnapshot')
  })

  it('refreshes the authoritative relationship projection after backup or remote-draft discovery and workspace reconciliation', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/FloatingAssistantApp.tsx'), 'utf8')
    const relationshipRefresh = source.slice(
      source.indexOf('const refreshFavoriteOrganizationRelationshipProjection'),
      source.indexOf('async function ensureFavoriteLedgers()')
    )
    const ensureFunction = source.slice(
      source.indexOf('async function ensureFavoriteLedgers()'),
      source.indexOf('async function saveFavoriteLedgers(')
    )
    const saveFunction = source.slice(
      source.indexOf('async function saveFavoriteLedgers('),
      source.indexOf('async function syncFavoriteLedgers(')
    )
    const reconciliationRefresh = source.slice(
      source.indexOf('const refreshOrganizationState'),
      source.indexOf('async function openFavoritePage()')
    )

    expect(relationshipRefresh).toContain("type: 'refresh-relationship-projection'")
    expect(relationshipRefresh).toContain('setFavoriteOrganizationSnapshot(workspace)')
    expect(reconciliationRefresh).toContain('refreshFavoriteOrganizationRelationshipProjection')
    expect(reconciliationRefresh).not.toContain('openOldFavoriteWorkspaceV1')
    expect(ensureFunction).toContain('if (result.ok)')
    expect(ensureFunction).toContain('refreshFavoriteOrganizationRelationshipProjection')
    expect(ensureFunction).toContain('await loadSnapshot({ reconcileFavoriteBindingProjection: true })')
    expect(saveFunction).toContain('if (result.ok || (result.remoteOnlyDraftLedgerIds?.length ?? 0) > 0)')
    expect(saveFunction).toContain('refreshFavoriteOrganizationRelationshipProjection')
  })

  it('invalidates stale favorite status before broadcasting an ordinary backup result', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/App.tsx'), 'utf8')
    const saveFunction = source.slice(
      source.indexOf('async function saveFavoriteLedgers('),
      source.indexOf('async function openBilibiliFavorites()')
    )
    const refreshHelper = saveFunction.slice(
      saveFunction.indexOf('const refreshFavoriteLedgerStatusAfterBackup'),
      saveFunction.indexOf('const observedRemoteOnlyDrafts')
    )
    const ordinarySuccessPath = saveFunction.slice(saveFunction.lastIndexOf('await releaseObservedRemoteDraftRediscovery()'))

    expect(refreshHelper).toContain('favoriteLedgerStatusCacheRef.current = null')
    expect(refreshHelper).toContain('readFavoriteLedgerStatus(accountMid, { force: true, preserveBoundLedgerIds })')
    expect(ordinarySuccessPath).toContain('await refreshFavoriteLedgerStatusAfterBackup(preserveBoundLedgerIds)')
  })

  it('clears the rendered account-scoped favorite status before loading a replacement account', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/FloatingAssistantApp.tsx'), 'utf8')
    const accountChangeEffect = source.slice(
      source.indexOf('onBilibiliAccountChanged'),
      source.indexOf('useEffect(() => window.bilimiDesktop?.onLocalDataReset')
    )

    expect(accountChangeEffect).toContain('favoriteLedgerStatus')
    expect(accountChangeEffect).toContain('setFavoriteLedgerStatus')
    expect(accountChangeEffect).toContain('accountMid')
    expect(accountChangeEffect).toContain('loadSnapshot')
  })

  it('does not await a duplicate status refresh in the backup save path', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/App.tsx'), 'utf8')
    const saveFunction = source.slice(
      source.indexOf('async function saveFavoriteLedgers('),
      source.indexOf('async function openBilibiliFavorites()')
    )
    const refreshHelper = saveFunction.slice(
      saveFunction.indexOf('const refreshFavoriteLedgerStatusAfterBackup'),
      saveFunction.indexOf('const observedRemoteOnlyDrafts')
    )

    expect(refreshHelper).toContain('favoriteLedgerStatusRefreshPromisesRef')
    expect(refreshHelper).toContain('readFavoriteLedgerStatus(accountMid, { force: true, preserveBoundLedgerIds })')
    expect(refreshHelper).toContain('verified')
    expect(refreshHelper).not.toContain('return readFavoriteLedgerStatus(accountMid, { force: true })')
    expect(refreshHelper).not.toContain('.catch(() => undefined)')
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

  it('does not use the parent snapshot to compensate a rule-directory change', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/FloatingAssistantApp.tsx'), 'utf8')
    const saveFunction = source.slice(
      source.indexOf('async function saveFavoriteLedgerRules'),
      source.indexOf('async function setDefaultFavoriteSystemEnabled')
    )

    expect(saveFunction).not.toContain('const rollbackPatch: Partial<AssistantPreferences>')
    expect(saveFunction).not.toContain("收藏夹规则重分类失败")
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
    expect(feedbackToggle).toContain('globalFeedbackVisiblePrefix')
    expect(feedbackToggle).toContain('displayedGlobalFeedbackMessage')
  })

  it('keeps the two-line prefix and puts the remaining text before expanded background tasks', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/FloatingAssistantApp.tsx'), 'utf8')

    expect(source).toContain('globalFeedbackContinuationVisible')
    expect(source).toContain('globalFeedbackContinuation')
    expect(source).toContain('data-continuation-visible')
    expect(source).toContain('const layoutFrame = window.requestAnimationFrame(updateContinuation)')
    expect(source).toContain('resizeObserver?.observe(globalFeedbackMessageRef.current)')
    expect(source).toContain('className="floating-assistant-global-status__feedback-continuation"')
    expect(source).toContain('className="floating-assistant-global-status__menu-feedback-continuation"')
    expect(source).toContain('globalFeedbackExpanded && globalFeedbackContinuation')
    expect(source).toContain('splitFeedbackContinuationByLines')
    expect(source).toContain('if (!split.suffix)')
    expect(source).toContain('setGlobalFeedbackContinuationVisible(false)')
    expect(source).toContain('setGlobalFeedbackContinuationVisible(!nextExpanded)')
    expect(source).not.toContain('title={globalFeedbackExpanded ? undefined : displayedGlobalFeedbackMessage}')
  })

  it('repositions a visible status-light tooltip after its panel finishes resizing', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/FloatingAssistantApp.tsx'), 'utf8')
    const light = source.slice(source.indexOf('function GlobalStatusLight'), source.indexOf('type LedgerWorkspacePanelProps'))

    expect(light).toContain('const resizeObserver = new ResizeObserver(updatePosition)')
    expect(light).toContain('const stableLayoutFrame = window.requestAnimationFrame(updatePosition)')
    expect(light).toContain('const tooltipWidth = Math.min(360, Math.max(0, window.innerWidth - 32))')
    expect(light).toContain('resizeObserver.observe(statusPanelRef.current)')
    expect(light).toContain('resizeObserver.observe(tooltipRef.current)')
    expect(light).toContain("statusPanelRef.current?.addEventListener('transitionend', updatePosition)")
    expect(light).toContain('window.cancelAnimationFrame(stableLayoutFrame)')
    expect(light).toContain('resizeObserver.disconnect()')
  })

  it('keeps the feedback row clamped and places only the continuation before menu sections', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/FloatingAssistantApp.tsx'), 'utf8')

    expect(source).toContain('createPersistentStatusTasks({')
    expect(source).toContain('className="floating-assistant-global-status__menu"')
    expect(source).toContain('globalFeedbackHistory.length > 0 ? globalFeedbackHistory.map((item) => (')
    expect(source).not.toContain('recentGlobalFeedbackHistory')
    expect(source).not.toContain('className="floating-assistant-global-status__menu-message"')
    expect(source).not.toContain('<strong>当前提示</strong>')
    expect(source).toContain('className="floating-assistant-global-status__menu-feedback-continuation"')
    expect(source).toContain('后台任务')
    expect(source).toContain('当前没有后台任务')
    expect(source).toContain('最近提示')
    expect(source).toContain("openSettingsSection('transcription')")
  })

  it('normalizes transient renderer feedback before showing it globally', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/FloatingAssistantApp.tsx'), 'utf8')
    const start = source.indexOf('function showTemporaryGlobalFeedback')
    const end = source.indexOf('\n  function showCopyFeedback', start)
    const implementation = source.slice(start, end)
    expect(implementation).toContain('formatAssistantFeedbackMessage(feedback.message')
  })

  it('starts the global feedback scrollbar at background tasks, below the fixed continuation', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/FloatingAssistantApp.tsx'), 'utf8')
    const menuStart = source.indexOf('className="floating-assistant-global-status__menu"')
    const menuEnd = source.indexOf('</div>', source.indexOf('className="floating-assistant-global-status__menu-scroll"', menuStart))
    const menu = source.slice(menuStart, menuEnd)
    expect(menu.indexOf('menu-feedback-continuation')).toBeLessThan(menu.indexOf('menu-scroll'))
    expect(menu).toContain('className="floating-assistant-global-status__menu-scroll"')
    expect(menu).toContain('<strong>后台任务</strong>')
    expect(menu).toContain('<strong>最近提示</strong>')
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

  it('places the official DeepSeek platform link below the divider and above the API key field', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/FloatingAssistantApp.tsx'), 'utf8')
    const officialLink = source.indexOf('className="assistant-settings__deepseek-official-link"')
    const apiKeyField = source.indexOf('<span>DeepSeek API 密钥</span>')

    expect(officialLink).toBeGreaterThan(-1)
    expect(apiKeyField).toBeGreaterThan(officialLink)
    expect(source).toMatch(/<span>DeepSeek 官方开放平台：<\/span>\s*<a href="https:\/\/platform\.deepseek\.com\/" target="_blank" rel="noreferrer">\s*https:\/\/platform\.deepseek\.com\//)
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
    expect(source).toContain('className="assistant-settings__reset-confirmation"')
  })

  it('explains B站 connection scope without implying it changes system proxy settings', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/FloatingAssistantApp.tsx'), 'utf8')

    expect(source).toContain("['auto', '跟随系统（推荐）'")
    expect(source).toContain("['direct', '直接连接'")
    expect(source).toContain('不会修改 Windows、Clash 或其他应用的代理设置，也不影响 DeepSeek、转写、下载等功能。')
    expect(source).toContain('切换连接方式后，B 站页面会重新加载。正在加载的内容可能需要重新打开，但已提交的操作不会丢失。')
    expect(source).toContain('className="assistant-settings__bilibili-connection-choice"')
    const sectionStart = source.indexOf('data-settings-section="bilibili-connection"')
    const section = source.slice(sectionStart, source.indexOf('</fieldset>', sectionStart))
    expect(section.indexOf('<BilibiliConnectionModeControl')).toBeLessThan(section.indexOf('此设置只影响 bilimi 打开 B 站时的网络连接'))
  })

  it('uses the confirmed default favorite-system explanation instead of the provisional copy', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/FloatingAssistantApp.tsx'), 'utf8')
    const start = source.indexOf('data-settings-section="favorites"')
    const section = source.slice(start, source.indexOf('</fieldset>', start))

    expect(section).toContain('默认收藏夹体系包含掌库的七个默认分类，不包括 bilimi·暂存。')
    expect(section).toContain('开启后，七个默认收藏夹会固定参与批阅预分类、整理收藏分类、备册；适合大多数使用场景。')
    expect(section).toContain('关闭后，七个默认收藏夹将停用，不再参与分类，不会备册；主人可以 DIY 自己的收藏夹体系。')
    expect(section).toContain('已备册到b站但不再需要的默认收藏夹，可在掌库收藏夹区域统一删除。')
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

  it('keeps the three favorite status sections together without a separate pet reminder', () => {
    const detail = '备册：请先完成备册。\n收藏夹：当前启用 1 个。\n整理收藏：等待开始。'

    expect(statusLightTooltip({ label: '未备册', detail, tone: 'error' })).toBe(detail)
    expect(statusLightTooltip({ label: '未备册', detail, tone: 'error' })).not.toContain('小咪提醒')
  })

  it('keeps status tooltip labels separate from their explanations', () => {
    const parts = statusLightTooltipParts({
      label: '未备册',
      detail: '备册：发现疑似 bilimi 收藏夹。\n收藏夹：当前状态需要确认。\n整理收藏：完成备册后可开始。',
      tone: 'error'
    })

    expect(parts.filter((part) => part.label).map((part) => part.label)).toEqual([
      '备册：',
      '收藏夹：',
      '整理收藏：',
    ])
    expect(parts.find((part) => part.label === '备册：')?.text).toBe('发现疑似 bilimi 收藏夹。')
  })

  it('emphasizes the standalone default favorite-system status line', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/FloatingAssistantApp.tsx'), 'utf8')
    const styles = readFileSync(resolve(process.cwd(), 'src/renderer/src/styles.css'), 'utf8')
    const parts = statusLightTooltipParts({
      label: '未备册',
      detail: '默认收藏夹体系已开启。\n\n备册：当前没有启用的收藏夹。',
      tone: 'error'
    })

    expect(parts[0]).toMatchObject({ text: '默认收藏夹体系已开启。', emphasized: true })
    expect(parts[2]).not.toHaveProperty('emphasized')
    expect(source).toContain("part.emphasized ? ' floating-assistant-global-status__light-tooltip-line--emphasis'")
    expect(styles).toMatch(/\.floating-assistant-global-status__light-tooltip-line--emphasis \{[^}]*color: #1d4f83;[^}]*font-weight: 700;/)
  })

  it('uses a dedicated deep-blue bold style for status tooltip labels', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/FloatingAssistantApp.tsx'), 'utf8')
    const styles = readFileSync(resolve(process.cwd(), 'src/renderer/src/styles.css'), 'utf8')

    expect(source).toContain('floating-assistant-global-status__light-tooltip-label')
    expect(styles).toContain('.floating-assistant-global-status__light-tooltip-label')
    expect(styles).toContain('font-weight: 700')
  })

  it('uses the shared deep-blue tooltip labels for DeepSeek details', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/FloatingAssistantApp.tsx'), 'utf8')
    const styles = readFileSync(resolve(process.cwd(), 'src/renderer/src/styles.css'), 'utf8')

    expect(source).toContain('data-status-light={id}')
    expect(styles).not.toContain(".floating-assistant-global-status__light-tooltip[data-status-light='deepseek']")
    expect(styles).toContain('.floating-assistant-global-status__light-tooltip-label')
    expect(styles).toContain('font-weight: 700')
  })

  it('uses the shared status-label styling for the DeepSeek connection and model line', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/FloatingAssistantApp.tsx'), 'utf8')
    const styles = readFileSync(resolve(process.cwd(), 'src/renderer/src/styles.css'), 'utf8')

    expect(source).not.toContain('floating-assistant-global-status__light-tooltip-title-line')
    expect(styles).not.toContain(".floating-assistant-global-status__light-tooltip[data-status-light='deepseek']")
    expect(styles).toMatch(/\.floating-assistant-global-status__light-tooltip-label \{[^}]*color: #1d4f83;[^}]*font-weight: 700;/)
  })

  it('labels the current transcription model and video independently', () => {
    const status = FloatingAssistantAppModule.resolveGlobalTranscriptionStatus(
      { items: [], sessionCompletedCount: 0 },
      'whisper-small'
    )

    const parts = statusLightTooltipParts(status)
    expect(parts.filter((part) => part.label).map((part) => part.label)).toEqual([
      '视频转写模型：',
      '当前转写视频：'
    ])
    expect(parts[0]).toMatchObject({ emphasized: true })
    expect(parts[1]).not.toHaveProperty('emphasized')
    expect(status.detail).toBe('视频转写模型：Whisper small\n\n当前转写视频：暂无视频转写')
  })

  it('leaves an empty line below the connected DeepSeek model before feature details', () => {
    const preferences = createInitialAssistantPreferences({
      deepseekEnabled: true,
      deepseekApiKeyStored: true,
      deepseekModel: 'deepseek-v4-flash',
      deepseekCommentEnabled: true,
      deepseekAutoSummaryEnabled: true
    })
    const formatFeatureList = (FloatingAssistantAppModule as unknown as {
      formatDeepSeekFeatureList: (preferences: typeof preferences) => string
    }).formatDeepSeekFeatureList

    expect(formatFeatureList(preferences)).toContain(
      'DeepSeek 已连接，当前模型：deepseek-v4-flash\n\n趣味评论：已开启'
    )
  })

  it('labels DeepSeek connection and feature status independently', () => {
    const parts = statusLightTooltipParts({
      label: 'DeepSeek 已连接',
      detail: [
        'DeepSeek 已连接。',
        '当前模型：deepseek-v4-flash',
        '趣味评论：已开启，会生成候选弹幕。',
        '自动总结：已开启，会生成文稿总结。',
        '宠物对话：已开启，小咪会调用 DeepSeek 对话。',
        '批阅辅助：已开启，会复核批阅分类。',
        '收藏整理：已开启，可执行 DeepSeek 整理。'
      ].join('\n'),
      tone: 'ok'
    })

    expect(parts.filter((part) => part.label).map((part) => part.label)).toEqual([
      'DeepSeek 已连接。',
      '当前模型：',
      '趣味评论：',
      '自动总结：',
      '宠物对话：',
      '批阅辅助：',
      '收藏整理：'
    ])
  })

  it('parses the combined DeepSeek connection and model line as one label', () => {
    const parts = statusLightTooltipParts({
      label: 'DeepSeek 已连接',
      detail: [
        'DeepSeek 已连接，当前模型：deepseek-v4-flash',
        '趣味评论：已开启。'
      ].join('\n'),
      tone: 'ok'
    })

    expect(parts[0]).toEqual({
      label: 'DeepSeek 已连接，当前模型：',
      text: 'deepseek-v4-flash',
      emphasized: true
    })
  })

  it('keeps the wait-confirmation detail concise across the status light and task menu', () => {
    expect(favoriteOrganizationStatus(workspace('previewing'))?.detail).not.toContain('小咪提醒')
  })

  it('renders a readable custom tooltip for status lights instead of a native title tooltip', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/FloatingAssistantApp.tsx'), 'utf8')
    const styles = readFileSync(resolve(process.cwd(), 'src/renderer/src/styles.css'), 'utf8')

    expect(source).toContain('floating-assistant-global-status__light-tooltip')
    expect(source).toContain('floating-assistant-global-status__light-label')
    expect(source).toContain('aria-describedby={visible ? tooltipId : undefined}')
    expect(source).not.toContain('title={statusLightTooltip(item)}')
    expect(styles).toContain('.floating-assistant-global-status__light-tooltip')
    expect(styles).toContain('.floating-assistant-global-status__light-label')
    expect(styles).toContain('white-space: pre-line')
    expect(styles).toContain('position: fixed;')
    expect(styles).toContain('z-index: 10001;')
    expect(styles).toContain('max-height: min(50vh, 420px)')
    expect(styles).toMatch(/\.floating-assistant-global-status__light-tooltip \{[^}]*position: fixed;[^}]*z-index: 10001;/)
    expect(styles).not.toContain('.floating-assistant-global-status__light:last-child .floating-assistant-global-status__light-tooltip')
    expect(styles).toMatch(/\.floating-assistant-global-status__light-tooltip \{[^}]*font-size: 13px;/)
    expect(styles).toMatch(/\.floating-assistant-global-status__light-tooltip \{[^}]*font-family: "Microsoft YaHei UI", "Microsoft YaHei", "Segoe UI", sans-serif;[^}]*font-size: 13px;[^}]*font-weight: 500;[^}]*line-height: 1\.62;/)
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
    expect(detail).toContain('趣味评论：已开启，会生成候选弹幕，可复制发布为评论。')
    expect(detail).toContain('收藏整理：已开启，可在归档预览中手动执行 DeepSeek 整理。')
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

    expect(status.detail).toBe('视频转写模型：faster-whisper large-v3-turbo · GPU 已就绪\n\n当前转写视频：测试视频 正在转写')
    expect(statusLightTooltip(status)).toContain('视频转写模型：faster-whisper large-v3-turbo · GPU 已就绪')
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

    expect(matching.detail).toContain('视频转写模型：faster-whisper large-v3 · GPU 已就绪')
    expect(matching.detail).toContain('转写结果：本次已完成 1 个视频，文稿已保存到档案库。')
    expect(mismatched.detail).toContain('视频转写模型：Whisper small')
    expect(mismatched.detail).not.toContain('GPU 已就绪')
  })

  it('uses the concise empty transcription wording when no video is available', () => {
    const status = FloatingAssistantAppModule.resolveGlobalTranscriptionStatus(
      { items: [], sessionCompletedCount: 0 },
      'whisper-small'
    )

    expect(status.detail).toContain('当前转写视频：暂无视频转写')
    expect(status.detail).not.toContain('暂无可用转写')
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

  it('refreshes an existing archive version when its DeepSeek summary is saved asynchronously', () => {
    const item = {
      id: 'account:100:bvid:BV1summary', accountMid: '100', bvid: 'BV1summary', url: 'https://www.bilibili.com/video/BV1summary', title: 'Video', status: 'completed' as const,
      archiveRegistrationStatus: 'registered' as const, archiveNoteId: 'bvid:BV1summary', archiveVersionId: 'version-summary', summaryStatus: 'saved' as const,
      createdAt: '2026-07-28T00:00:00.000Z', updatedAt: '2026-07-28T00:00:01.000Z'
    }
    const version = {
      id: 'version-summary', createdAt: item.createdAt, plainTranscript: '文稿', summaryText: '',
      note: { id: 'bvid:BV1summary', source: { accountMid: '100', bvid: 'BV1summary', title: 'Video', tags: [], url: '' }, transcriptSource: 'audio' as const, transcript: [], chapters: [], overview: emptyOverview, annotations: [], userMemo: '', starred: false, createdAt: item.createdAt, updatedAt: item.updatedAt }
    }

    expect(archiveSnapshotNeedsRefresh([{ id: 'bvid:BV1summary', source: version.note.source, versions: [version], createdAt: item.createdAt, updatedAt: item.updatedAt }], [item], '100')).toBe(true)
    expect(archiveSnapshotNeedsRefresh([{ id: 'bvid:BV1summary', source: version.note.source, versions: [{ ...version, summaryText: '已生成总结' }], createdAt: item.createdAt, updatedAt: item.updatedAt }], [item], '100')).toBe(false)
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
    const status = resolveFavoriteOrganizationLamp({
      snapshot: null,
      defaultFavoriteSystemEnabled: false,
      ledgers: [defaultLedger],
      favoriteLedgerStatus: null
    })
    expect(status).toMatchObject({ label: '\u6574\u7406\u7a7a\u95f2', tone: 'idle' })
    expect(status.detail.split('\n')[0]).toBe('默认收藏夹体系已关闭。')
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
    })).toMatchObject({ label: '\u672a\u5907\u518c', tone: 'error' })
  })

  it('uses the backup status only when no real organization round is active', () => {
    const status = resolveFavoriteOrganizationLamp({
      snapshot: null,
      defaultFavoriteSystemEnabled: true,
      ledgers: [defaultLedger],
      favoriteLedgerStatus: null
    })
    expect(status).toMatchObject({ label: '\u672a\u5907\u518c', tone: 'error' })
    expect(status.detail.split('\n')[0]).toBe('默认收藏夹体系已开启。')
    expect(status.detail.split('\n')).toEqual(expect.arrayContaining([
      expect.stringMatching(/^备册：/),
      expect.stringMatching(/^收藏夹：/),
      expect.stringMatching(/^整理收藏：/)
    ]))
    expect(status.detail).toContain('备册是批阅分类和同步 B 站收藏的核心')
    expect(status.detail).toContain('已勾选启用的 bilimi 收藏夹会参与批阅分类和整理收藏分类')
    expect(status.detail).toContain('整理收藏会把原有收藏夹的视频复制到 bilimi 收藏夹，不会移出原有普通收藏夹')

    expect(status.detail.split('\n')).toHaveLength(5)
    expect(status.detail).not.toContain('小咪提醒')

    expect(resolveFavoriteOrganizationLamp({
      snapshot: workspace('scanning'),
      defaultFavoriteSystemEnabled: true,
      ledgers: [defaultLedger],
      favoriteLedgerStatus: null
    })).toMatchObject({ label: '\u6574\u7406\u626b\u63cf\u4e2d', tone: 'running' })
  })

  it('describes an empty backup state as having no backed-up ledgers, not no enabled ledgers', () => {
    const status = resolveFavoriteOrganizationLamp({
      snapshot: null,
      defaultFavoriteSystemEnabled: true,
      ledgers: [],
      favoriteLedgerStatus: null
    })

    expect(status.detail).toContain('备册：当前没有已备册的收藏夹。')
    expect(status.detail).toContain('请尽快勾选启用收藏夹并备册哦～')
  })

  it('separates favorite backup, enabled ledgers, and idle organization details', () => {
    const backed: FavoriteLedger = {
      ...defaultLedger,
      bilibiliFolderId: '101',
      bindingState: 'bound'
    }
    const unbacked: FavoriteLedger = {
      ...defaultLedger,
      id: 'custom-draft',
      displayName: 'bilimi·草稿',
      isDefault: false,
      syncState: 'local-draft'
    }
    const unbound: FavoriteLedger = {
      ...defaultLedger,
      id: 'custom-unbound',
      displayName: 'bilimi·未绑定',
      isDefault: false,
      bilibiliFolderId: '102',
      bindingState: 'unbound'
    }

    const status = resolveFavoriteOrganizationLamp({
      snapshot: null,
      defaultFavoriteSystemEnabled: true,
      ledgers: [backed, unbacked, unbound],
      favoriteLedgerStatus: {
        ok: false,
        ledgers: [backed, unbacked, unbound],
        missingLedgerIds: ['custom-draft'],
        unboundLedgerIds: ['custom-unbound'],
        backupConflictLedgerIds: []
      }
    })

    expect(status.detail.split('\n')).toEqual([
      '默认收藏夹体系已开启。',
      '',
      '备册：当前启用 3 个 bilimi 收藏夹，其中 1 个已备册、1 个未备册、1 个未绑定。',
      '收藏夹：当前共有 3 个收藏夹，其中 3 个已启用、1 个未保存。已勾选启用的 bilimi 收藏夹会参与批阅分类和整理收藏分类。',
      '整理收藏：当前未整理。整理收藏会把原有收藏夹的视频复制到 bilimi 收藏夹，不会移出原有普通收藏夹。'
    ])
  })

  it('keeps a remote-only draft out of the global backup status while summarizing its local draft', () => {
    const onDismiss = vi.fn()
    const draft: FavoriteLedger = {
      id: 'custom-remote-hello', displayName: 'bilimi\u00b7\u4f60\u597d', keywords: [], enabled: false,
      priority: 20_000, bilibiliFolderId: '88', bindingState: 'unbound', syncState: 'local-draft', isDefault: false
    }
    const status = resolveFavoriteOrganizationLamp({
      snapshot: null,
      defaultFavoriteSystemEnabled: true,
      ledgers: [draft],
      favoriteLedgerStatus: {
        ok: true,
        ledgers: [draft],
        missingLedgerIds: [],
        unboundLedgerIds: [],
        remoteOnlyDraftLedgerIds: ['custom-remote-hello'],
        message: 'remote-only',
      },
      onDismissRemoteDraftReminder: onDismiss
    })

    expect(status).toMatchObject({ label: '\u672a\u5907\u518c', tone: 'error' })
    expect(status.detail).toContain('其中 1 个未启用、1 个未保存。')
    expect(status.detail).not.toContain('发现几个 B 站疑似 bilimi 收藏夹')
    expect(status.detailAction).toBeUndefined()
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('does not offer a global status-light dismissal for remote drafts', () => {
    const source = readFloatingAssistantAppRootSource()
    const globalLamp = source.slice(
      source.indexOf('const globalLedgerStatus'),
      source.indexOf('const globalStatusItems')
    )

    expect(globalLamp).not.toContain('detailAction: args.onDismissRemoteDraftReminder')
    expect(source).not.toContain('const dismissAllRemoteDraftReminders')
  })

  it.each([
    ['previewing', '\u7b49\u5f85\u786e\u8ba4'],
    ['frozen', '\u7b49\u5f85\u6267\u884c'],
    ['executing', '\u6574\u7406\u6267\u884c\u4e2d'],
    ['reconciling', '\u540c\u6b65\u5f85\u68c0\u67e5'],
    ['completed', '\u6574\u7406\u5b8c\u6210\uff0c\u5f85\u5907\u518c']
  ] as const)('prioritizes the %s workspace state over backup status', (status, label) => {
    expect(resolveFavoriteOrganizationLamp({
      snapshot: workspace(status),
      defaultFavoriteSystemEnabled: true,
      ledgers: [defaultLedger],
      favoriteLedgerStatus: null
    }).label).toBe(label)
  })

  it('keeps the backup reminder after the completed workspace is acknowledged', () => {
    expect(resolveFavoriteOrganizationLamp({
      snapshot: workspace('completed'),
      acknowledgedWorkspaceId: 'workspace',
      defaultFavoriteSystemEnabled: true,
      ledgers: [defaultLedger],
      favoriteLedgerStatus: null
    })).toMatchObject({ label: '整理完成，待备册', tone: 'warn' })

    expect(resolveFavoriteOrganizationLamp({
      snapshot: { ...workspace('completed'), workspaceId: 'workspace-next' },
      acknowledgedWorkspaceId: 'workspace',
      defaultFavoriteSystemEnabled: true,
      ledgers: [defaultLedger],
      favoriteLedgerStatus: null
    })).toMatchObject({ label: '整理完成，待备册', tone: 'warn' })
  })
})

describe('resolveGlobalDeepSeekStatus', () => {
  const preferences = createInitialAssistantPreferences({
    deepseekEnabled: true,
    deepseekApiKeyStored: true,
    deepseekModel: 'deepseek-v4-flash'
  })

  it('shows the queued transcription summary as DeepSeek work with its video title', () => {
    const status = FloatingAssistantAppModule.resolveGlobalDeepSeekStatus(
      preferences,
      'connected',
      [],
      [],
      {
        sessionCompletedCount: 0,
        items: [{
          id: 'summary-queued',
          url: 'https://www.bilibili.com/video/BV1summary',
          title: '排队总结的视频',
          status: 'completed',
          summarizeWithDeepSeek: true,
          summaryStatus: 'queued',
          createdAt: '2026-08-20T00:00:00.000Z',
          updatedAt: '2026-08-20T00:00:01.000Z'
        }]
      }
    )

    expect(status.label).toBe('DeepSeek 工作中')
    expect(status.tone).toBe('running')
    expect(status.detail).toContain('等待生成 DeepSeek 总结：排队总结的视频')
  })

  it('shows a generating transcription summary as DeepSeek work and returns to connected after saving', () => {
    const generating = FloatingAssistantAppModule.resolveGlobalDeepSeekStatus(
      preferences,
      'connected',
      [],
      [],
      {
        sessionCompletedCount: 0,
        items: [{
          id: 'summary-generating',
          url: 'https://www.bilibili.com/video/BV1summary',
          title: '正在总结的视频',
          status: 'completed',
          summarizeWithDeepSeek: true,
          summaryStatus: 'generating',
          createdAt: '2026-08-20T00:00:00.000Z',
          updatedAt: '2026-08-20T00:00:01.000Z'
        }]
      }
    )
    expect(generating.detail).toContain('正在生成 DeepSeek 总结：正在总结的视频')

    const saved = FloatingAssistantAppModule.resolveGlobalDeepSeekStatus(
      preferences,
      'connected',
      [],
      [],
      {
        sessionCompletedCount: 1,
        items: [{
          id: 'summary-generating',
          url: 'https://www.bilibili.com/video/BV1summary',
          title: '正在总结的视频',
          status: 'completed',
          summarizeWithDeepSeek: true,
          summaryStatus: 'saved',
          createdAt: '2026-08-20T00:00:00.000Z',
          updatedAt: '2026-08-20T00:00:01.000Z'
        }]
      }
    )
    expect(saved.label).toBe('DeepSeek 已连接')
    expect(saved.tone).toBe('ok')
  })
})

describe('current settings copy and feedback continuation contract', () => {
  it('uses the confirmed default favorite-system wording without DeepSeek participation', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/FloatingAssistantApp.tsx'), 'utf8')
    const start = source.indexOf('data-settings-section="favorites"')
    const section = source.slice(start, source.indexOf('</fieldset>', start))

    expect(section).toContain('\u5f00\u542f\u540e\uff0c\u4e03\u4e2a\u9ed8\u8ba4\u6536\u85cf\u5939\u4f1a\u56fa\u5b9a\u53c2\u4e0e\u6279\u9605\u9884\u5206\u7c7b\u3001\u6574\u7406\u6536\u85cf\u5206\u7c7b\u3001\u5907\u518c\uff1b\u9002\u5408\u5927\u591a\u6570\u4f7f\u7528\u573a\u666f\u3002')
    expect(section).toContain('\u5173\u95ed\u540e\uff0c\u4e03\u4e2a\u9ed8\u8ba4\u6536\u85cf\u5939\u5c06\u505c\u7528\uff0c\u4e0d\u518d\u53c2\u4e0e\u5206\u7c7b\uff0c\u4e0d\u4f1a\u5907\u518c\uff1b\u4e3b\u4eba\u53ef\u4ee5 DIY \u81ea\u5df1\u7684\u6536\u85cf\u5939\u4f53\u7cfb\u3002')
    expect(section).toContain('\u5df2\u5907\u518c\u5230b\u7ad9\u4f46\u4e0d\u518d\u9700\u8981\u7684\u9ed8\u8ba4\u6536\u85cf\u5939\uff0c\u53ef\u5728\u638c\u5e93\u6536\u85cf\u5939\u533a\u57df\u7edf\u4e00\u5220\u9664\u3002')
    expect(section).not.toContain('\u3001DeepSeek \u548c\u5907\u518c')
  })

  it('keeps Bilibili connection titles and descriptions in a shared copy column', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/FloatingAssistantApp.tsx'), 'utf8')

    expect(source).toContain('className="assistant-settings__bilibili-connection-choice-copy"')
  })

  it('recalculates a visible feedback continuation after layout changes', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/FloatingAssistantApp.tsx'), 'utf8')

    expect(source).toContain('resizeObserver?.observe(globalFeedbackMessageRef.current)')
  })
})
