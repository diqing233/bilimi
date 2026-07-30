# Favorite Library Performance, Detail, And Transcription Design

**Date:** 2026-07-27

## Goal

Finish the Favorite Library refinement without a large rewrite: make reopening fast, rebuild Bilimi placement correctly after local-data cleanup, unify navigation and detail interactions, improve dense-card geometry, expose authoritative transcription progress/cancellation, and add faithful archive navigation/export.

## Non-Goals

- Do not package, publish, push, clear user data, or replace the existing repository architecture.
- Do not perform a remote Bilibili scan merely because the drawer opened.
- Do not create a second transcription queue, placement state machine, or event source.
- Do not make `adopt remote` a permanent primary action.
- Do not delete transcript/archive/protection/history when removing a video from a Bilimi work folder.

## Coordination Boundary

The active DeepSeek/model task owns DeepSeek retry/checkpoint logic, provider/runtime/model management, model settings, and its current transcription queue contract changes until it reports completion. The Favorite Library task may start with renderer-only layout work, but must not edit shared files currently owned by that task. After the model task finishes, the Favorite Library task reviews its diff and integrates queue cancellation, progress, exports, and shared IPC sequentially.

## Fast Open And Background Reconciliation

Opening the drawer must read the current account and load the existing local summary and requested page immediately. Summary and page reads run in parallel after account identity is known. The drawer distinguishes `loading`, `loaded-empty`, `loaded-data`, and `refreshing`; an undefined summary/page must never render as zero videos.

The previous account-scoped summary, page, scope, search, sort, pagination, collapsed groups, selection, and detail state remain available after close. Reopening renders cached data immediately and validates the repository revision in the background. Account changes and account-data cleanup invalidate only that account's cache and cancel stale requests.

Persisted Bilimi binding recovery and placement observation repair are background maintenance. They compute a diff outside the write-critical section, merge remote observations against the latest repository revision, and commit a bounded batch instead of one command per video. They must never overwrite `localDesiredFolderIds` changed by a user. Repeated open/change events coalesce into one per-account repair. User commands have priority, and one repair produces one repository notification.

## Placement Reconstruction

After local cleanup and a new scan, a remote Bilimi work folder must reconstruct the corresponding logical work folder. Remote folder ID is authoritative; normalized title is fallback evidence only. Existing logical folders are reused and duplicate titles are not created.

Consistency compares current complete placement sets, not historical origin. If both sides place a video in `bilimi·创意美学`, the state is consistent even if the old local mapping was deleted. Multiple memberships are compared as sets. Source folders remain provenance and must not be mistaken for desired placement.

## Navigation

Every navigation row has a stable trailing slot. `bilimi 工作夹` and each Bilimi work-folder row show their count in that slot; hover or keyboard focus replaces the count with an ellipsis without layout shift. The group menu contains create, sync all, and delete all. A folder menu contains edit and delete. The disclosure chevron stays beside the group label.

`其他收藏夹` and its folders place counts in the same right-aligned slot but never replace them with an ellipsis.

Menus are portals anchored to the triggering ellipsis: 6px below, horizontally centered, clamped to an 8px viewport gutter. They may overflow the navigation column. They reposition on drawer movement, resize, and scroll; outside click, a second trigger click, or Escape closes them and returns focus.

## List Geometry

The list header and scroll body share one clipped rounded container. Header background fills both top corners, the scrollbar remains inside the right corner, and there is one header/body divider. Normal rows use a 72-76px minimum height, expanding only when content or system scaling requires it. Checkbox, two-line status block, and transcription action block are vertically centered. Titles remain one-line ellipses with full-title hover text; author and video ID remain visible.

Every sortable or filterable column header exposes its current condition in parentheses: `视频名称（最近更新）`, `状态（全部）`, and `转写（已选 2 项）`. The transcription menu supports multi-select for completed, no transcript, waiting, running, and failed. A saved usable transcript always matches completed even when a newer queue job exists; the same video may also match the newer queue state. Canceled work without a saved transcript matches no transcript. Filtering applies to the complete repository query before pagination, never only to the visible page, and runs locally without a Bilibili scan.

Primary structural boundaries use 1px solid porcelain blue: workspace header/tools, list header/body, row boundaries, and list/pagination. Information sections use the existing blue dashed divider. Full-width dividers reach the owning card's inner edges while text retains padding; rounded parents clip the divider.

## Detail Layout

The detail header is video title, `UP: author · AV/BV`, then `打开视频`, `刷新资料`, `更多信息`, `收起详情` in that order; collapse is rightmost.

`更多信息` expands below the stable button row and contains the full description and full tag set. Missing, loading, and failed metadata are distinct. Switching videos resets the previous video's transient expansion state.

Status remains independent in three dimensions: sync on the first centered row, protection and organization on the second row.

`来源与时间` owns the `查看完整处理记录` button above its provenance text. The separate processing-record section is removed. The expanded newest-first timeline uses Chinese labels and includes entered, review, old-favorite organization, manual move, scan observation, remote sync, local/remote adoption, transcription, and archive registration. It is audit history, not undo history or technical logging.

`收藏归属` merges placement actions and information. `复制至`, `移动至`, and `同步到B站` appear above `收藏库归属`, `B站收藏夹`, and `归属状态`. Copy is additive; move changes local desired placement; sync writes local intent remotely. Other Bilibili folders remain copy-only. `采用B站位置` appears only inside an actual conflict choice beside `以收藏库为准并同步`.

Audio/archive actions appear above their status text. The action reflects the authoritative queue state and supports enqueue, cancel queued, cancel running, cancel summary, retry, and archive detail.

## Transcription Queue

Use one expandable queue panel. The collapsed header shows counts and aggregate running progress. The expanded panel shows running/queued/completed counts, a bulk row, and one checkbox list. There is no duplicate dropdown queue.

Waiting jobs cancel immediately. Running jobs transition to `正在取消…`, terminate the worker, then become `已取消`. Summary cancellation stops only summary generation and preserves transcript/polishing checkpoints. Cancellation has no confirmation, retains the record and existing archive, and permits requeue. Completion/cancel races resolve by backend final state. Identity is account + video + part, never title.

Favorite Library and queue consume one snapshot/event stream. Progress stages are download audio, prepare audio, transcribe, merge transcript, generate transcript, DeepSeek polish batches, generate summary, and save archive. Updates are throttled and patch only affected rows.

All installed models support sequential batch queues. Each job captures its model on enqueue, mixed-model queues are allowed, and consecutive jobs reuse runtimes. The built-in default remains immediately available; SenseVoiceSmall, faster-whisper large-v3-turbo, and faster-whisper large-v3 are optional downloads with size, hardware, language, quality/speed, source/license, and current-device guidance before download.

Model selection uses one porcelain-themed custom dropdown rather than four stacked native-looking cards. The closed trigger shows the selected model plus its authoritative state. The portal menu groups installed and optional-download models, uses a rotating chevron, keyboard navigation, pale-blue selected/hover states, light-blue borders, and viewport clamping. Selecting an uninstalled model opens the approved download explanation; a downloaded model cannot become current until its model file and runtime both pass validation. Built-in Whisper small cannot be deleted, and optional models cannot be deleted while current or referenced by active/queued work.

SenseVoiceSmall and Whisper small remain CPU-only in this release. The two faster-whisper large models support CPU plus optional NVIDIA CUDA acceleration; GPU acceleration is explicitly unavailable for AMD and Intel GPUs, which continue through CPU without being treated as errors. Large-model execution automatically chooses NVIDIA only after GPU, driver, CUDA runtime, and memory self-checks pass. The queue records the actual device. Initialization failure may fall back to CPU with feedback; a mid-run out-of-memory failure stops and offers an explicit CPU retry rather than silently restarting. Only one GPU transcription job runs at once, cancellation must release GPU memory, and model files are shared between CPU and GPU paths.

## Timeline And Export

Valid transcript timestamps seek the correct video/part while preserving play/pause. If needed, Bilimi wakes, opens the video, then seeks. Invalid timestamps are not interactive. Exported timestamps use Bilibili links.

The export dialog selects current content or complete archive, Markdown and/or Word with at least one format selected, and optionally notes when notes exist. Complete archive includes metadata/provenance/date, plain transcript, timed transcript, and DeepSeek summary. A missing summary keeps a `暂未生成` section. It excludes media, internal logs, and complete version history. Export uses stored content without another DeepSeek call, UTF-8 Markdown, background `.docx` generation, and conflict-safe numbered filenames.

Favorite Library and the transcription queue expose the same non-dangerous `下载文稿` batch action and call one main-process batch exporter. Favorite Library selection can cover the complete current folder/query/filter result beyond the visible page; the queue exports selected records that still resolve to a saved archive. The confirmation reports selected, exportable, and skipped counts. Untranscribed, still-running, or unresolved archive records are skipped without empty placeholder files or blocking valid exports.

The user chooses a parent directory once. Every export, including a single video, creates a new `bilimi文稿_YYYY-MM-DD_HHmm` folder and writes a flat set of files named from sanitized video title plus BV/AV identity. Existing folders/files are never overwritten; collisions receive numbered suffixes. Each selected format produces one file per exportable video. Generation is sequential in the main process with bounded memory, progress and cancellation of remaining work. Cancellation preserves completed files. One item failure does not abort the batch; completion reports success, skipped, and failed items and offers to open the created folder. Renderer requests carry archive identities and selection descriptors rather than full archive bodies, and the main process re-resolves the saved archive/version before writing.

## Performance And Safety

- Reopen target: cached content visible within about 100ms.
- Cold local target: existing summary/page visible within about 300ms.
- No false zero state, full-page clearing, scroll reset, or selection loss during refresh.
- No one-write-per-video repair and no one-render-per-progress-event.
- Stale async results are rejected by account, request ID, and repository revision.
- Menus, drawers, rows, and exports are verified at 100%, 125%, and 150% scaling and with reduced motion.
- New behavior is covered by focused Vitest/Testing Library tests, repository integration tests, build, diff check, clean development restart, and screenshot verification.

## Acceptance

The implementation is complete only when every requirement above maps to a passing test or recorded manual check, the active model task has been integrated without regressions, no required checkbox remains open in the implementation plan, a clean development restart succeeds, and the user can perform screenshot acceptance. Packaging is explicitly excluded unless separately requested; if later requested, `docs/release-checklist.md` is mandatory.
