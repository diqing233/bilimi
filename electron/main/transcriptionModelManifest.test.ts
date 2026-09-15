import { describe, expect, it } from 'vitest'
import { TRANSCRIPTION_MODEL_MANIFEST } from './transcriptionModelManifest'

describe('transcription model manifest', () => {
  it('marks SenseVoiceSmall as bundled and Whisper small as downloadable', () => {
    expect(TRANSCRIPTION_MODEL_MANIFEST['sensevoice-small'].bundled).toBe(true)
    expect(TRANSCRIPTION_MODEL_MANIFEST['whisper-small'].bundled).toBe(false)
  })

  it('pins all downloadable artifacts to approved official sources and hashes', () => {
    expect(TRANSCRIPTION_MODEL_MANIFEST['sensevoice-small']).toMatchObject({ bundled: true, license: 'FunASR Model Open Source License Agreement v1.1' })
    expect(TRANSCRIPTION_MODEL_MANIFEST['whisper-small'].artifacts[0]).toMatchObject({ sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b' })
    expect(TRANSCRIPTION_MODEL_MANIFEST['faster-whisper-large-v3'].artifacts).toContainEqual(expect.objectContaining({ path: 'model.bin', sha256: '69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1' }))
    expect(TRANSCRIPTION_MODEL_MANIFEST['faster-whisper-large-v3'].artifacts).toContainEqual(expect.objectContaining({ path: 'tokenizer.json', sha256: '6d8cbd7cd0d8d5815e478dac67b85a26bbe77c1f5e0c6d76d1ce2abc0e5f21ca' }))
  })

  it('records the verified byte size for every artifact used for disk-space checks', () => {
    for (const manifest of Object.values(TRANSCRIPTION_MODEL_MANIFEST)) {
      for (const artifact of manifest.artifacts) expect(artifact.bytes).toBeGreaterThan(0)
    }
  })

  it('distinguishes SenseVoice download bytes from its verified extracted footprint', () => {
    expect(TRANSCRIPTION_MODEL_MANIFEST['sensevoice-small'].installedBytes).toBe(298268065)
    expect(TRANSCRIPTION_MODEL_MANIFEST['sensevoice-small'].installedBytes)
      .toBeGreaterThan(TRANSCRIPTION_MODEL_MANIFEST['sensevoice-small'].artifacts.reduce((sum, artifact) => sum + artifact.bytes, 0))
  })

  it('records the applicable license for every distributable artifact', () => {
    const senseVoiceArtifacts = TRANSCRIPTION_MODEL_MANIFEST['sensevoice-small'].artifacts
    expect(senseVoiceArtifacts).toContainEqual(expect.objectContaining({
      path: expect.stringContaining('sherpa-onnx-v1.13.4'),
      license: 'Apache-2.0'
    }))
    expect(senseVoiceArtifacts).toContainEqual(expect.objectContaining({
      path: expect.stringContaining('sense-voice'),
      license: 'FunASR Model Open Source License Agreement v1.1'
    }))
    for (const id of ['whisper-small', 'faster-whisper-large-v3-turbo', 'faster-whisper-large-v3'] as const) {
      expect(TRANSCRIPTION_MODEL_MANIFEST[id].artifacts.every((artifact) => artifact.license === 'MIT')).toBe(true)
    }
  })

  it('declares ModelScope, GitHub Release, then the official source for each artifact', () => {
    const artifact = TRANSCRIPTION_MODEL_MANIFEST['whisper-small'].artifacts[0] as {
      source: string
      sources?: Array<{ label: string; source: string }>
    }

    expect(artifact.sources).toEqual([
      {
        label: 'ModelScope',
        source: 'https://modelscope.cn/models/bilimi/transcription-models/resolve/master/whisper-small/ggml-small.bin'
      },
      {
        label: 'GitHub Release',
        source: 'https://github.com/diqing233/bilimi/releases/download/transcription-models-2026-07-28/whisper-small-ggml-small.bin'
      },
      { label: 'Official source', source: artifact.source }
    ])
  })

  it('declares GitHub Release large-v3 model parts with their release hashes', () => {
    const artifact = TRANSCRIPTION_MODEL_MANIFEST['faster-whisper-large-v3'].artifacts
      .find((entry) => entry.path === 'model.bin') as {
        sources?: Array<{ label: string; parts?: Array<{ source: string; sha256: string; bytes: number }> }>
      }

    expect(artifact.sources?.[1]).toEqual({
      label: 'GitHub Release',
      parts: [
        {
          source: 'https://github.com/diqing233/bilimi/releases/download/transcription-models-2026-07-28/faster-whisper-large-v3-model.bin.part-001',
          bytes: 1073741824,
          sha256: 'ffb5a6cd5d53b9188fc30dfc8c9e59d596fdbc2b2fb61368c0564b407be46591'
        },
        {
          source: 'https://github.com/diqing233/bilimi/releases/download/transcription-models-2026-07-28/faster-whisper-large-v3-model.bin.part-002',
          bytes: 1073741824,
          sha256: 'c14e94cdd7837754a73f63b3b197925addda5fd0f39cb92bcdfb9e146a0e71d5'
        },
        {
          source: 'https://github.com/diqing233/bilimi/releases/download/transcription-models-2026-07-28/faster-whisper-large-v3-model.bin.part-003',
          bytes: 939800589,
          sha256: '4daea110817f4be7bfe5c0cfb82d01f12adc2684ab3bd548bd43634f658d5380'
        }
      ]
    })
  })
})
