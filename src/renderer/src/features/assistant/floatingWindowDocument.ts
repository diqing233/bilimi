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
  target.documentElement.style.setProperty('background', 'transparent', 'important')
  target.body.style.setProperty('background', 'transparent', 'important')
  target.documentElement.style.setProperty('background-color', 'transparent', 'important')
  target.body.style.setProperty('background-color', 'transparent', 'important')
  root?.style.setProperty('background', 'transparent', 'important')
  root?.style.setProperty('background-color', 'transparent', 'important')
  root?.style.setProperty('overflow', 'hidden')
  target.title = ''

  return true
}
