import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import {
  buildStripCaptionPowerShellArgs,
  buildStripCaptionPowerShellScript,
  encodePowerShellCommand,
  extractHwndDecimal,
  installFloatingSealCaptionStrip
} from './floatingSealCaptionStrip'

describe('extractHwndDecimal', () => {
  it('reads a 64-bit little-endian HWND from the native buffer', () => {
    const buffer = Buffer.alloc(8)
    buffer.writeBigUInt64LE(0x00000001_2345_6789n)

    expect(extractHwndDecimal(buffer)).toBe(0x123456789n.toString())
  })

  it('reads a 32-bit little-endian HWND on legacy systems', () => {
    const buffer = Buffer.alloc(4)
    buffer.writeUInt32LE(0xabcdef01)

    expect(extractHwndDecimal(buffer)).toBe(String(0xabcdef01))
  })

  it('throws on an unexpected handle width', () => {
    expect(() => extractHwndDecimal(Buffer.alloc(2))).toThrow(/unexpected native handle length/)
  })
})

describe('buildStripCaptionPowerShellScript', () => {
  it('clears WS_CAPTION and forces a frame-changed refresh', () => {
    const script = buildStripCaptionPowerShellScript('305419896')

    expect(script).toContain('GetWindowLongPtrW')
    expect(script).toContain('SetWindowLongPtrW')
    expect(script).toContain('SetWindowPos')
    expect(script).toContain('$WS_CAPTION = 0x00C00000')
    expect(script).toContain('$GWL_STYLE = -16')
    // SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED
    expect(script).toContain('0x1 -bor 0x2 -bor 0x4 -bor 0x10 -bor 0x20')
    expect(script).toContain('[int64]305419896')
    expect(script).toMatch(/try \{[\s\S]+\} catch \{[\s\S]+\}/)
  })

  it('also disables DWM non-client rendering as defense in depth', () => {
    const script = buildStripCaptionPowerShellScript('1')

    expect(script).toContain('DwmSetWindowAttribute')
    expect(script).toContain('$DWMWA_NCRENDERING_POLICY = 2')
    expect(script).toContain('$DWMNCRP_DISABLED = 1')
  })

  it('uses -bnot for the mask so the high 32 bits stay set on 64-bit hosts', () => {
    // -bnot 在 PowerShell 里对 Int32 做补码 → 符号扩展到 Int64 时高位全 1，
    // 用 -band 才不会把窗口样式的高位意外清掉。
    const script = buildStripCaptionPowerShellScript('1')

    expect(script).toContain('-band (-bnot $WS_CAPTION)')
  })

  it('emits success summary to stdout and exceptions to stderr for diagnostics', () => {
    const script = buildStripCaptionPowerShellScript('1')

    expect(script).toContain('Write-Output')
    expect(script).toContain('bilimi-caption-strip ok')
    expect(script).toContain('hadCaption=')
    expect(script).toContain('dwmRc=')
    expect(script).toContain('exstyle=')
    expect(script).toContain('[Console]::Error.WriteLine')
    expect(script).toContain('bilimi-caption-strip fail')
  })

  it('rejects a non-decimal hwnd to avoid script injection', () => {
    expect(() => buildStripCaptionPowerShellScript('123; calc.exe')).toThrow(/invalid hwnd/)
    expect(() => buildStripCaptionPowerShellScript('0x1234')).toThrow(/invalid hwnd/)
    expect(() => buildStripCaptionPowerShellScript('')).toThrow(/invalid hwnd/)
  })
})

describe('encodePowerShellCommand', () => {
  it('encodes the script as UTF-16LE base64 to match -EncodedCommand', () => {
    const encoded = encodePowerShellCommand('Write-Output hello')
    const decoded = Buffer.from(encoded, 'base64').toString('utf16le')

    expect(decoded).toBe('Write-Output hello')
  })
})

describe('buildStripCaptionPowerShellArgs', () => {
  it('builds a non-interactive hidden powershell invocation', () => {
    const args = buildStripCaptionPowerShellArgs('42')

    expect(args.slice(0, 5)).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-WindowStyle',
      'Hidden',
      '-EncodedCommand'
    ])
    expect(args).toHaveLength(6)

    const decoded = Buffer.from(args[5], 'base64').toString('utf16le')
    expect(decoded).toContain('SetWindowLongPtrW')
    expect(decoded).toContain('[int64]42')
  })
})

function makeTarget(handleBytes = 8) {
  const buffer = Buffer.alloc(handleBytes)
  if (handleBytes === 8) {
    buffer.writeBigUInt64LE(0x123456789n)
  } else {
    buffer.writeUInt32LE(0xdeadbeef)
  }
  return {
    isDestroyed: vi.fn(() => false),
    getNativeWindowHandle: vi.fn(() => buffer)
  }
}

type StubChild = {
  on: ReturnType<typeof vi.fn>
  stdout?: { on: ReturnType<typeof vi.fn> } | null
  stderr?: { on: ReturnType<typeof vi.fn> } | null
}
type SpawnStub = (command: string, args: string[], options?: unknown) => StubChild

describe('installFloatingSealCaptionStrip', () => {
  it('returns a completion promise that settles only after the spawned native repair exits', async () => {
    const target = makeTarget()
    const listeners = new Map<string, (...args: never[]) => void>()
    const childOn = vi.fn((event: string, listener: (...args: never[]) => void) => {
      listeners.set(event, listener)
    })
    const spawn = vi.fn<SpawnStub>(() => ({ on: childOn }))

    const completion = installFloatingSealCaptionStrip(target, { spawn })

    expect(completion).toBeInstanceOf(Promise)
    listeners.get('close')?.()
    await expect(completion).resolves.toBeUndefined()
  })

  it('spawns powershell with piped stdio and the encoded caption-strip script', () => {
    const target = makeTarget()
    const spawn = vi.fn<SpawnStub>(() => ({ on: vi.fn() }))

    installFloatingSealCaptionStrip(target, { spawn })

    expect(spawn).toHaveBeenCalledTimes(1)
    const [command, args, opts] = spawn.mock.calls[0]
    expect(command).toBe('powershell.exe')
    expect(args[0]).toBe('-NoProfile')
    expect(opts).toEqual({ windowsHide: true, stdio: 'pipe' })

    const decoded = Buffer.from(args[5], 'base64').toString('utf16le')
    expect(decoded).toContain(`[int64]${0x123456789n.toString()}`)
    expect(decoded).toContain('SetWindowLongPtrW')
  })

  it('forwards stdout chunks to the logger so success summaries are visible', () => {
    const target = makeTarget()
    const stdoutOn = vi.fn()
    const spawn = vi.fn<SpawnStub>(() => ({
      on: vi.fn(),
      stdout: { on: stdoutOn },
      stderr: null
    }))
    const logger = vi.fn()

    installFloatingSealCaptionStrip(target, { spawn, logger })

    expect(stdoutOn).toHaveBeenCalledWith('data', expect.any(Function))
    const handler = stdoutOn.mock.calls.find((call) => call[0] === 'data')?.[1] as
      | ((chunk: Buffer | string) => void)
      | undefined
    handler?.('bilimi-caption-strip ok current=0x96CF0000 new=0x96030000\n')

    expect(logger).toHaveBeenCalledWith(
      expect.stringMatching(/stdout: bilimi-caption-strip ok current=/)
    )
  })

  it('forwards stderr chunks to the logger so silent PS failures are visible', () => {
    const target = makeTarget()
    const stderrOn = vi.fn()
    const spawn = vi.fn<SpawnStub>(() => ({
      on: vi.fn(),
      stdout: null,
      stderr: { on: stderrOn }
    }))
    const logger = vi.fn()

    installFloatingSealCaptionStrip(target, { spawn, logger })

    const handler = stderrOn.mock.calls.find((call) => call[0] === 'data')?.[1] as
      | ((chunk: Buffer | string) => void)
      | undefined
    handler?.('bilimi-caption-strip fail: Add-Type denied')

    expect(logger).toHaveBeenCalledWith(
      expect.stringContaining('stderr: bilimi-caption-strip fail: Add-Type denied')
    )
  })

  it('honours a custom powershell path', () => {
    const target = makeTarget()
    const spawn = vi.fn<SpawnStub>(() => ({ on: vi.fn() }))

    installFloatingSealCaptionStrip(target, {
      spawn,
      powershellPath: 'C:/pwsh/pwsh.exe'
    })

    expect(spawn.mock.calls[0][0]).toBe('C:/pwsh/pwsh.exe')
  })

  it('does nothing when the window is already destroyed', () => {
    const target = makeTarget()
    target.isDestroyed.mockReturnValue(true)
    const spawn = vi.fn<SpawnStub>()

    installFloatingSealCaptionStrip(target, { spawn })

    expect(spawn).not.toHaveBeenCalled()
    expect(target.getNativeWindowHandle).not.toHaveBeenCalled()
  })

  it('logs and skips when the native handle cannot be read', () => {
    const target = {
      isDestroyed: vi.fn(() => false),
      getNativeWindowHandle: vi.fn(() => Buffer.alloc(2))
    }
    const spawn = vi.fn<SpawnStub>()
    const logger = vi.fn()

    installFloatingSealCaptionStrip(target, { spawn, logger })

    expect(spawn).not.toHaveBeenCalled()
    expect(logger).toHaveBeenCalledWith(
      expect.stringContaining('failed to read native handle'),
      expect.any(Error)
    )
  })

  it('swallows spawn errors so the main process never crashes', () => {
    const target = makeTarget()
    const spawn = vi.fn<SpawnStub>(() => {
      throw new Error('ENOENT')
    })
    const logger = vi.fn()

    expect(() => installFloatingSealCaptionStrip(target, { spawn, logger })).not.toThrow()

    expect(logger).toHaveBeenCalledWith(
      expect.stringContaining('spawn threw'),
      expect.any(Error)
    )
  })

  it('attaches an error listener to the child to swallow async spawn errors', () => {
    const target = makeTarget()
    const childOn = vi.fn()
    const spawn = vi.fn<SpawnStub>(() => ({ on: childOn }))

    installFloatingSealCaptionStrip(target, { spawn })

    expect(childOn).toHaveBeenCalledWith('error', expect.any(Function))
    const errorListener = childOn.mock.calls.find((call) => call[0] === 'error')?.[1] as
      | ((error: unknown) => void)
      | undefined
    expect(() => errorListener?.(new Error('boom'))).not.toThrow()
  })

  it('logs and skips when spawn is not provided', () => {
    const target = makeTarget()
    const logger = vi.fn()

    installFloatingSealCaptionStrip(target, { logger })

    expect(logger).toHaveBeenCalledWith(expect.stringContaining('spawn unavailable'))
  })
})
