import type { RecommendationKind } from '@shared/types'

function normalizeCommentMetadata(title: string, author?: string): { title: string; author: string } {
  return {
    title: title.trim() || '当前视频',
    author: author?.trim() || '这位UP'
  }
}

export function composeMemorialComments(
  kind: RecommendationKind,
  title: string,
  author?: string
): string[] {
  const metadata = normalizeCommentMetadata(title, author)
  const videoTitle = metadata.title
  const upName = metadata.author

  if (kind === 'knowledge') {
    return [
      `小咪替我家主人来夸一句：${upName}的《${videoTitle}》看得很顺，知识点像奶茶里的珍珠一样一颗颗弹出来。UP主请再接再厉，多更新点这种宝藏视频！`,
      `我家主人很喜欢${upName}的《${videoTitle}》，特派小咪前来点赞盖章：讲得清楚，节奏也舒服。UP主再接再厉，小咪已经搬好小板凳等下集啦！`,
      `小咪把${upName}的《${videoTitle}》加入主人今日快乐库存：内容有劲儿，表达也稳。UP主请继续再接再厉，更新更多精彩视频，小咪负责第一时间来报喜！`
    ]
  }

  if (kind === 'funny') {
    return [
      `小咪奉主人之命来夸${upName}的《${videoTitle}》：笑点来得太突然，主人差点把表情管理交出去。UP主再接再厉，多更新点，小咪还想继续笑！`,
      `我家主人很喜欢${upName}的《${videoTitle}》，特派小咪送上弹幕级夸夸：好看、有梗、下饭。UP主请再接再厉，别让小咪的追更雷达空转呀！`,
      `小咪认证：${upName}的《${videoTitle}》让主人嘴角比进度条还难按住。UP主再接再厉，继续更新更多精彩视频，小咪负责端着夸夸来巡逻！`
    ]
  }

  if (kind === 'suspicious') {
    return [
      `小咪替我家主人看完${upName}的《${videoTitle}》后认真点头：虽然小雷达响了一下，但视频确实有看头。UP主再接再厉，继续把精彩内容安排上！`,
      `我家主人很喜欢${upName}的《${videoTitle}》里的亮点，小咪也来补一句：如果少一点套路，多一点真诚就更香啦。UP主再接再厉，小咪等你继续发光！`,
      `小咪给${upName}的《${videoTitle}》贴一张温柔小便签：内容有趣，主人看得很投入。UP主请再接再厉，更新更多精彩视频，小咪会带着小本本继续支持！`
    ]
  }

  return [
    `小咪替我家主人来夸${upName}的《${videoTitle}》：看得很入戏，像不小心点开了快乐开关。UP主请再接再厉，更新更多精彩视频！`,
    `我家主人很喜欢${upName}的《${videoTitle}》，特派小咪前来送花式夸夸：节奏舒服，内容也有劲。UP主再接再厉，小咪继续蹲更新！`,
    `小咪把${upName}的《${videoTitle}》加入主人今日快乐库存：这次很会整，下次还想看。UP主请再接再厉，多端点好东西出来，小咪等着补货！`
  ]
}
