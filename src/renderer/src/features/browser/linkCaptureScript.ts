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

      const resolveNavigableUrl = (target) => {
        const anchor = target?.closest?.('a[href]');

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
