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

/**
 * Split a message at the first character that would start a line after the
 * requested number of wrapped lines. The renderer uses `overflow-wrap:anywhere`
 * and a fixed-width text column, so measuring each candidate line mirrors the
 * browser layout without touching the DOM during a click handler.
 */
export function splitFeedbackContinuationByLines(
  text: string,
  availableWidth: number,
  maxLines: number,
  measure: (value: string) => number
) {
  if (!text || availableWidth <= 0 || maxLines <= 0) return { visible: '', suffix: text }

  const characters = Array.from(text)
  const fits = (length: number) => {
    let line = ''
    let lines = 1
    for (const character of characters.slice(0, length)) {
      if (character === '\n') {
        lines += 1
        line = ''
        if (lines > maxLines) return false
        continue
      }
      const candidate = `${line}${character}`
      if (line && measure(candidate) > availableWidth) {
        lines += 1
        line = character
        if (lines > maxLines || measure(line) > availableWidth) return false
      } else {
        line = candidate
        if (measure(line) > availableWidth) return false
      }
    }
    return lines <= maxLines
  }

  if (fits(characters.length)) return { visible: text, suffix: '' }

  let low = 0
  let high = characters.length
  let visibleLength = 0
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    if (fits(middle)) {
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
