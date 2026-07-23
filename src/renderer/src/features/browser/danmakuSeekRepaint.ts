const SETTLED_SEEK_DELAY_MS = 140

/**
 * Guest-page script: wait for a settled seek, then briefly nudge existing
 * compositor surfaces. It never requests data or changes the player's state.
 */
export function buildDanmakuSeekRepaintScript(): string {
  return `(() => {
    const key = '__bilimiDanmakuSeekRepaint';
    const previous = window[key];
    if (previous && typeof previous.dispose === 'function') previous.dispose();

    const video = document.querySelector('video');
    if (!video) return false;
    let timeout;
    const repaint = () => {
      const targets = Array.from(document.querySelectorAll(
        '.bpx-player-dm-wrap,.bpx-player-dm-container,.bilibili-player-video-danmaku,.bpx-player-dm-wrap canvas,.bpx-player-dm-wrap svg'
      ));
      if (!targets.length) return;
      window.dispatchEvent(new Event('resize'));
      const saved = targets.map((target) => ({ target, transform: target.style.transform, willChange: target.style.willChange }));
      for (const entry of saved) {
        entry.target.style.willChange = 'transform';
        entry.target.style.transform = entry.transform ? entry.transform + ' translateZ(0)' : 'translateZ(0)';
        void entry.target.getBoundingClientRect();
      }
      window.requestAnimationFrame(() => {
        for (const entry of saved) {
          entry.target.style.transform = entry.transform;
          entry.target.style.willChange = entry.willChange;
        }
      });
    };
    const onSeeked = () => {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(repaint, ${SETTLED_SEEK_DELAY_MS});
    };
    video.addEventListener('seeked', onSeeked);
    window[key] = {
      dispose() {
        window.clearTimeout(timeout);
        video.removeEventListener('seeked', onSeeked);
      }
    };
    return true;
  })()`
}
