export function buildReadCurrentVideoTimeScript(): string {
  return `
    (async () => {
      const video = document.querySelector('video');

      if (!video) {
        throw new Error('未找到当前视频播放器，无法读取时间点。');
      }

      return Number(video.currentTime || 0);
    })();
  `
}

export function buildSeekVideoTimeScript(seconds: number): string {
  const targetSeconds = Math.max(0, Number.isFinite(seconds) ? seconds : 0)

  return `
    (async () => {
      const video = document.querySelector('video');

      if (!video) {
        throw new Error('未找到当前视频播放器，无法跳转时间点。');
      }

      video.currentTime = ${targetSeconds};
      try {
        const playResult = video.play?.();

        if (playResult && typeof playResult.catch === 'function') {
          playResult.catch(() => undefined);
        }
      } catch {
        // Playback resume can be blocked or slow; the seek already completed.
      }

      return true;
    })();
  `
}
