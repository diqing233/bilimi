type FloatingWindowDocumentTarget = {
  documentElement: HTMLElement
  body: HTMLElement
  title: string
  getElementById?: (id: string) => HTMLElement | null
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

  const root = target.getElementById?.('root')

  target.documentElement.dataset.floatingWindow = 'true'
  target.body.dataset.floatingWindow = 'true'
  if (root) {
    root.dataset.floatingWindow = 'true'
  }
  target.documentElement.style.background = 'transparent'
  target.body.style.background = 'transparent'
  target.documentElement.style.backgroundColor = 'transparent'
  target.body.style.backgroundColor = 'transparent'
  root?.style.setProperty('background', 'transparent')
  root?.style.setProperty('background-color', 'transparent')
  root?.style.setProperty('overflow', 'hidden')
  target.title = ''

  return true
}
