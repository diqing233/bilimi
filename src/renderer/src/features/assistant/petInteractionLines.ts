export const PET_IDLE_GREETINGS = [
  '主人还在吗？小咪在这里陪你慢慢看。',
  '小咪刚刚发了一会儿呆，主人要不要喝口水？',
  '屏幕安静下来啦，小咪也乖乖等着主人。'
]

export const PET_WELCOME_HOME_LINES = [
  '欢迎回来，主人。小咪一直在等你。',
  '主人回来啦，小咪刚刚差点就要跑去找你了。',
  '小咪在这里，欢迎回家。'
]

export const PET_COLLAPSE_FAREWELL_LINES = [
  '主人先专心享受，有需要随时呼唤小咪'
]

export const PET_EXPAND_GREETING_LINE = '主人想要做些什么呢~'

export const PET_VIDEO_OPENING_LINES = [
  '小咪好期待呀，这个视频会不会很有意思～',
  '新视频打开啦，小咪已经搬好小板凳了。',
  '主人又发现新东西啦，小咪跟着一起看看。'
]

export const PET_VIDEO_FINISHED_LINES = [
  '视频看完啦，要不要去批阅一下？小咪陪主人收个尾。',
  '这一支结束啦，小咪把批阅按钮给主人记着呢。',
  '看完啦，主人要不要顺手批阅一下？'
]

export function pickPetLine(lines: string[], random = Math.random): string {
  const index = Math.min(Math.floor(random() * lines.length), lines.length - 1)

  return lines[Math.max(index, 0)] ?? ''
}
