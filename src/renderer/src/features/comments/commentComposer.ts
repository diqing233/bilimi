import type { RecommendationKind } from '@shared/types'

export function composeMemorialComments(kind: RecommendationKind, title: string): string[] {
  if (kind === 'knowledge') {
    return [
      `小mi替我家主人来夸一句：《${title}》看得很顺，知识点像奶茶里的珍珠一样一颗颗弹出来。UP主请再接再厉，多更新点这种宝藏视频！`,
      `我家主人很喜欢《${title}》，特派小mi前来点赞盖章：讲得清楚，节奏也舒服。UP主再接再厉，小mi已经搬好小板凳等下集啦！`,
      `小mi把《${title}》加入主人今日快乐库存：内容有劲儿，表达也稳。UP主请继续再接再厉，更新更多精彩视频，小mi负责第一时间来报喜！`
    ]
  }

  if (kind === 'funny') {
    return [
      `小mi奉主人之命来夸《${title}》：笑点来得太突然，主人差点把表情管理交出去。UP主再接再厉，多更新点，小mi还想继续笑！`,
      `我家主人很喜欢《${title}》，特派小mi送上弹幕级夸夸：好看、有梗、下饭。UP主请再接再厉，别让小mi的追更雷达空转呀！`,
      `小mi认证：《${title}》让主人嘴角比进度条还难按住。UP主再接再厉，继续更新更多精彩视频，小mi负责端着夸夸来巡逻！`
    ]
  }

  if (kind === 'suspicious') {
    return [
      `小mi替我家主人看完《${title}》后认真点头：虽然小雷达响了一下，但视频确实有看头。UP主再接再厉，继续把精彩内容安排上！`,
      `我家主人很喜欢《${title}》里的亮点，小mi也来补一句：如果少一点套路，多一点真诚就更香啦。UP主再接再厉，小mi等你继续发光！`,
      `小mi给《${title}》贴一张温柔小便签：内容有趣，主人看得很投入。UP主请再接再厉，更新更多精彩视频，小mi会带着小本本继续支持！`
    ]
  }

  return [
    `小mi替我家主人来夸《${title}》：看得很入戏，像不小心点开了快乐开关。UP主请再接再厉，更新更多精彩视频！`,
    `我家主人很喜欢《${title}》，特派小mi前来送花式夸夸：节奏舒服，内容也有劲。UP主再接再厉，小mi继续蹲更新！`,
    `小mi把《${title}》加入主人今日快乐库存：这次很会整，下次还想看。UP主请再接再厉，多端点好东西出来，小mi等着补货！`
  ]
}
