type BilibiliProxySession = {
  setProxy: (config: { mode: 'direct' | 'system' }) => Promise<void>
  closeAllConnections: () => Promise<void>
}

export type BilibiliConnectionMode = 'auto' | 'direct'
type EffectiveProxyMode = 'direct' | 'system'

export class BilibiliSessionProxy {
  private mode: BilibiliConnectionMode = 'auto'
  private temporaryDirect = false
  private session: BilibiliProxySession | null = null

  constructor(private readonly getSession: () => BilibiliProxySession) {}

  async retryDirect() {
    if (this.effectiveMode() === 'direct') return this.snapshot()
    await this.apply(this.mode, true)
    return this.snapshot()
  }

  async applyPreference(mode: BilibiliConnectionMode) {
    await this.apply(mode, false)
    return this.snapshot()
  }

  private effectiveMode(): EffectiveProxyMode {
    return this.temporaryDirect || this.mode === 'direct' ? 'direct' : 'system'
  }

  private async apply(nextMode: BilibiliConnectionMode, temporaryDirect: boolean) {
    const previousMode = this.mode
    const previousTemporaryDirect = this.temporaryDirect
    const nextEffectiveMode: EffectiveProxyMode = temporaryDirect || nextMode === 'direct' ? 'direct' : 'system'
    this.session ??= this.getSession()
    try {
      await this.session.setProxy({ mode: nextEffectiveMode })
      await this.session.closeAllConnections()
      this.mode = nextMode
      this.temporaryDirect = temporaryDirect
    } catch (error) {
      if (this.session && nextEffectiveMode !== this.effectiveMode()) {
        try {
          await this.session.setProxy({ mode: this.effectiveMode() })
        } catch {
          // Preserve the original failure; the caller keeps the prior displayed mode.
        }
      }
      this.mode = previousMode
      this.temporaryDirect = previousTemporaryDirect
      throw error
    }
  }

  snapshot() {
    return { mode: this.mode, effectiveMode: this.effectiveMode(), temporaryDirect: this.temporaryDirect }
  }
}
