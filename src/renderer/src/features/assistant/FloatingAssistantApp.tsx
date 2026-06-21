import type {
  AssistantAction,
  AssistantAutomationResult,
  AssistantPreferences,
  FavoriteLedgerStatus,
  NotePosterSummary,
  RecommendationKind,
  VideoAudioTranscriptionProgress,
  VideoNote,
  VideoNoteArchiveEntry
} from '@shared/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { composeMemorialComments } from '../comments/commentComposer'
import { classifyVideoContent } from '../recommendation/videoClassifier'
import { describeRecommendation } from '../recommendation/recommendationRules'
import {
  createInitialAssistantPreferences,
  recordAssistantPreferenceFeedback
} from '../state/assistantState'
import { CoinPrompt } from './CoinPrompt'
import { CommentChooser } from './CommentChooser'
import { CommentIntentDialog } from './CommentIntentDialog'
import { FavoriteLedgerPanel } from './FavoriteLedgerPanel'
import { MemorialPanel } from './MemorialPanel'
import { VideoNoteArchivePanel } from '../notes/VideoNoteArchivePanel'
import clickedPetUrl from '../../assets/pet/blue-white-maid/character/big-head/clicked.png'
import hintPetUrl from '../../assets/pet/blue-white-maid/character/big-head/hint.png'
import idlePetUrl from '../../assets/pet/blue-white-maid/character/big-head/idle.png'
import workingPetUrl from '../../assets/pet/blue-white-maid/character/big-head/working.png'
import type { AssistantSnapshot } from './assistantRuntimeTypes'
import type { FavoriteLedgerPreview, FavoriteLedgerPreviewItem } from '../favorites/favoriteLedgerPreview'

const CURRENT_TITLE = '早八生存实录'
const BILIBILI_TITLE_SUFFIX = /\s*[-_]\s*哔哩哔哩.*$/i
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-flash'
const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com'
const VIDEO_CATEGORY_LABELS: Record<RecommendationKind, string> = {
  funny: '解闷小品',
  humor: '解闷小品',
  knowledge: '见闻增广',
  story: '剧情留档',
  suspicious: '谨慎观察'
}

type AssistantWorkspaceTab = 'review' | 'notes' | 'ledger' | 'settings'
type AssistantWorkspaceView = AssistantWorkspaceTab | 'noteArchive'

const WORKSPACE_TABS: Array<{
  id: AssistantWorkspaceTab
  label: string
  icon: string
  iconAlt: string
}> = [
  { id: 'review', label: '批阅', icon: hintPetUrl, iconAlt: '小mi批阅' },
  { id: 'notes', label: '札记', icon: workingPetUrl, iconAlt: '小mi札记' },
  { id: 'ledger', label: '掌库', icon: clickedPetUrl, iconAlt: '小mi掌库' },
  { id: 'settings', label: '设置', icon: idlePetUrl, iconAlt: '小mi设置' }
]

type FloatingAssistantAppProps = {
  mode?: 'floating' | 'sidebar'
  activeTab?: AssistantWorkspaceTab
  onActiveTabChange?: (tab: AssistantWorkspaceTab) => void
  onRequestCollapse?: () => void
}

type ActionFeedback = {
  tone: 'progress' | 'success' | 'error'
  message: string
  steps: string[]
  missingTargets: string[]
}

function createFallbackSnapshot(): AssistantSnapshot {
  const preferences = createInitialAssistantPreferences()

  return {
    preferences,
    favoriteLedgerStatus: null,
    videoContentContext: { title: CURRENT_TITLE },
    videoTitle: CURRENT_TITLE
  }
}

function stripBilimiPrefix(displayName: string) {
  return displayName.replace(/^Bilimi[·\s-]*/, '').trim()
}

function normalizeTitle(title: string) {
  return title.replace(BILIBILI_TITLE_SUFFIX, '').trim() || CURRENT_TITLE
}

function createDefaultResult(message: string): AssistantAutomationResult {
  return {
    ok: true,
    steps: [],
    missingTargets: [],
    message
  }
}

function localizeDeepSeekStatusMessage(message: string): string {
  if (message === 'DeepSeek connection succeeded.') {
    return 'DeepSeek 连接成功。'
  }

  if (message === 'DeepSeek connection failed.') {
    return 'DeepSeek 连接失败。'
  }

  if (message === 'DeepSeek is not configured.') {
    return '请先启用 DeepSeek 并填写 API 密钥。'
  }

  return message
    .replace(/^DeepSeek API request failed:/, 'DeepSeek API 请求失败：')
    .replace(/^DeepSeek response did not include any content\.$/, 'DeepSeek 响应没有返回内容。')
    .replace(/^DeepSeek response could not be parsed\.$/, 'DeepSeek 响应解析失败。')
    .replace(/^DeepSeek response schema was invalid\.$/, 'DeepSeek 响应格式无效。')
}

function applyPosterSummaryToNote(note: VideoNote, poster: NotePosterSummary): VideoNote {
  const summaryLines = [poster.subtitle, ...poster.keyPoints]
    .map((line) => line.trim())
    .filter(Boolean)

  return {
    ...note,
    overview: {
      ...note.overview,
      shortSummary: summaryLines.length > 0 ? summaryLines : note.overview.shortSummary,
      keywords: poster.keywords.length > 0 ? poster.keywords : note.overview.keywords
    },
    updatedAt: new Date().toISOString()
  }
}

export function FloatingAssistantApp({
  mode = 'floating',
  activeTab: controlledActiveTab,
  onActiveTabChange,
  onRequestCollapse
}: FloatingAssistantAppProps = {}) {
  const [snapshot, setSnapshot] = useState<AssistantSnapshot | null>(null)
  const [preferences, setPreferences] = useState<AssistantPreferences>(() =>
    createInitialAssistantPreferences()
  )
  const [favoriteLedgerStatus, setFavoriteLedgerStatus] = useState<FavoriteLedgerStatus | null>(null)
  const [uncontrolledActiveTab, setUncontrolledActiveTab] =
    useState<AssistantWorkspaceTab>('review')
  const [coinPromptOpen, setCoinPromptOpen] = useState(false)
  const [commentChooserOpen, setCommentChooserOpen] = useState(false)
  const [commentIntentOpen, setCommentIntentOpen] = useState(false)
  const [commentIntentBusy, setCommentIntentBusy] = useState(false)
  const [commentIntentError, setCommentIntentError] = useState('')
  const [aiCommentDrafts, setAiCommentDrafts] = useState<string[]>([])
  const [runningAction, setRunningAction] = useState<AssistantAction | null>(null)
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null)
  const [pageClickOnly, setPageClickOnly] = useState(true)
  const [videoNote, setVideoNote] = useState<VideoNote | null>(null)
  const [videoNoteArchives, setVideoNoteArchives] = useState<VideoNoteArchiveEntry[]>([])
  const [videoNoteLoading, setVideoNoteLoading] = useState(false)
  const [transcriptionProgress, setTranscriptionProgress] =
    useState<VideoAudioTranscriptionProgress | null>(null)
  const [deepSeekApiKeyDraft, setDeepSeekApiKeyDraft] = useState('')
  const [deepSeekStatusMessage, setDeepSeekStatusMessage] = useState('')
  const mounted = useRef(false)
  const activeTab = controlledActiveTab ?? uncontrolledActiveTab
  const [activeView, setActiveView] = useState<AssistantWorkspaceView>(activeTab)
  const isSidebarMode = mode === 'sidebar'

  function setActiveTab(tab: AssistantWorkspaceTab) {
    setActiveView(tab)

    if (controlledActiveTab === undefined) {
      setUncontrolledActiveTab(tab)
    }

    onActiveTabChange?.(tab)
  }

  const loadSnapshot = useCallback(async ({ resetVideoNote = false } = {}) => {
    try {
      const nextSnapshot =
        (await window.bilimiDesktop?.requestAssistantSnapshot?.()) ?? createFallbackSnapshot()

      if (!mounted.current) {
        return
      }

      setSnapshot(nextSnapshot)
      setPreferences(createInitialAssistantPreferences(nextSnapshot.preferences))
      setFavoriteLedgerStatus(nextSnapshot.favoriteLedgerStatus)

      if (resetVideoNote) {
        setVideoNote(null)
      }
    } catch (error) {
      if (!mounted.current) {
        return
      }

      const fallback = createFallbackSnapshot()
      setSnapshot(fallback)
      setPreferences(fallback.preferences)
      setFavoriteLedgerStatus(fallback.favoriteLedgerStatus)
      setFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : '读取当前视频时遇到未知差错。',
        steps: [],
        missingTargets: []
      })
    }
  }, [])

  useEffect(() => {
    setActiveView(activeTab)
  }, [activeTab])

  useEffect(() => {
    mounted.current = true

    void loadSnapshot()
    void loadVideoNoteArchives()

    return () => {
      mounted.current = false
    }
  }, [loadSnapshot])

  useEffect(() => {
    return window.bilimiDesktop?.onAssistantSnapshotChanged?.(() => {
      void loadSnapshot({ resetVideoNote: true })
    })
  }, [loadSnapshot])

  useEffect(() => {
    return window.bilimiDesktop?.onVideoAudioTranscriptionProgress?.((progress) => {
      setTranscriptionProgress(progress)
    })
  }, [])

  const resolvedSnapshot = snapshot ?? createFallbackSnapshot()
  const resolvedVideoTitle = normalizeTitle(resolvedSnapshot.videoTitle)
  const currentClassification = useMemo(
    () => classifyVideoContent(resolvedSnapshot.videoContentContext, preferences.favoriteLedgers),
    [preferences.favoriteLedgers, resolvedSnapshot.videoContentContext]
  )
  const currentKind = currentClassification.ledgerId
  const recommendation = useMemo(() => describeRecommendation(currentKind), [currentKind])
  const commentDrafts = useMemo(
    () => composeMemorialComments(currentKind, resolvedVideoTitle),
    [currentKind, resolvedVideoTitle]
  )
  const activeCommentDrafts = aiCommentDrafts.length > 0 ? aiCommentDrafts : commentDrafts
  const videoCategory =
    VIDEO_CATEGORY_LABELS[currentKind] || stripBilimiPrefix(currentClassification.displayName) || currentKind
  const actionsLocked =
    runningAction !== null || coinPromptOpen || commentChooserOpen || commentIntentOpen

  async function persistPreferences(nextPreferences: AssistantPreferences) {
    setPreferences(nextPreferences)

    if (window.bilimiDesktop?.savePreferences) {
      const saved = await window.bilimiDesktop.savePreferences(nextPreferences)
      setPreferences(createInitialAssistantPreferences(saved))
    }
  }

  function choosePetStyle(petStyle: AssistantPreferences['petStyle']) {
    void persistPreferences({
      ...preferences,
      petStyle
    })
  }

  function wakeAssistantPet() {
    void window.bilimiDesktop?.wakeAssistantPet?.()
  }

  function closeAssistantPet() {
    window.bilimiDesktop?.closeAssistantPet?.()
  }

  function updateDeepSeekPreference(patch: Partial<AssistantPreferences>) {
    setPreferences((current) => ({
      ...current,
      ...patch
    }))
  }

  async function saveDeepSeekSettings() {
    const keyDraft = deepSeekApiKeyDraft.trim()

    if (keyDraft) {
      await window.bilimiDesktop?.saveDeepSeekApiKey?.(keyDraft)
    }

    await persistPreferences(preferences)
  }

  async function testDeepSeekConnection() {
    if (!window.bilimiDesktop?.testDeepSeekConnection) {
      setDeepSeekStatusMessage('DeepSeek 测试功能未加载，请重启应用后再试。')
      return
    }

    await saveDeepSeekSettings()
    const result = await window.bilimiDesktop.testDeepSeekConnection()
    setDeepSeekStatusMessage(localizeDeepSeekStatusMessage(result.message))
  }

  async function resetDeepSeekSettings() {
    const nextPreferences = {
      ...preferences,
      deepseekEnabled: false,
      deepseekApiKeyStored: false,
      deepseekModel: DEFAULT_DEEPSEEK_MODEL,
      deepseekBaseUrl: DEFAULT_DEEPSEEK_BASE_URL
    }

    setDeepSeekApiKeyDraft('')
    await window.bilimiDesktop?.clearDeepSeekApiKey?.()
    await persistPreferences(nextPreferences)
    setDeepSeekStatusMessage('DeepSeek 设置已重置。')
  }

  async function copyDeepSeekRecommendation(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value)
      setDeepSeekStatusMessage(`已复制${label}。`)
    } catch {
      setDeepSeekStatusMessage(`${label}复制失败，请手动复制。`)
    }
  }

  async function persistFeedback(action: AssistantAction, kind: RecommendationKind) {
    const nextPreferences = recordAssistantPreferenceFeedback(preferences, kind, action)
    await persistPreferences(nextPreferences)
  }

  async function generateCommentDrafts(intent: string) {
    setCommentIntentBusy(true)
    setCommentIntentError('')

    try {
      const result = await window.bilimiDesktop?.generateDeepSeek?.({
        kind: 'review-comment',
        intent,
        title: resolvedVideoTitle,
        description: resolvedSnapshot.videoContentContext.description,
        tags: resolvedSnapshot.videoContentContext.tags ?? [],
        classification: currentClassification.displayName || currentKind
      })

      if (!result || result.kind !== 'review-comment') {
        throw new Error('Comment generation failed.')
      }

      setAiCommentDrafts(result.comments)
      setCommentIntentOpen(false)
      setCommentChooserOpen(true)
    } catch (error) {
      setCommentIntentError(error instanceof Error ? error.message : 'Comment generation failed.')
    } finally {
      setCommentIntentBusy(false)
    }
  }

  async function runAction(action: AssistantAction, options?: { coinCount?: 1 | 2; commentDraft?: string }) {
    if (runningAction) {
      return
    }

    setRunningAction(action)
    window.bilimiDesktop?.setAssistantPetState?.('working')
    setFeedback({
      tone: 'progress',
      message: action === '阅' ? '正在登记已阅。' : '正在代批，请稍候。',
      steps: [],
      missingTargets: []
    })

    try {
      const result =
        (await window.bilimiDesktop?.runAssistantAction?.(action, {
          ...options,
          pageClickOnly
        })) ?? createDefaultResult('此折已阅。')

      if (result.ok && action !== '阅') {
        await persistFeedback(action, currentKind)
      }

      setFeedback({
        tone: result.ok ? 'success' : 'error',
        message: result.message,
        steps: result.steps,
        missingTargets: result.missingTargets
      })
      window.bilimiDesktop?.setAssistantPetState?.(result.ok ? 'hint' : 'error')
    } catch (error) {
      setFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : '代批时遇到未知差错。',
        steps: [],
        missingTargets: []
      })
      window.bilimiDesktop?.setAssistantPetState?.('error')
    } finally {
      setRunningAction(null)
    }
  }

  function handleAction(action: AssistantAction) {
    if (actionsLocked) {
      return
    }

    setFeedback(null)

    if (action === '赐') {
      setCoinPromptOpen(true)
      return
    }

    if (action === '表') {
      setAiCommentDrafts([])
      setCommentIntentError('')
      if (!preferences.deepseekEnabled) {
        setCommentChooserOpen(true)
        return
      }
      setCommentIntentOpen(true)
      return
    }

    void runAction(action)
  }

  async function generateVideoNote(manualTranscript?: string) {
    setVideoNoteLoading(true)

    try {
      const note = (await window.bilimiDesktop?.generateVideoNote?.(manualTranscript)) ?? null
      setVideoNote(note)
      return note
    } finally {
      setVideoNoteLoading(false)
    }
  }

  async function generateVideoNoteFromAudio() {
    setVideoNoteLoading(true)

    try {
      const note = (await window.bilimiDesktop?.generateVideoNoteFromAudio?.()) ?? null
      let noteToStore = note

      if (noteToStore && preferences.deepseekEnabled) {
        const poster = await generateNotePoster(noteToStore)
        noteToStore = applyPosterSummaryToNote(noteToStore, poster)
      }

      setVideoNote(noteToStore)

      if (noteToStore) {
        const archives = await window.bilimiDesktop?.saveVideoNoteArchiveVersion?.(noteToStore)

        if (archives) {
          setVideoNoteArchives(archives)
        }
      }

      return noteToStore
    } finally {
      setVideoNoteLoading(false)
    }
  }

  async function generateNotePoster(note: VideoNote) {
    const result = await window.bilimiDesktop?.generateDeepSeek?.({ kind: 'note-poster', note })

    if (!result || result.kind !== 'note-poster') {
      throw new Error('Poster generation failed.')
    }

    return result.poster
  }

  async function loadVideoNoteArchives() {
    const archives = (await window.bilimiDesktop?.loadVideoNoteArchives?.()) ?? []
    setVideoNoteArchives(archives)
    return archives
  }

  async function deleteVideoNoteArchiveEntry(archiveId: string) {
    const archives = (await window.bilimiDesktop?.deleteVideoNoteArchiveEntry?.(archiveId)) ?? []
    setVideoNoteArchives(archives)
  }

  async function deleteVideoNoteArchiveVersion(archiveId: string, versionId: string) {
    const archives =
      (await window.bilimiDesktop?.deleteVideoNoteArchiveVersion?.(archiveId, versionId)) ?? []
    setVideoNoteArchives(archives)
  }

  async function saveVideoNote(note: VideoNote) {
    await window.bilimiDesktop?.saveVideoNote?.(note)
  }

  function handleChangeVideoNote(note: VideoNote) {
    setVideoNote(note)
  }


  async function ensureFavoriteLedgers() {
    const result =
      (await window.bilimiDesktop?.ensureFavoriteLedgers?.()) ?? createDefaultResult('册目已备齐。')
    const nextSnapshot = await window.bilimiDesktop?.requestAssistantSnapshot?.()

    if (nextSnapshot) {
      setFavoriteLedgerStatus(nextSnapshot.favoriteLedgerStatus)
      setPreferences(createInitialAssistantPreferences(nextSnapshot.preferences))
    }

    return result
  }

  async function saveFavoriteLedgers(favoriteLedgers: AssistantPreferences['favoriteLedgers']) {
    const result =
      (await window.bilimiDesktop?.saveFavoriteLedgers?.(favoriteLedgers)) ??
      createDefaultResult('掌库已保存。')
    const nextSnapshot = await window.bilimiDesktop?.requestAssistantSnapshot?.()

    if (nextSnapshot) {
      setFavoriteLedgerStatus(nextSnapshot.favoriteLedgerStatus)
      setPreferences(createInitialAssistantPreferences(nextSnapshot.preferences))
    } else {
      await persistPreferences({
        ...preferences,
        favoriteLedgers
      })
    }

    return result
  }

  async function scanOldFavorites(): Promise<FavoriteLedgerPreview> {
    return (
      (await window.bilimiDesktop?.scanOldFavorites?.()) ?? {
        items: [],
        skippedSourceFolderTitles: []
      }
    )
  }

  async function executeOldFavoritePlan(
    items: FavoriteLedgerPreviewItem[]
  ): Promise<AssistantAutomationResult> {
    return (
      (await window.bilimiDesktop?.executeOldFavoritePlan?.(items)) ??
      createDefaultResult('旧藏已归册。')
    )
  }

  function closeAssistant() {
    if (isSidebarMode) {
      onRequestCollapse?.()
      return
    }

    window.bilimiDesktop?.closeFloatingAssistant?.()
  }

  const workspace = (
    <section className={isSidebarMode ? 'assistant-sidebar-workspace' : 'floating-assistant-workspace'}>
        <div className="floating-assistant-tabs" role="tablist" aria-label="助手功能">
          {WORKSPACE_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-label={tab.label}
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
            >
              <img className="floating-assistant-tabs__pet" src={tab.icon} alt={tab.iconAlt} />
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {activeView === 'ledger' ? (
          <FavoriteLedgerPanel
            ledgers={preferences.favoriteLedgers}
            missingLedgerIds={favoriteLedgerStatus?.missingLedgerIds ?? []}
            onClose={() => setActiveTab('review')}
            onEnsureLedgers={ensureFavoriteLedgers}
            onSaveLedgers={saveFavoriteLedgers}
            onScanOldFavorites={scanOldFavorites}
            onExecuteOldFavoritePlan={executeOldFavoritePlan}
          />
        ) : activeView === 'settings' ? (
          <section className="assistant-settings" aria-label="助手设置">
            <header>
              <h2>设置</h2>
            </header>
            <fieldset className="assistant-settings__group">
              <legend>宠物样式</legend>
              <label>
                <input
                  type="radio"
                  name="pet-style"
                  checked={preferences.petStyle === 'big-head'}
                  onChange={() => choosePetStyle('big-head')}
                />
                <span>大头 Q 版</span>
              </label>
              <label>
                <input
                  type="radio"
                  name="pet-style"
                  checked={preferences.petStyle === 'classic'}
                  onChange={() => choosePetStyle('classic')}
                />
                <span>高清重置版</span>
              </label>
              <div className="assistant-settings__pet-actions">
                <button type="button" onClick={wakeAssistantPet}>
                  唤醒宠物
                </button>
                <button type="button" onClick={closeAssistantPet}>
                  关闭宠物
                </button>
              </div>
            </fieldset>
            <fieldset className="assistant-settings__group assistant-settings__group--deepseek">
              <legend>DeepSeek</legend>
              <label>
                <input
                  type="checkbox"
                  checked={preferences.deepseekEnabled}
                  onChange={(event) =>
                    updateDeepSeekPreference({ deepseekEnabled: event.currentTarget.checked })
                  }
                />
                <span>启用 DeepSeek</span>
              </label>
              <p className="assistant-settings__deepseek-help">
                开启后可使用批阅的拟奏短评、札记中的一图流总结、宠物对话功能。
              </p>
              <label>
                <span>DeepSeek API 密钥</span>
                <input
                  type="password"
                  value={deepSeekApiKeyDraft}
                  placeholder={preferences.deepseekApiKeyStored ? '已保存' : ''}
                  onChange={(event) => setDeepSeekApiKeyDraft(event.currentTarget.value)}
                />
              </label>
              <label>
                <span>DeepSeek 模型</span>
                <input
                  type="text"
                  value={preferences.deepseekModel}
                  onChange={(event) =>
                    updateDeepSeekPreference({ deepseekModel: event.currentTarget.value })
                  }
                />
              </label>
              <label>
                <span>DeepSeek 服务地址</span>
                <input
                  type="url"
                  value={preferences.deepseekBaseUrl}
                  onChange={(event) =>
                    updateDeepSeekPreference({ deepseekBaseUrl: event.currentTarget.value })
                  }
                />
              </label>
              <div className="assistant-settings__actions">
                <button type="button" onClick={() => void saveDeepSeekSettings()}>
                  保存 DeepSeek
                </button>
                <button type="button" onClick={() => void testDeepSeekConnection()}>
                  测试 DeepSeek
                </button>
                <button type="button" onClick={() => void resetDeepSeekSettings()}>
                  重置 DeepSeek
                </button>
              </div>
              <aside className="assistant-settings__deepseek-recommendation">
                <strong>中转站推荐</strong>
                <p>
                  <a href="https://yunshulink.com/" target="_blank" rel="noreferrer">
                    云枢智元
                  </a>
                  <span>官网 DeepSeek 价格 3 折起</span>
                </p>
                <p>API 密钥：创建令牌后，令牌分组请选择 deepseek（限时特价），复制密钥到这里使用。</p>
                <p className="assistant-settings__copy-row">
                  <span>推荐模型：deepseek-v4-pro</span>
                  <button
                    className="assistant-settings__copy-button"
                    type="button"
                    aria-label="复制推荐模型"
                    onClick={() => void copyDeepSeekRecommendation('deepseek-v4-pro', '推荐模型')}
                  >
                    <span className="assistant-settings__copy-icon" aria-hidden="true" />
                  </button>
                </p>
                <p className="assistant-settings__copy-row">
                  <span>服务器地址：https://api.yunshulink.com/v1</span>
                  <button
                    className="assistant-settings__copy-button"
                    type="button"
                    aria-label="复制服务器地址"
                    onClick={() =>
                      void copyDeepSeekRecommendation(
                        'https://api.yunshulink.com/v1',
                        '服务器地址'
                      )
                    }
                  >
                    <span className="assistant-settings__copy-icon" aria-hidden="true" />
                  </button>
                </p>
              </aside>
              {deepSeekStatusMessage ? <p role="status">{deepSeekStatusMessage}</p> : null}
            </fieldset>
          </section>
        ) : activeView === 'noteArchive' ? (
          <VideoNoteArchivePanel
            archives={videoNoteArchives}
            onClose={() => setActiveTab('notes')}
            onOpenSource={(url) => window.open(url)}
            onDeleteEntry={deleteVideoNoteArchiveEntry}
            onDeleteVersion={deleteVideoNoteArchiveVersion}
          />
        ) : (
          <MemorialPanel
            recommendation={recommendation}
            commentDrafts={commentDrafts}
            deepSeekEnabled={preferences.deepseekEnabled}
            videoCategory={videoCategory}
            videoTitle={resolvedVideoTitle}
            onAction={handleAction}
            onClose={closeAssistant}
            closeLabel={isSidebarMode ? '收起侧栏' : '合折'}
            showCloseButton={!isSidebarMode}
            onGenerateVideoNote={generateVideoNote}
            onTranscribeVideoAudio={generateVideoNoteFromAudio}
            onGeneratePoster={generateNotePoster}
            onSaveVideoNote={saveVideoNote}
            onChangeVideoNote={handleChangeVideoNote}
            pageClickOnly={pageClickOnly}
            onPageClickOnlyChange={setPageClickOnly}
            videoNote={videoNote}
            videoNoteLoading={videoNoteLoading}
            transcriptionProgress={transcriptionProgress}
            runningAction={runningAction}
            actionsLocked={actionsLocked}
            feedback={feedback}
            onOpenVideoNoteArchive={() => {
              void loadVideoNoteArchives()
              setActiveView('noteArchive')
            }}
            initialTab={activeView === 'notes' ? 'notes' : 'review'}
            showTabs={false}
          />
        )}

        {coinPromptOpen ? (
          <CoinPrompt
            onChoose={(coinCount) => {
              setCoinPromptOpen(false)
              void runAction('赐', { coinCount })
            }}
            onCancel={() => setCoinPromptOpen(false)}
          />
        ) : null}

        {commentIntentOpen ? (
          <CommentIntentDialog
            busy={commentIntentBusy}
            error={commentIntentError}
            onSubmit={(intent) => void generateCommentDrafts(intent)}
            onCancel={() => {
              setCommentIntentOpen(false)
              setCommentIntentError('')
              setAiCommentDrafts([])
            }}
          />
        ) : null}

        {commentChooserOpen ? (
          <CommentChooser
            drafts={activeCommentDrafts}
            onSelect={(commentDraft) => {
              setCommentChooserOpen(false)
              setAiCommentDrafts([])
              void runAction('表', { commentDraft })
            }}
            onCancel={() => {
              setCommentChooserOpen(false)
              setAiCommentDrafts([])
            }}
          />
        ) : null}
    </section>
  )

  if (isSidebarMode) {
    return (
      <div className="assistant-sidebar-embed" aria-label="Bilimi 应用侧栏">
        {workspace}
      </div>
    )
  }

  return (
    <main className="floating-assistant-shell" aria-label="Bilimi 悬浮助手">
      {workspace}
    </main>
  )
}
