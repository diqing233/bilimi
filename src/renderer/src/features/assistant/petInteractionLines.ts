export const PET_IDLE_GREETINGS = [
  '主人还在吗？小咪在这里陪你慢慢看。',
  '小咪刚刚发了一会儿呆，主人要不要喝口水？',
  '屏幕安静下来啦，小咪也乖乖等着主人。'
]

export const PET_VIDEO_OPENING_LINES = [
  '小咪好期待呀，这个视频会不会很有意思～',
  '新视频打开啦，小咪已经搬好小板凳了。',
  '主人又发现新东西啦，小咪跟着一起看看。'
]

export function pickPetLine(lines: string[], random = Math.random): string {
  const index = Math.min(Math.floor(random() * lines.length), lines.length - 1)

  return lines[Math.max(index, 0)] ?? ''
}
