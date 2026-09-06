import { render, screen } from '@testing-library/react'
import { lazy, Suspense } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { StartupModuleRecoveryBoundary } from './startupModuleRecovery'

function BrokenStartupRoute(): never {
  throw new Error('Failed to fetch dynamically imported module')
}

describe('StartupModuleRecoveryBoundary', () => {
  it('shows a visible reload action instead of leaving the main window blank', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    render(
      <StartupModuleRecoveryBoundary>
        <BrokenStartupRoute />
      </StartupModuleRecoveryBoundary>
    )

    expect(screen.getByRole('heading', { name: '主界面未能载入' })).toBeVisible()
    expect(screen.getByRole('button', { name: '重新载入' })).toBeVisible()
  })

  it('recovers when a lazy route rejects after its suspense fallback', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const BrokenLazyStartupRoute = lazy(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module')))

    render(
      <StartupModuleRecoveryBoundary>
        <Suspense fallback={<span>正在准备窗口…</span>}>
          <BrokenLazyStartupRoute />
        </Suspense>
      </StartupModuleRecoveryBoundary>
    )

    expect(await screen.findByRole('heading', { name: '主界面未能载入' })).toBeVisible()
    expect(screen.getByRole('button', { name: '重新载入' })).toBeVisible()
  })
})
