import type { RecommendationKind } from '@shared/types'

const COMMENT_SEND_LIMIT = 100

function trimCommentToSendLimit(comment: string): string {
  const trimmed = comment.trim()
  return trimmed.length > COMMENT_SEND_LIMIT ? trimmed.slice(0, COMMENT_SEND_LIMIT).trimEnd() : trimmed
}

export function composeMemorialComments(
  kind: RecommendationKind,
  _title: string,
  _author?: string
): string[] {
  if (kind === 'knowledge') {
    return [
      '内容挺有收获，值得之后再回来慢慢看。',
      '信息量很足，值得多看几遍消化一下。',
      '这类内容很实用，感谢分享。'
    ].map(trimCommentToSendLimit)
  }

  if (kind === 'funny') {
    return [
      '看得很开心，今天的快乐有了。',
      '这期挺有意思，轻轻松松就看完了。',
      '好看，适合分享给朋友一起看。'
    ].map(trimCommentToSendLimit)
  }

  if (kind === 'suspicious') {
    return [
      '先看完再说，内容还是值得讨论的。',
      '这个话题挺有意思，也想看看大家怎么想。',
      '先留个脚印，希望后续还能看到更多补充。'
    ].map(trimCommentToSendLimit)
  }

  return [
    '看完感觉不错，感谢分享。',
    '这期挺用心的，支持一下。',
    '内容很耐看，期待之后的更新。'
  ].map(trimCommentToSendLimit)
}
