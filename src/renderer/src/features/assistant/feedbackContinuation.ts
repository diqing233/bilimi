export function feedbackContinuationSuffix(
  text: string,
  availableWidth: number,
  measure: (value: string) => number
) {
  if (!text || availableWidth <= 0 || measure(text) <= availableWidth) return ''

  const characters = Array.from(text)
  const ellipsisWidth = measure('…')
  if (ellipsisWidth >= availableWidth) return text

  let visibleLength = 0
  let low = 0
  let high = characters.length
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    if (measure(`${characters.slice(0, middle).join('')}…`) <= availableWidth) {
      visibleLength = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return characters.slice(visibleLength).join('')
}
