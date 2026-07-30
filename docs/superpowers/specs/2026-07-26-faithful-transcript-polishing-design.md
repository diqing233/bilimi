# DeepSeek Faithful Transcript Polishing Design

## Goal

Replace the current one-shot transcript rewrite with a loss-resistant workflow that preserves every source segment, every colloquial expression, every repetition, and every foreign-language phrase while still allowing traceable punctuation, sentence-boundary, formatting, and high-confidence transcription corrections.

## Confirmed Product Rules

- The original transcript is immutable and remains the source of truth.
- Colloquial words, filler words, repeated words, and repeated sentences remain visible exactly as spoken.
- Repetitions are not removed or specially annotated.
- Foreign-language source text remains in the original language and is not replaced by a translation.
- DeepSeek may judge high-confidence transcription errors from context, but every applied correction must be traceable.
- DeepSeek must not infer or add speaker identities.
- Speaker diarization is outside this change.
- Polishing and summarization are separate model operations.
- A truncated, incomplete, invalid, or untraceable response never replaces the source transcript.

## Current Failure

The current `note-poster` request samples long transcripts, asks one response to contain both a complete rewritten transcript and a summary, and accepts any non-empty polished text. A source transcript of 11,069 characters can therefore be silently accepted as a 7,749-character polished transcript.

## Architecture

Keep the public `note-poster` request and result contract stable. Internally, orchestrate the request in three phases:

1. Build ordered source segments with stable IDs.
2. Send every segment through bounded proofreading batches. DeepSeek returns only localized replacement operations and review items, never a rewritten full transcript.
3. Apply validated replacements to the immutable source locally, then make a separate summary request using the complete polished transcript.

The local application step is the trust boundary. Text outside an explicitly validated replacement is copied byte-for-byte from the source segment.

## Batch Model

- Empty transcript segments are ignored consistently with existing archive behavior.
- Each non-empty segment receives a stable ID based on its original index: `segment-1`, `segment-2`, and so on.
- Batches are bounded by serialized character size instead of an arbitrary segment count.
- Every primary segment appears in exactly one proofreading batch.
- A small number of preceding segments may be sent as read-only context.
- Context segments cannot be changed.
- Batch responses identify their declared start and end segment IDs so coverage can be checked.

## Proofreading Response

Each change contains:

- `segmentId`
- `originalText`: an exact, uniquely occurring substring of that source segment
- `replacementText`
- `changeType`: punctuation, sentence boundary, transcription error, or formatting
- `reason`
- `confidence`
- `highRisk`

Each review item contains the source segment, unchanged text, reason, and optional interpretation. Review items do not modify the transcript.

## Validation

A proofreading batch fails when any of the following occurs:

- API `finish_reason` is `length`.
- JSON is invalid or required arrays are absent.
- Declared batch boundaries do not match the requested batch.
- A returned segment is outside the primary batch.
- `originalText` is empty, absent from the source, or occurs more than once.
- Replacement operations overlap.
- `replacementText` is empty.
- A change type is unsupported.
- Confidence is missing or outside 0 to 1.
- A large text reduction is attempted inside one replacement.

No partial batch is applied. If any batch fails, the complete polishing operation fails and the caller retains the original transcript.

## Preservation Checks

- The number and order of source segments are unchanged.
- All unchanged spans are copied directly from the source.
- Applied replacements are recorded in a correction log.
- Numbers, dates, model names, identifiers, foreign phrases, negations, and other risky content may only change through an explicit correction record.
- The assembled polished transcript must remain within a conservative length-loss threshold. The threshold is a final alarm, not the primary protection.
- The summary call cannot alter the already assembled polished transcript.

## Summary Phase

The second DeepSeek call receives the complete locally assembled polished transcript. It returns only title, subtitle, key points, keywords, prompt, audit checklist, and review items. It never returns `polishedTranscriptText`.

The final existing `NotePosterSummary` is assembled locally:

- summary fields come from the summary response;
- `polishedTranscriptText` comes from the local immutable-source patch process;
- `auditChecklistText` includes the model checklist plus a compact correction/review record.

## Failure Behavior

- Any proofreading failure surfaces as `DeepSeekServiceError('invalid-output', ...)`.
- The transcription queue continues its existing behavior: transcription and original archive registration succeed even if DeepSeek processing fails, while the summary error remains visible.
- Existing archived original transcripts are never overwritten by a failed polish operation.

## Compatibility

- Keep `DeepSeekGenerateRequest` and `DeepSeekGenerateResult` unchanged.
- Keep renderer and preload APIs unchanged.
- Keep archive text headings unchanged.
- Do not add speaker UI or a new user setting in this change.

## Verification

Tests must prove that:

- every long-transcript segment is sent exactly once as a primary segment;
- filler words, repetitions, and foreign text survive unchanged when no replacement is returned;
- only exact localized replacements are applied;
- invalid, overlapping, out-of-batch, destructive, and truncated changes are rejected;
- the summary request receives the complete polished text;
- the final polished transcript is locally assembled rather than accepted from the summary response;
- existing short-note and queue failure behavior remains intact.
