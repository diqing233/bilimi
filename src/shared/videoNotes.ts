import type { VideoNote, VideoNoteSourceMetadata } from './types'

export function createVideoNoteId(source: Pick<VideoNoteSourceMetadata, 'bvid' | 'url'>): string {
  const bvid = source.bvid?.trim()

  if (bvid) {
    return `bvid:${bvid}`
  }

  return `url:${source.url.trim()}`
}

export function upsertVideoNote(notes: VideoNote[], nextNote: VideoNote): VideoNote[] {
  const existingNote = notes.find((note) => note.id === nextNote.id)

  if (!existingNote) {
    return [...notes, nextNote]
  }

  return notes.map((note) =>
    note.id === nextNote.id
      ? {
          ...nextNote,
          createdAt: note.createdAt
        }
      : note
  )
}
