export type DefaultLayoutRestoreFailure = 'layout' | 'preference' | 'layout-and-preference'

type DefaultLayoutRestoreControllerOptions = {
  restoreLayout: () => Promise<void>
  persistSidebarWidthReset: () => Promise<void>
  onSuccess: () => void
  onFailure: (failure: DefaultLayoutRestoreFailure) => void
}

export function createDefaultLayoutRestoreController({
  restoreLayout,
  persistSidebarWidthReset,
  onSuccess,
  onFailure
}: DefaultLayoutRestoreControllerOptions) {
  let activeRestore: Promise<void> | null = null

  return function restoreDefaultLayout() {
    if (activeRestore) return activeRestore

    const layout = restoreLayout()
    const preference = persistSidebarWidthReset()
    activeRestore = Promise.allSettled([layout, preference]).then(([layoutResult, preferenceResult]) => {
      const layoutFailed = layoutResult.status === 'rejected'
      const preferenceFailed = preferenceResult.status === 'rejected'

      if (!layoutFailed && !preferenceFailed) {
        onSuccess()
      } else if (layoutFailed && preferenceFailed) {
        onFailure('layout-and-preference')
      } else {
        onFailure(layoutFailed ? 'layout' : 'preference')
      }
    }).finally(() => {
      activeRestore = null
    })

    return activeRestore
  }
}
