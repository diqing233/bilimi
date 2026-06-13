import type { RecommendationKind } from '@shared/types'

export function composeMemorialComments(kind: RecommendationKind, title: string): string[] {
  if (kind === 'knowledge') {
    return [
      `此条《${title}》颇可增识，臣已列案头，敬呈陛下过目。`,
      `臣观《${title}》言之有据，可资见闻，不敢私藏，谨呈御览。`,
      `《${title}》条理尚明，足供一阅，臣特录此札，恭请圣裁。`
    ]
  }

  if (kind === 'funny') {
    return [
      `此条《${title}》颇能解闷，臣观后险些失仪，特请陛下同览。`,
      `《${title}》虽轻，却不至鄙，臣谨以此物进呈陛下。`,
      `臣不敢独享《${title}》这点笑意，特备薄礼，恭呈御览。`
    ]
  }

  if (kind === 'suspicious') {
    return [
      `《${title}》似有市气，臣先加红签，谨请陛下慎入。`,
      `臣观《${title}》略带夹带之意，先行呈报，以候圣断。`,
      `此条《${title}》疑似商贩借路入殿，臣不敢擅断，谨请御览。`
    ]
  }

  return [
    `《${title}》铺陈渐稳，臣不敢泄机，谨请陛下亲览。`,
    `此条《${title}》尚有后劲，臣先呈折，不敢多言。`,
    `臣谨录《${title}》于案头，后文如何，仍待陛下自断。`
  ]
}
