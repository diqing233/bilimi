const SEPARATOR_PATTERN = /[\s《》<>【】\[\]（）()「」『』·,，、/\\|:：;；!！?？._-]+/g

const KNOWN_TOKEN_PARTS = ['科普', '常识', '冷', '知识', '小']

export function normalizeClassificationText(value = ''): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(SEPARATOR_PATTERN, '')
}

export function tokenizeClassificationText(value = ''): string[] {
  const roughTokens = value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[《》<>【】\[\]（）()「」『』]/g, ' ')
    .split(/[\s,，、/\\|:：;；!！?？._-]+/g)
    .map((token) => token.trim())
    .filter(Boolean)

  return roughTokens.flatMap(splitKnownTokenParts)
}

function splitKnownTokenParts(token: string): string[] {
  const parts: string[] = []
  let index = 0

  while (index < token.length) {
    const part = KNOWN_TOKEN_PARTS.find((candidate) => token.startsWith(candidate, index))
    if (!part) {
      parts.push(token.slice(index))
      break
    }

    parts.push(part)
    index += part.length
  }

  return parts
}
