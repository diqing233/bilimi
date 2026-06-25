export function buildOpenLinksInAppScript(): string {
  return `
    (() => {
      const openSignalPrefix = '__BILIMI_OPEN_IN_TAB__:';
      const petHintSignalPrefix = '__BILIMI_PET_HINT__:';

      if (window.__bilimiOpenLinksInstalled) {
        return true;
      }

      window.__bilimiOpenLinksInstalled = true;

      const isBilibiliNavigableUrl = (url) => {
        return /(^|\\.)bilibili\\.com$/.test(url.hostname) && url.protocol === 'https:';
      };

      const readUrlFromAnchor = (anchor) => {
        if (!anchor) {
          return null;
        }

        try {
          const url = new URL(anchor.getAttribute('href') || anchor.href, window.location.href);

          return isBilibiliNavigableUrl(url) ? url.href : null;
        } catch {
          return null;
        }
      };

      const resolveCardUrl = (target) => {
        const card = target?.closest?.(
          '[data-bvid], [data-aid], [data-url], [data-target-url], .bili-video-card, .video-card, .recommend-card, .card-box'
        );

        if (!card) {
          return null;
        }

        const dataUrl = card.dataset?.url || card.dataset?.targetUrl;

        if (dataUrl) {
          try {
            const url = new URL(dataUrl, window.location.href);

            if (isBilibiliNavigableUrl(url)) {
              return url.href;
            }
          } catch {
            // Fall through to anchors inside the card.
          }
        }

        const bvid = card.dataset?.bvid;

        if (bvid) {
          return 'https://www.bilibili.com/video/' + encodeURIComponent(bvid);
        }

        const videoAnchor = card.querySelector?.(
          'a[href*="/video/"], a[href*="//www.bilibili.com/video/"], a[href*="//bilibili.com/video/"]'
        );

        return readUrlFromAnchor(videoAnchor);
      };

      const resolveNavigableUrl = (target) => {
        const anchor = target?.closest?.('a[href]');

        if (anchor) {
          return readUrlFromAnchor(anchor);
        }

        const interactiveControl = target?.closest?.(
          'button, input, textarea, select, option, [role="button"], [role="menuitem"], [contenteditable="true"]'
        );

        if (interactiveControl) {
          return null;
        }

        return resolveCardUrl(target);
      };

      const requestOpenInTab = (url) => {
        const previousTitle = document.title;
        document.title = openSignalPrefix + encodeURIComponent(url);

        window.setTimeout(() => {
          if (document.title === openSignalPrefix + encodeURIComponent(url)) {
            document.title = previousTitle;
          }
        }, 0);
      };

      const readText = (target) => {
        return [
          target?.getAttribute?.('aria-label'),
          target?.getAttribute?.('title'),
          target?.innerText,
          target?.textContent
        ]
          .filter(Boolean)
          .join(' ')
          .trim();
      };

      const resolvePetHint = (target) => {
        const control = target?.closest?.(
          'button, input[type="button"], input[type="submit"], [role="button"], .video-like, .video-coin, .video-fav, .video-share, .bpx-player-ctrl-play, .bpx-player-video-btn-start, .nav-search-btn'
        );

        if (!control) {
          return null;
        }

        const text = readText(control);

        if (/点赞|赞|like/i.test(text)) {
          return '小咪看到主人点赞啦，喜欢就要亮出来～';
        }

        if (/投币|coin/i.test(text)) {
          return '给喜欢的视频投币，小咪懂主人这份认真。';
        }

        if (/收藏|fav|稍后再看/i.test(text)) {
          return '小咪帮主人记着：好东西要收好。';
        }

        if (/评论|发送|回复|comment/i.test(text)) {
          return '主人要发评论啦，小咪在旁边帮你打气。';
        }

        if (/分享|share/i.test(text)) {
          return '想分享给别人看？小咪觉得这支有点东西。';
        }

        if (/搜索|search/i.test(text)) {
          return '小咪跟着主人一起找找看。';
        }

        if (/播放|暂停|play|pause/i.test(text)) {
          return '小咪坐好啦，继续看这一段。';
        }

        return null;
      };

      const requestPetHint = (message) => {
        const previousTitle = document.title;
        document.title = petHintSignalPrefix + encodeURIComponent(message);

        window.setTimeout(() => {
          if (document.title === petHintSignalPrefix + encodeURIComponent(message)) {
            document.title = previousTitle;
          }
        }, 0);
      };

      const reviewedFinishedVideoUrls = new Set();

      const requestVideoFinishedHint = () => {
        const currentUrl = window.location.href;

        if (reviewedFinishedVideoUrls.has(currentUrl)) {
          return;
        }

        reviewedFinishedVideoUrls.add(currentUrl);
        requestPetHint('视频看完啦，要不要去批阅一下？小咪陪主人收个尾。');
      };

      document.addEventListener(
        'ended',
        (event) => {
          if (event.target?.tagName?.toLowerCase?.() === 'video') {
            requestVideoFinishedHint();
          }
        },
        true
      );

      document.addEventListener(
        'click',
        (event) => {
          if (
            event.defaultPrevented ||
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
          ) {
            return;
          }

          const url = resolveNavigableUrl(event.target);

          const petHint = resolvePetHint(event.target);

          if (petHint) {
            requestPetHint(petHint);
          }

          if (!url) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          requestOpenInTab(url);
        },
        true
      );

      return true;
    })();
  `;
}

export const buildOpenVideoLinksInAppScript = buildOpenLinksInAppScript
