# Transcription Model Evaluation

SenseVoiceSmall is not the default until this evaluation is completed with recorded evidence.

## Required samples

- Mandarin speech, mixed Chinese-English, numbers and model names, noisy or music-backed audio, low-volume speech, filler/repeated speech, and 30-60 minute material.
- Do not commit copyrighted source audio. Record acquisition permission, local fixture path, and evaluator in the test report.

## Record for every model

- Character error observations, protected numbers/model-name errors, missing segments, timestamp drift, runtime, peak RAM/VRAM, installed size, and failure behavior.
- Compare SenseVoiceSmall against Whisper small. It must not regress protected numbers/model names or silently omit speech.

## Decision gate

- Mark SenseVoiceSmall as the bundled/new-account default only after the above evidence is reviewed and accepted.
- Until then Whisper small stays the default; SenseVoiceSmall remains a verified candidate. No speaker diarization is in scope.
