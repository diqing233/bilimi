type FloatingWindowDocumentTarget = {
  documentElement: HTMLElement
  body: HTMLElement
  title: string
}

export function markFloatingWindowDocument(
  search: string,
  target: FloatingWindowDocumentTarget = document
) {
  const route = new URLSearchParams(search)
  const isFloatingWindow = route.get('window')?.startsWith('floating-') ?? false

  if (!isFloatingWindow) {
    return false
  }

  target.documentElement.dataset.floatingWindow = 'true'
  target.body.dataset.floatingWindow = 'true'
  target.title = ''

  return true
}
