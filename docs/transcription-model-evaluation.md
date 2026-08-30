# Transcription Model Evaluation

SenseVoiceSmall is the bundled/new-account default for the Windows release. This evaluation remains the regression
gate for future model updates and release changes; it must not silently omit speech or regress protected numbers and
model names.

## Required samples

- Mandarin speech, mixed Chinese-English, numbers and model names, noisy or music-backed audio, low-volume speech, filler/repeated speech, and 30-60 minute material.
- Do not commit copyrighted source audio. Record acquisition permission, local fixture path, and evaluator in the test report.

## Record for every model

- Character error observations, protected numbers/model-name errors, missing segments, timestamp drift, runtime, peak RAM/VRAM, installed size, and failure behavior.
- Compare SenseVoiceSmall against Whisper small. It must not regress protected numbers/model names or silently omit speech.

## Decision gate

- Keep SenseVoiceSmall as the bundled/new-account default while the above evidence remains within the accepted
  regression envelope. If a future evaluation fails that envelope, record the evidence and make an explicit product
  decision before changing the default. No speaker diarization is in scope.
