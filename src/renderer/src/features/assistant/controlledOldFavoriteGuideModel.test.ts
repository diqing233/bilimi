import { describe, expect, it } from 'vitest'
import type { OldFavoriteWorkspaceSnapshot, OldFavoriteWorkspaceView } from '../../../../shared/oldFavoriteWorkspace'

type GuideModel = {
  currentStep: 'scan' | 'generated' | 'preview' | 'confirm'
  steps: Array<{ id: 'scan' | 'generated' | 'preview' | 'confirm'; available: boolean }>
  primaryAction: string
  progress: { value: number; label: string }
  error: string | null
}

type GuideModelModule = {
  createControlledOldFavoriteGuideModel: (snapshot: OldFavoriteWorkspaceView | null) => GuideModel
}

const snapshot = (overrides: Partial<OldFavoriteWorkspaceSnapshot> = {}): OldFavoriteWorkspaceSnapshot => ({
  version: 1,
  accountMid: '100',
  workspaceId: 'workspace-100',
  status: 'scanning',
  mode: 'incremental',
  segmentSize: 2000,
  hasMultipleSegments: false,
  scan: { phase: 'inventory', failureCount: 0 },
  sourceFolders: [],
  continuationCount: 0,
  segments: [],
  currentSegment: null,
  classifications: {},
  recommendations: { candidates: [], adoptedCandidateIds: [] },
  history: { cursor: 0, length: 0 },
  ...overrides
})

async function loadModel() {
  const moduleName = './controlledOldFavoriteGuideModel'
  return import(moduleName) as Promise<GuideModelModule>
}

describe('createControlledOldFavoriteGuideModel', () => {
  it('derives the scanning guide without opening later steps', async () => {
    const { createControlledOldFavoriteGuideModel } = await loadModel()

    expect(createControlledOldFavoriteGuideModel(snapshot())).toEqual({
      currentStep: 'scan',
      steps: [
        { id: 'scan', available: true },
        { id: 'generated', available: false },
        { id: 'preview', available: false },
        { id: 'confirm', available: false }
      ],
      primaryAction: '正在扫描',
      progress: { value: 0, label: '正在扫描' },
      error: null
    })
  })

  it('derives preview, recovery, and empty displays from snapshots without retaining state', async () => {
    const { createControlledOldFavoriteGuideModel } = await loadModel()
    const preview = snapshot({
      status: 'previewing',
      scan: { phase: 'complete', failureCount: 0 },
      planReadiness: { selectedAidCount: 3, classifiedAidCount: 3, unclassifiedAidCount: 0 }
    })

    expect(createControlledOldFavoriteGuideModel(preview)).toMatchObject({
      currentStep: 'preview',
      primaryAction: '确认并同步到 B 站',
      progress: { value: 1, label: '扫描完成' },
      error: null
    })
    expect(createControlledOldFavoriteGuideModel({
      recovery: 'rebuild-required', preserveCompletedLocalResults: true, accountMid: '100', workspaceId: 'workspace-100'
    })).toMatchObject({
      currentStep: 'scan',
      primaryAction: '重建工作镜像并重新扫描',
      progress: { value: 0, label: '需要重建' },
      error: '工作镜像损坏，已完成的收藏库结果不会丢失。'
    })
    expect(createControlledOldFavoriteGuideModel(null)).toMatchObject({
      currentStep: 'scan',
      primaryAction: '整理旧藏',
      progress: { value: 0, label: '尚未开始' },
      error: null
    })
    expect(preview.status).toBe('previewing')
  })
})
