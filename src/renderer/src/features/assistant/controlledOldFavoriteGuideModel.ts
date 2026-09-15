import type { OldFavoriteWorkspaceView } from '../../../../shared/oldFavoriteWorkspace'

export type ControlledOldFavoriteGuideStep = 'scan' | 'generated' | 'preview' | 'confirm'

export type ControlledOldFavoriteGuideModel = {
  currentStep: ControlledOldFavoriteGuideStep
  steps: Array<{ id: ControlledOldFavoriteGuideStep; available: boolean }>
  primaryAction: string
  progress: { value: number; label: string }
  error: string | null
}

const stepIds: ControlledOldFavoriteGuideStep[] = ['scan', 'generated', 'preview', 'confirm']

function stepsThrough(currentStep: ControlledOldFavoriteGuideStep) {
  const currentIndex = stepIds.indexOf(currentStep)
  return stepIds.map((id, index) => ({ id, available: index <= currentIndex }))
}

export function createControlledOldFavoriteGuideModel(
  snapshot: OldFavoriteWorkspaceView | null
): ControlledOldFavoriteGuideModel {
  if (!snapshot) {
    return {
      currentStep: 'scan',
      steps: stepsThrough('scan'),
      primaryAction: '整理收藏',
      progress: { value: 0, label: '尚未开始' },
      error: null
    }
  }

  if ('recovery' in snapshot) {
    return {
      currentStep: 'scan',
      steps: stepsThrough('scan'),
      primaryAction: '重建工作镜像并重新扫描',
      progress: { value: 0, label: '需要重建' },
      error: '工作镜像损坏，已完成的收藏库结果不会丢失。'
    }
  }

  if (snapshot.scan.phase === 'failed') {
    return {
      currentStep: 'scan',
      steps: stepsThrough('scan'),
      primaryAction: '重新扫描',
      progress: { value: 0, label: '扫描失败' },
      error: snapshot.scan.reason || '请重新扫描。'
    }
  }

  if (snapshot.status === 'scanning') {
    return {
      currentStep: 'scan',
      steps: stepsThrough('scan'),
      primaryAction: '正在扫描',
      progress: { value: 0, label: '正在扫描' },
      error: null
    }
  }

  const readyToConfirm = snapshot.planReadiness
    ? snapshot.planReadiness.selectedAidCount > 0 && snapshot.planReadiness.unclassifiedAidCount === 0
    : false
  const currentStep: ControlledOldFavoriteGuideStep =
    ['frozen', 'executing', 'reconciling', 'completed'].includes(snapshot.status)
    ? 'confirm'
    : 'preview'
  const primaryAction = snapshot.status === 'frozen'
    ? snapshot.executionProgress?.lastFailureReason ? 'B 站同步已暂停' : '继续同步到 B 站'
    : snapshot.status === 'executing'
      ? '检查 B 站同步状态'
      : snapshot.status === 'reconciling'
        ? '检查 B 站同步结果'
        : snapshot.status === 'completed'
          ? '本轮已完成'
          : readyToConfirm
            ? '确认并同步到 B 站'
            : '自动分类'

  return {
    currentStep,
    steps: stepsThrough(currentStep),
    primaryAction,
    progress: { value: 1, label: '扫描完成' },
    error: null
  }
}
