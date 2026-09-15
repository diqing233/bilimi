export type WorkspaceGuidanceKey =
  | 'review'
  | 'notes'
  | 'archive'
  | 'ledger'
  | 'favoriteLibrary'
  | 'settings'

type WorkspaceGuidance = {
  global: string
  pet: string
}

export const WORKSPACE_GUIDANCE: Record<WorkspaceGuidanceKey, WorkspaceGuidance> = {
  review: {
    global: '批阅：可以一键三连、自动分类收藏（需先在掌库完成备册），发送弹幕（建议开启 DeepSeek 生成）。',
    pet: '小咪切到批阅啦，可以一键三连、自动分类收藏，还能发送弹幕哦～'
  },
  notes: {
    global: '札记：通过转写音频输出视频文稿；建议在设置页下载并启用识别率更高的转写模型。启用 DeepSeek 后可总结笔记。',
    pet: '小咪切到札记啦，点击转写音频就能输出视频文稿，还可以用 DeepSeek 总结笔记哦～'
  },
  archive: {
    global: '档案库：可以查看已转写成功的视频文稿，支持搜索、备注和批量导出。',
    pet: '主人，档案库已经打开啦，想看整理好的文稿，随时来找小咪哦～'
  },
  ledger: {
    global: '掌库：备册后批阅操作可自动分类保存；“整理收藏”可建立本地收藏库，并将整理结果同步到 B 站。',
    pet: '小咪切到掌库啦，备册后就可以在 B 站生成 bilimi 收藏夹；以后分类整理视频，安心交给我吧！'
  },
  favoriteLibrary: {
    global: '收藏库：bilimi 本地收藏库，支持批量管理所有已整理的视频。',
    pet: '主人，收藏库已经打开啦，快看看小咪整理得怎么样呀！'
  },
  settings: {
    global: '设置：建议配置 DeepSeek、下载更强的转写模型以提升使用体验；支持宠物设置、数据迁移等功能。',
    pet: '小咪切到设置啦，配置 DeepSeek、下载更好的转写模型，都可以大幅提升小咪的能力哦！'
  }
}
