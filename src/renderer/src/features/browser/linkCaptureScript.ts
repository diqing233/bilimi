export function buildOpenLinksInAppScript(): string {
  return `
    (() => {
      const openSignalPrefix = '__BILIMI_OPEN_IN_TAB__:';

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
          '[data-bvid], [data-aid], [data-url], [data-target-url], .bili-video-card, .video-card, .feed-card, .recommend-card, .card-box'
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

        return readUrlFromAnchor(anchor) || resolveCardUrl(target);
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
