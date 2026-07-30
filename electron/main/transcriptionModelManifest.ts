import type { TranscriptionModelId } from '../../src/shared/types'

export type TranscriptionModelArtifactPart = { source: string; bytes: number; sha256: string }
export type TranscriptionModelArtifactSource =
  | { label: 'ModelScope' | 'Official source'; source: string }
  | { label: 'GitHub Release'; source: string; parts?: never }
  | { label: 'GitHub Release'; parts: TranscriptionModelArtifactPart[]; source?: never }
export type TranscriptionModelArtifact = {
  path: string
  source: string
  bytes: number
  sha256: string
  license: string
  sources: TranscriptionModelArtifactSource[]
}
export type TranscriptionModelManifestEntry = {
  id: TranscriptionModelId
  bundled: boolean
  version: string
  runtimeFamily: 'sensevoice' | 'whisper.cpp' | 'faster-whisper'
  hardware: string
  license: string
  attribution: string
  artifacts: TranscriptionModelArtifact[]
  /** Verified size of the activated model/runtime directory, not the compressed download size. */
  installedBytes: number
}

const HF = 'https://huggingface.co'
const MODELSCOPE = 'https://modelscope.cn/models/bilimi/transcription-models/resolve/master/'
const GITHUB_RELEASE = 'https://github.com/diqing233/bilimi/releases/download/transcription-models-2026-07-28/'

function artifact(
  model: string,
  path: string,
  source: string,
  bytes: number,
  sha256: string,
  license: string,
  githubAsset: string,
  parts?: TranscriptionModelArtifactPart[]
): TranscriptionModelArtifact {
  return {
    path,
    source,
    bytes,
    sha256,
    license,
    sources: [
      { label: 'ModelScope', source: `${MODELSCOPE}${model}/${path}` },
      parts ? { label: 'GitHub Release', parts } : { label: 'GitHub Release', source: `${GITHUB_RELEASE}${githubAsset}` },
      { label: 'Official source', source }
    ]
  }
}

export const TRANSCRIPTION_MODEL_MANIFEST: Record<TranscriptionModelId, TranscriptionModelManifestEntry> = {
  'sensevoice-small': {
    id: 'sensevoice-small', bundled: false, version: '2025-09-09', runtimeFamily: 'sensevoice', hardware: 'Windows x64 CPU',
    license: 'FunASR Model Open Source License Agreement v1.1',
    attribution: 'SenseVoice model: QwenAudio/SenseVoice; converted release provided by k2-fsa/sherpa-onnx. Preserve model name and source attribution.',
    installedBytes: 298268065,
    artifacts: [
      artifact('sensevoice-small', 'runtime/sherpa-onnx-v1.13.4-win-x64-shared-MD-Release-no-tts.tar.bz2', 'https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.4/sherpa-onnx-v1.13.4-win-x64-shared-MD-Release-no-tts.tar.bz2', 18746895, 'da8eb60079df2969b7691517c2dd6f4965a0481533b200c3bf25f5e7f7f65b80', 'Apache-2.0', 'sherpa-onnx-v1.13.4-win-x64-shared-MD-Release-no-tts.tar.bz2'),
      artifact('sensevoice-small', 'model/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09.tar.bz2', 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09.tar.bz2', 165783878, '7305f7905bfcf77fa0b39388a313f3da35c68d971661a65475b56fb2162c8e63', 'FunASR Model Open Source License Agreement v1.1', 'sensevoice-small-sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09.tar.bz2')
    ]
  },
  'whisper-small': {
    id: 'whisper-small', bundled: true, version: '5359861c739e955e79d9a303bcbc70fb988958b1', runtimeFamily: 'whisper.cpp', hardware: 'CPU', license: 'MIT', attribution: 'whisper.cpp small model by ggerganov.', installedBytes: 487601967,
    artifacts: [artifact('whisper-small', 'ggml-small.bin', `${HF}/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-small.bin`, 487601967, '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b', 'MIT', 'whisper-small-ggml-small.bin')]
  },
  'faster-whisper-large-v3': {
    id: 'faster-whisper-large-v3', bundled: false, version: 'edaa852ec7e145841d8ffdb056a99866b5f0a478', runtimeFamily: 'faster-whisper', hardware: 'CPU 可用，速度可能较慢；可选 NVIDIA CUDA GPU 加速', license: 'MIT', attribution: 'faster-whisper and CTranslate2 model by SYSTRAN.', installedBytes: 3090835702,
    artifacts: [
      artifact('faster-whisper-large-v3', 'model.bin', `${HF}/Systran/faster-whisper-large-v3/resolve/edaa852ec7e145841d8ffdb056a99866b5f0a478/model.bin`, 3087284237, '69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1', 'MIT', 'faster-whisper-large-v3-model.bin', [
        { source: `${GITHUB_RELEASE}faster-whisper-large-v3-model.bin.part-001`, bytes: 1073741824, sha256: 'ffb5a6cd5d53b9188fc30dfc8c9e59d596fdbc2b2fb61368c0564b407be46591' },
        { source: `${GITHUB_RELEASE}faster-whisper-large-v3-model.bin.part-002`, bytes: 1073741824, sha256: 'c14e94cdd7837754a73f63b3b197925addda5fd0f39cb92bcdfb9e146a0e71d5' },
        { source: `${GITHUB_RELEASE}faster-whisper-large-v3-model.bin.part-003`, bytes: 939800589, sha256: '4daea110817f4be7bfe5c0cfb82d01f12adc2684ab3bd548bd43634f658d5380' }
      ]),
      artifact('faster-whisper-large-v3', 'config.json', `${HF}/Systran/faster-whisper-large-v3/resolve/edaa852ec7e145841d8ffdb056a99866b5f0a478/config.json`, 2394, 'a9306624f5ec14270a014b647e5c316b6e03a662c369758d1b90697a7b0655b9', 'MIT', 'faster-whisper-large-v3-config.json'),
      artifact('faster-whisper-large-v3', 'preprocessor_config.json', `${HF}/Systran/faster-whisper-large-v3/resolve/edaa852ec7e145841d8ffdb056a99866b5f0a478/preprocessor_config.json`, 340, '7ccc62c6f2765af1f3b46c00c9b5894426835a05021c8b9c01eecb6dfb542711', 'MIT', 'faster-whisper-large-v3-preprocessor_config.json'),
      artifact('faster-whisper-large-v3', 'tokenizer.json', `${HF}/Systran/faster-whisper-large-v3/resolve/edaa852ec7e145841d8ffdb056a99866b5f0a478/tokenizer.json`, 2480617, '6d8cbd7cd0d8d5815e478dac67b85a26bbe77c1f5e0c6d76d1ce2abc0e5f21ca', 'MIT', 'faster-whisper-large-v3-tokenizer.json'),
      artifact('faster-whisper-large-v3', 'vocabulary.json', `${HF}/Systran/faster-whisper-large-v3/resolve/edaa852ec7e145841d8ffdb056a99866b5f0a478/vocabulary.json`, 1068114, 'c69260f2ab26d659b7c398f9a2b2b48ed0df16c3b47d7326782fd9cba71690c1', 'MIT', 'faster-whisper-large-v3-vocabulary.json')
    ]
  },
  'faster-whisper-large-v3-turbo': {
    id: 'faster-whisper-large-v3-turbo', bundled: false, version: '0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf', runtimeFamily: 'faster-whisper', hardware: 'CPU 可用，速度可能较慢；可选 NVIDIA CUDA GPU 加速', license: 'MIT', attribution: 'faster-whisper and CTranslate2 model by dropbox-dash.', installedBytes: 1621665983,
    artifacts: [
      artifact('faster-whisper-large-v3-turbo', 'model.bin', `${HF}/dropbox-dash/faster-whisper-large-v3-turbo/resolve/0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf/model.bin`, 1617884929, 'e76620f83d5f5b69efd3d87e3dc180c1bd21df9fbebacfd4335e5e1efcc018da', 'MIT', 'faster-whisper-large-v3-turbo-model.bin'),
      artifact('faster-whisper-large-v3-turbo', 'config.json', `${HF}/dropbox-dash/faster-whisper-large-v3-turbo/resolve/0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf/config.json`, 2263, 'b0253ea6c0d3bea6b1e19e91a02acfd3b53f4467362efcb5a3e6b16c9b3a9b7e', 'MIT', 'faster-whisper-large-v3-turbo-config.json'),
      artifact('faster-whisper-large-v3-turbo', 'preprocessor_config.json', `${HF}/dropbox-dash/faster-whisper-large-v3-turbo/resolve/0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf/preprocessor_config.json`, 340, '7ccc62c6f2765af1f3b46c00c9b5894426835a05021c8b9c01eecb6dfb542711', 'MIT', 'faster-whisper-large-v3-turbo-preprocessor_config.json'),
      artifact('faster-whisper-large-v3-turbo', 'tokenizer.json', `${HF}/dropbox-dash/faster-whisper-large-v3-turbo/resolve/0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf/tokenizer.json`, 2710337, '297b13372ac43916285644fb9687add3cc62ee2a1adb60da3dc25cc94c1871fd', 'MIT', 'faster-whisper-large-v3-turbo-tokenizer.json'),
      artifact('faster-whisper-large-v3-turbo', 'vocabulary.json', `${HF}/dropbox-dash/faster-whisper-large-v3-turbo/resolve/0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf/vocabulary.json`, 1068114, 'c69260f2ab26d659b7c398f9a2b2b48ed0df16c3b47d7326782fd9cba71690c1', 'MIT', 'faster-whisper-large-v3-turbo-vocabulary.json')
    ]
  }
}
