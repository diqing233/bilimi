import type { VideoNote, VideoNoteAnnotation } from '@shared/types'

export function sortVideoNoteAnnotations(
  annotations: VideoNoteAnnotation[]
): VideoNoteAnnotation[] {
  return [...annotations].sort((left, right) => {
    if (left.start === null && right.start === null) {
      return left.createdAt.localeCompare(right.createdAt)
    }

    if (left.start === null) {
      return 1
    }

    if (right.start === null) {
      return -1
    }

    return left.start - right.start || left.createdAt.localeCompare(right.createdAt)
  })
}

export function saveVideoNoteAnnotation(
  note: VideoNote,
  annotation: VideoNoteAnnotation,
  now = new Date().toISOString()
): VideoNote {
  const annotations = note.annotations ?? []
  const existing = annotations.find((item) => item.id === annotation.id)
  const nextAnnotation: VideoNoteAnnotation = {
    ...annotation,
    title: annotation.title.trim() || '未命名批注',
    body: annotation.body.trim(),
    createdAt: existing?.createdAt ?? annotation.createdAt,
    updatedAt: now
  }
  const nextAnnotations = existing
    ? annotations.map((item) => (item.id === annotation.id ? nextAnnotation : item))
    : [...annotations, nextAnnotation]

  return {
    ...note,
    annotations: sortVideoNoteAnnotations(nextAnnotations),
    updatedAt: now
  }
}

export function removeVideoNoteAnnotation(
  note: VideoNote,
  annotationId: string,
  now = new Date().toISOString()
): VideoNote {
  return {
    ...note,
    annotations: (note.annotations ?? []).filter((annotation) => annotation.id !== annotationId),
    updatedAt: now
  }
}
