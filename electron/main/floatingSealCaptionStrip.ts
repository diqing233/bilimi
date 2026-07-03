/**
 * Win11 + Electron transparent+frameless 窗口失活时，DWM 会按"还有标题栏"的几何路径
 * 在隐藏的非客户区刷一条不透明白条（electron/electron #39959, #47946）。
 *
 * 第 1 步（backgroundMaterial: 'none'）和事后 nudge 都只能事后缓解。第 3 步直接从
 * 源头切：让 DWM 看到"这窗口没有标题栏"——清掉窗口风格里的 WS_CAPTION，再用
 * SWP_FRAMECHANGED 触发 DWM 重新计算非客户区。inactive frame 路径就根本不进入。
 *
 * 安全前提：本窗口已经 frame:false / resizable:false / hasShadow:false /
 * minimizable:false / maximizable:false / thickFrame:false / titleBarStyle:'hidden'，
 * 剥 WS_CAPTION 不损失任何已启用的功能（Aero Snap、系统标题栏、DWM 阴影本就关闭）。
 *
 * 与第 2 步（DwmExtendFrameIntoClientArea）的根本区别：那是切 DWM 合成路径，会让
 * 透明窗口的客户区变成 glass blend，alpha 规则被改 → 黑底漏出。这里只动 Win32 风格位，
 * 不触碰 DWM 合成模式。
 *
 * 调用方式：通过 PowerShell `-EncodedCommand` 一次性调 GetWindowLongPtrW /
 * SetWindowLongPtrW / SetWindowPos。这是为了保持本仓库零原生依赖的风格。
 * 失败 fire-and-forget：nudge 仍兜底。
 */

import { Buffer } from 'node:buffer'

type CaptionStripTarget = {
  isDestroyed: () => boolean
  getNativeWindowHandle: () => Buffer
}

type SpawnLike = (
  command: string,
  args: string[],
  options?: { windowsHide?: boolean; stdio?: 'ignore' | 'pipe' } & Record<string, unknown>
) => {
  on?: (event: string, listener: (...args: never[]) => void) => unknown
  stdout?: { on?: (event: 'data', listener: (chunk: Buffer | string) => void) => unknown } | null
  stderr?: { on?: (event: 'data', listener: (chunk: Buffer | string) => void) => unknown } | null
} | undefined | void

type CaptionStripOptions = {
  spawn?: SpawnLike
  powershellPath?: string
  logger?: (message: string, error?: unknown) => void
}

const POWERSHELL_DEFAULT = 'powershell.exe'

export function extractHwndDecimal(buffer: Buffer): string {
  if (buffer.length === 8) {
    return buffer.readBigUInt64LE().toString()
  }
  if (buffer.length === 4) {
    return String(buffer.readUInt32LE())
  }
  throw new Error(`unexpected native handle length: ${buffer.length}`)
}

export function buildStripCaptionPowerShellScript(hwndDecimal: string): string {
  if (!/^\d+$/.test(hwndDecimal)) {
    throw new Error(`invalid hwnd decimal: ${hwndDecimal}`)
  }

  // C# 一次性绑定 GetWindowLongPtrW / SetWindowLongPtrW / SetWindowPos / DwmSetWindowAttribute。
  // GWL_STYLE = -16；WS_CAPTION = 0x00C00000（= WS_BORDER | WS_DLGFRAME）。
  // SetWindowPos 标志：SWP_NOSIZE(0x1) | SWP_NOMOVE(0x2) | SWP_NOZORDER(0x4)
  //                  | SWP_NOACTIVATE(0x10) | SWP_FRAMECHANGED(0x20) = 0x37
  // DWMWA_NCRENDERING_POLICY = 2；DWMNCRP_DISABLED = 1
  //   —— Vista+ 官方"禁止 DWM 在非客户区渲染"开关；不切合成模式（不同于
  //      DwmExtendFrameIntoClientArea），对透明客户区零影响，但能阻止 inactive
  //      frame 白条被刷出来。
  const csharp = [
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class BilimiCaption {',
    '  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")]',
    '  public static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex);',
    '  [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW")]',
    '  public static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong);',
    '  [DllImport("user32.dll")]',
    '  public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter,',
    '    int X, int Y, int cx, int cy, uint uFlags);',
    '  [DllImport("dwmapi.dll")]',
    '  public static extern int DwmSetWindowAttribute(IntPtr hWnd, int dwAttribute,',
    '    ref int pvAttribute, int cbAttribute);',
    '}'
  ].join(' ')

  return [
    'try {',
    `  Add-Type -TypeDefinition @'\n${csharp}\n'@ -ErrorAction Stop`,
    `  $h = [IntPtr]::new([int64]${hwndDecimal})`,
    '  $GWL_STYLE = -16',
    '  $GWL_EXSTYLE = -20',
    '  $WS_CAPTION = 0x00C00000',
    '  $current = [BilimiCaption]::GetWindowLongPtr($h, $GWL_STYLE).ToInt64()',
    '  $exCurrent = [BilimiCaption]::GetWindowLongPtr($h, $GWL_EXSTYLE).ToInt64()',
    '  $hadCaption = (($current -band $WS_CAPTION) -ne 0)',
    // -bnot 在 Int32 上做补码后会被符号扩展到 Int64，高 32 位全 1，-band 不影响样式高位。
    '  $newL = $current -band (-bnot $WS_CAPTION)',
    '  [BilimiCaption]::SetWindowLongPtr($h, $GWL_STYLE, [IntPtr]::new($newL)) | Out-Null',
    '  $flags = [uint32](0x1 -bor 0x2 -bor 0x4 -bor 0x10 -bor 0x20)',
    '  [BilimiCaption]::SetWindowPos($h, [IntPtr]::Zero, 0, 0, 0, 0, $flags) | Out-Null',
    '  $DWMWA_NCRENDERING_POLICY = 2',
    '  $DWMNCRP_DISABLED = 1',
    '  $dwmRc = [BilimiCaption]::DwmSetWindowAttribute($h, $DWMWA_NCRENDERING_POLICY,',
    '    [ref]$DWMNCRP_DISABLED, 4)',
    // 把所有诊断关键值一次性写到 stdout，便于实测期一眼看到根因。
    '  Write-Output ("bilimi-caption-strip ok style=0x{0:X8} new=0x{1:X8} exstyle=0x{2:X8} hadCaption={3} dwmRc=0x{4:X}" -f $current, $newL, $exCurrent, $hadCaption, $dwmRc)',
    // 失败路径把异常写到 stderr，主进程会捕到。
    '} catch { [Console]::Error.WriteLine("bilimi-caption-strip fail: " + $_.Exception.Message) }'
  ].join('\n')
}

/** PowerShell `-EncodedCommand` 要求 UTF-16LE + Base64。 */
export function encodePowerShellCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

export function buildStripCaptionPowerShellArgs(hwndDecimal: string): string[] {
  const script = buildStripCaptionPowerShellScript(hwndDecimal)
  return [
    '-NoProfile',
    '-NonInteractive',
    '-WindowStyle',
    'Hidden',
    '-EncodedCommand',
    encodePowerShellCommand(script)
  ]
}

export function installFloatingSealCaptionStrip(
  target: CaptionStripTarget,
  options: CaptionStripOptions = {}
): void {
  if (target.isDestroyed()) {
    return
  }

  const log = options.logger ?? (() => {})

  let hwndDecimal: string
  try {
    hwndDecimal = extractHwndDecimal(target.getNativeWindowHandle())
  } catch (error) {
    log('floatingSealCaptionStrip: failed to read native handle', error)
    return
  }

  let args: string[]
  try {
    args = buildStripCaptionPowerShellArgs(hwndDecimal)
  } catch (error) {
    log('floatingSealCaptionStrip: failed to build script', error)
    return
  }

  const spawnFn = options.spawn
  if (!spawnFn) {
    log('floatingSealCaptionStrip: spawn unavailable')
    return
  }

  try {
    const child = spawnFn(options.powershellPath ?? POWERSHELL_DEFAULT, args, {
      windowsHide: true,
      // 用 pipe 接 PS 脚本里的 stdout（成功摘要）和 stderr（catch 写出的异常）。
      stdio: 'pipe'
    })
    if (child && typeof child === 'object') {
      if (typeof child.on === 'function') {
        child.on('error', ((error: unknown) => {
          log('floatingSealCaptionStrip: powershell spawn error', error)
        }) as (...args: never[]) => void)
      }
      const stdout = child.stdout
      if (stdout && typeof stdout.on === 'function') {
        stdout.on('data', (chunk) => {
          const text = String(chunk).trim()
          if (text) {
            log(`floatingSealCaptionStrip stdout: ${text}`)
          }
        })
      }
      const stderr = child.stderr
      if (stderr && typeof stderr.on === 'function') {
        stderr.on('data', (chunk) => {
          const text = String(chunk).trim()
          if (text) {
            log(`floatingSealCaptionStrip stderr: ${text}`)
          }
        })
      }
    }
  } catch (error) {
    log('floatingSealCaptionStrip: spawn threw', error)
  }
}
