import type { VideoNote, VideoNoteSourceMetadata } from './types'

export function createVideoNoteId(source: Pick<VideoNoteSourceMetadata, 'accountMid' | 'aid' | 'bvid' | 'cid' | 'url'>): string {
  const accountMid = source.accountMid?.trim()
  const aid = source.aid
  const cid = source.cid

  if (
    accountMid &&
    typeof aid === 'number' && Number.isSafeInteger(aid) && aid > 0 &&
    typeof cid === 'number' && Number.isSafeInteger(cid) && cid > 0
  ) {
    return `account:${accountMid}:aid:${aid}:cid:${cid}`
  }

  const bvid = source.bvid?.trim()

  if (bvid) {
    return `bvid:${bvid}`
  }

  return `url:${source.url.trim()}`
}

export function normalizeVideoNote(note: VideoNote): VideoNote {
  return {
    ...note,
    annotations: Array.isArray(note.annotations) ? note.annotations : []
  }
}

export function normalizeVideoNotes(notes: VideoNote[]): VideoNote[] {
  return notes.map(normalizeVideoNote)
}

export function upsertVideoNote(notes: VideoNote[], nextNote: VideoNote): VideoNote[] {
  const normalizedNextNote = normalizeVideoNote(nextNote)
  const existingNote = notes.find((note) => note.id === normalizedNextNote.id)

  if (!existingNote) {
    return [...normalizeVideoNotes(notes), normalizedNextNote]
  }

  return normalizeVideoNotes(notes).map((note) =>
    note.id === normalizedNextNote.id
      ? {
          ...normalizedNextNote,
          createdAt: note.createdAt
        }
      : note
  )
}
