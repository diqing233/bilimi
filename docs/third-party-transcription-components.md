# Third-Party Transcription Components

This document records the verified sources and attribution required by the
transcription-model manifest. It does not state that any artifact has been
bundled into a released installer.

## SenseVoiceSmall

- Runtime: [sherpa-onnx v1.13.4 Windows x64 CPU runtime](https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.4/sherpa-onnx-v1.13.4-win-x64-shared-MD-Release-no-tts.tar.bz2), Apache-2.0, SHA-256 `da8eb60079df2969b7691517c2dd6f4965a0481533b200c3bf25f5e7f7f65b80`.
- Model archive: [sherpa-onnx converted SenseVoice int8 release](https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09.tar.bz2), SHA-256 `7305f7905bfcf77fa0b39388a313f3da35c68d971661a65475b56fb2162c8e63`.
- Model attribution: SenseVoice by [QwenAudio/SenseVoice](https://github.com/QwenLM/SenseVoice). The code is MIT; the model weights use the [FunASR Model Open Source License Agreement v1.1](https://github.com/modelscope/FunASR/blob/main/MODEL_LICENSE). Preserve the SenseVoice model name and source attribution when distributing the weights.

## Whisper Small

- Model: [ggerganov/whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp/tree/5359861c739e955e79d9a303bcbc70fb988958b1), `ggml-small.bin`, MIT, SHA-256 `1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b`.

## Faster-Whisper Large Models

- Runtime: faster-whisper and CTranslate2, MIT. The controlled helper is built from the checked-in locked inputs; it is not a substitute for release validation.
- large-v3: [Systran/faster-whisper-large-v3](https://huggingface.co/Systran/faster-whisper-large-v3/tree/edaa852ec7e145841d8ffdb056a99866b5f0a478), MIT.
- large-v3-turbo: [dropbox-dash/faster-whisper-large-v3-turbo](https://huggingface.co/dropbox-dash/faster-whisper-large-v3-turbo/tree/0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf), MIT.

The authoritative per-file URL, byte size, SHA-256, license, and installed
footprint are defined in `electron/main/transcriptionModelManifest.ts`. No
domestic mirror is declared because none has been independently verified.
