import type { RecommendationKind } from '@shared/types'

const COMMENT_SEND_LIMIT = 100
const COMMENT_CHOICE_COUNT = 3
const AUTHOR_LABEL_LIMIT = 24

type CommentTemplate = (author: string) => string

const KNOWLEDGE_COMMENTS: CommentTemplate[] = [
  (author) => `看完还挺有收获的，有些地方值得回头再琢磨一下，感谢${author}认真分享。`,
  (author) => `信息量挺足，很多想法需要慢慢消化，谢谢${author}把这些内容讲出来。`,
  (author) => `本来只是随手点进来看看，没想到收获不少，感谢${author}用心整理和分享。`,
  (author) => `看完思路清楚了不少，也多了几个可以继续想下去的方向，谢谢${author}。`,
  (author) => `这种愿意把经验说清楚的内容很难得，感谢${author}，准备之后再回来看看。`,
  (author) => `边看边记下了几个挺有启发的点，感谢${author}分享，确实打开了一些新思路。`,
  (author) => `内容不只是看过就算了，还挺值得慢慢琢磨，感谢${author}带来的启发。`,
  (author) => `看完感觉脑子里多了点东西，这趟没白来，谢谢${author}认真分享。`,
  (author) => `有些想法以前没认真考虑过，看完被提醒到了，感谢${author}提供新的角度。`,
  (author) => `先把这份收获记下来，也期待${author}以后继续聊聊这类内容。`
]

const FUNNY_COMMENTS: CommentTemplate[] = [
  (author) => `本来心情普普通通，看完一下轻松了不少，谢谢${author}带来今天这份快乐。`,
  (author) => `不知不觉就一路看完了，嘴角也没放下来过，${author}这期真的挺有意思。`,
  (author) => `今天的快乐算是被${author}承包了一小会儿，看完心情都亮堂了。`,
  (author) => `本来只是想随便看看，结果越看越开心，感谢${author}分享这份轻松。`,
  (author) => `看完忍不住想来留句话，${author}带来的快乐已经稳稳收到啦。`,
  (author) => `最近正好需要一点轻松的内容，没想到被${author}及时投喂到了，谢谢。`,
  (author) => `这一趟点进来很值，看得开心又放松，期待${author}下次继续整点有趣的。`,
  (author) => `快乐来得有点突然，但完全不嫌多，感谢${author}让我轻松了一会儿。`,
  (author) => `看着看着心情就变好了，${author}这份轻松感来得正是时候。`,
  (author) => `原本还有点犯困，结果一路精神着看完了，${author}确实有点东西。`
]

const SUSPICIOUS_COMMENTS: CommentTemplate[] = [
  (author) => `这个话题看完还挺有感触，也留下了一些想继续琢磨的地方，感谢${author}分享。`,
  (author) => `有些地方我还想再想想，不过能把讨论带起来就很有价值，谢谢${author}。`,
  (author) => `看完没有急着下结论，反而多了几个值得思考的问题，感谢${author}提供角度。`,
  (author) => `这个话题确实值得多聊聊，先谢谢${author}把自己的想法认真分享出来。`,
  (author) => `一边看一边在想不同的可能，内容挺能引发讨论，感谢${author}分享。`,
  (author) => `有认同的地方，也有想继续了解的部分，谢谢${author}带来这次讨论。`,
  (author) => `先留个脚印，等想得更明白些再回来看看，也感谢${author}抛出这个话题。`,
  (author) => `看完脑子里还在转，说明这个话题确实有讨论空间，感谢${author}。`,
  (author) => `不一定每个地方都马上有答案，但愿意展开聊就很好，谢谢${author}分享。`,
  (author) => `这次先认真听完了，也想看看大家会怎么理解，感谢${author}带来不同视角。`
]

const GENERAL_COMMENTS: CommentTemplate[] = [
  (author) => `看完还挺有感触的，有些地方值得回头再琢磨一下，感谢${author}分享。`,
  (author) => `本来只是随手点进来看看，没想到不知不觉就看完了，${author}这期挺有意思。`,
  (author) => `这种认真分享内容的感觉很难得，感谢${author}，也期待之后继续更新。`,
  (author) => `看完心里还留着一点回味，忍不住来留句话，谢谢${author}认真分享。`,
  (author) => `能让人安安静静看完的内容就很难得，感谢${author}带来的这段时间。`,
  (author) => `原本只是路过，结果一路看到了最后，${author}这次确实把我留住了。`,
  (author) => `看完感觉挺舒服，也有一些想法留了下来，谢谢${author}用心分享。`,
  (author) => `这一趟点进来没有白来，内容让人愿意多停留一会儿，感谢${author}。`,
  (author) => `刚看完还舍不得马上划走，先来给${author}留个支持，期待下次再见。`,
  (author) => `有认真看进去，也有被轻轻打动到，谢谢${author}带来这次分享。`
]

function trimCommentToSendLimit(comment: string): string {
  const trimmed = comment.trim()
  return trimmed.length > COMMENT_SEND_LIMIT ? trimmed.slice(0, COMMENT_SEND_LIMIT).trimEnd() : trimmed
}

function resolveAuthorLabel(author?: string): string {
  const normalized = author?.replace(/\s+/g, ' ').trim() ?? ''
  return normalized ? normalized.slice(0, AUTHOR_LABEL_LIMIT).trimEnd() : 'UP 主'
}

function templatesForKind(kind: RecommendationKind): CommentTemplate[] {
  if (kind === 'knowledge') return KNOWLEDGE_COMMENTS
  if (kind === 'funny') return FUNNY_COMMENTS
  if (kind === 'suspicious') return SUSPICIOUS_COMMENTS
  return GENERAL_COMMENTS
}

function sampleTemplates(
  templates: CommentTemplate[],
  random: () => number
): CommentTemplate[] {
  const remaining = [...templates]
  const selected: CommentTemplate[] = []

  while (selected.length < COMMENT_CHOICE_COUNT && remaining.length > 0) {
    const randomValue = Math.min(Math.max(random(), 0), 0.9999999999999999)
    const index = Math.floor(randomValue * remaining.length)
    selected.push(remaining.splice(index, 1)[0])
  }

  return selected
}

export function composeMemorialComments(
  kind: RecommendationKind,
  _title: string,
  author?: string,
  random: () => number = Math.random
): string[] {
  const authorLabel = resolveAuthorLabel(author)
  return sampleTemplates(templatesForKind(kind), random).map((template) =>
    trimCommentToSendLimit(template(authorLabel))
  )
}
