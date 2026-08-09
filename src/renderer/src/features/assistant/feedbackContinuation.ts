export function splitFeedbackContinuation(
  text: string,
  availableWidth: number,
  measure: (value: string) => number
) {
  if (!text || availableWidth <= 0 || measure(text) <= availableWidth) return { visible: text, suffix: '' }

  const characters = Array.from(text)
  let visibleLength = 0
  let low = 0
  let high = characters.length
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    if (measure(characters.slice(0, middle).join('')) <= availableWidth) {
      visibleLength = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return {
    visible: characters.slice(0, visibleLength).join(''),
    suffix: characters.slice(visibleLength).join('')
  }
}

export function feedbackContinuationSuffix(
  text: string,
  availableWidth: number,
  measure: (value: string) => number
) {
  return splitFeedbackContinuation(text, availableWidth, measure).suffix
}
