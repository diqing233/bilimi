import { describe, expect, it, vi } from 'vitest'
import { createTranscriptionTempDirectory } from './transcriptionTempDirectory'

describe('createTranscriptionTempDirectory', () => {
  it('uses an ASCII Windows temp root when the user temp path contains Chinese characters', async () => {
    const mkdtemp = vi.fn().mockResolvedValue('C:\\Windows\\Temp\\bilimi-transcribe-abcd')

    await expect(createTranscriptionTempDirectory({
      platform: 'win32',
      env: {
        TEMP: 'C:\\Users\\中文\\AppData\\Local\\Temp',
        TMP: 'C:\\Users\\中文\\AppData\\Local\\Temp',
        SystemRoot: 'C:\\Windows',
        SystemDrive: 'C:'
      },
      tmpdir: () => 'C:\\Users\\中文\\AppData\\Local\\Temp',
      mkdtemp
    })).resolves.toBe('C:\\Windows\\Temp\\bilimi-transcribe-abcd')

    expect(mkdtemp).toHaveBeenCalledWith('C:\\Windows\\Temp\\bilimi-transcribe-')
  })

  it('tries the next ASCII Windows root when the preferred root is unavailable', async () => {
    const mkdtemp = vi.fn()
      .mockRejectedValueOnce(new Error('access denied'))
      .mockResolvedValueOnce('D:\\Windows\\Temp\\bilimi-transcribe-abcd')

    await expect(createTranscriptionTempDirectory({
      platform: 'win32',
      env: { SystemRoot: 'C:\\Windows', SystemDrive: 'D:' },
      tmpdir: () => 'C:\\Users\\中文\\AppData\\Local\\Temp',
      mkdtemp
    })).resolves.toBe('D:\\Windows\\Temp\\bilimi-transcribe-abcd')
    expect(mkdtemp).toHaveBeenNthCalledWith(2, 'D:\\Windows\\Temp\\bilimi-transcribe-')
  })

  it('keeps the platform temp directory on non-Windows systems', async () => {
    const mkdtemp = vi.fn().mockResolvedValue('/tmp/bilimi-transcribe-abcd')

    await expect(createTranscriptionTempDirectory({
      platform: 'linux',
      tmpdir: () => '/tmp',
      mkdtemp
    })).resolves.toBe('/tmp/bilimi-transcribe-abcd')
    expect(mkdtemp).toHaveBeenCalledWith('/tmp/bilimi-transcribe-')
  })
})
