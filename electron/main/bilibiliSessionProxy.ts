type BilibiliProxySession = {
  setProxy: (config: { mode: 'direct' }) => Promise<void>
}

export class BilibiliSessionProxy {
  private mode: 'system' | 'direct' = 'system'
  private session: BilibiliProxySession | null = null

  constructor(private readonly getSession: () => BilibiliProxySession) {}

  async retryDirect() {
    if (this.mode === 'direct') return this.snapshot()
    this.session ??= this.getSession()
    await this.session.setProxy({ mode: 'direct' })
    this.mode = 'direct'
    return this.snapshot()
  }

  snapshot() {
    return { mode: this.mode }
  }
}
