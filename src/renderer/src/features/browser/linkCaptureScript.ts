export function buildOpenLinksInAppScript(): string {
  return `
    (() => {
      const openSignalPrefix = '__BILIMI_OPEN_IN_TAB__:';
      const petHintSignalPrefix = '__BILIMI_PET_HINT__:';

      if (window.__bilimiOpenLinksInstalled) {
        return true;
      }

      window.__bilimiOpenLinksInstalled = true;

      const isHttpNavigableUrl = (url) => {
        return url.protocol === 'https:' || url.protocol === 'http:';
      };

      const isBilibiliNavigableUrl = (url) => {
        return /(^|\\.)bilibili\\.com$/.test(url.hostname) && url.protocol === 'https:';
      };

      const readUrlFromAnchor = (anchor, allowAnyHttpUrl = false) => {
        if (!anchor) {
          return null;
        }

        try {
          const url = new URL(anchor.getAttribute('href') || anchor.href, window.location.href);

          if (isBilibiliNavigableUrl(url) || (allowAnyHttpUrl && isHttpNavigableUrl(url))) {
            return url.href;
          }

          return null;
        } catch {
          return null;
        }
      };

      const hasNewPageTarget = (element) => {
        const target = element?.getAttribute?.('target')?.trim()?.toLowerCase?.();

        return Boolean(target && target !== '_self');
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
          return readUrlFromAnchor(anchor, hasNewPageTarget(anchor));
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

      const readUrlForWindowOpen = (url) => {
        if (url === undefined || url === null || url === '') {
          return null;
        }

        try {
          const parsed = new URL(String(url), window.location.href);

          return isHttpNavigableUrl(parsed) ? parsed.href : null;
        } catch {
          return null;
        }
      };

      const nativeOpen = window.open?.bind?.(window);

      const shouldCreateDeferredWindowProxy = (url, target) => {
        const rawUrl = url === undefined || url === null ? '' : String(url).trim();
        const rawTarget = target === undefined || target === null ? '' : String(target).trim().toLowerCase();

        return (!rawUrl || rawUrl === 'about:blank') && rawTarget !== '_self';
      };

      const createDeferredWindowProxy = () => {
        let href = 'about:blank';
        const locationProxy = {};
        const windowProxy = {
          closed: false,
          close() {
            this.closed = true;
          },
          focus() {},
          blur() {}
        };

        Object.defineProperty(locationProxy, 'href', {
          configurable: true,
          get() {
            return href;
          },
          set(value) {
            const urlToOpen = readUrlForWindowOpen(value);

            href = String(value || '');

            if (urlToOpen) {
              requestOpenInTab(urlToOpen);
            }
          }
        });

        Object.defineProperty(windowProxy, 'location', {
          configurable: true,
          get() {
            return locationProxy;
          },
          set(value) {
            locationProxy.href = value;
          }
        });

        return windowProxy;
      };

      const openInBilimiTab = (url, target, features) => {
        const urlToOpen = readUrlForWindowOpen(url);

        if (urlToOpen) {
          requestOpenInTab(urlToOpen);
          return null;
        }

        if (shouldCreateDeferredWindowProxy(url, target)) {
          return createDeferredWindowProxy();
        }

        return nativeOpen ? nativeOpen(url, target, features) : null;
      };

      try {
        Object.defineProperty(window, 'open', {
          configurable: true,
          writable: true,
          value: openInBilimiTab
        });
      } catch {
        window.open = openInBilimiTab;
      }

      const buildGetFormUrl = (form) => {
        if (!form || !hasNewPageTarget(form)) {
          return null;
        }

        const method = (form.getAttribute('method') || 'get').trim().toLowerCase();

        if (method && method !== 'get') {
          return null;
        }

        try {
          const url = new URL(form.getAttribute('action') || window.location.href, window.location.href);

          if (!isHttpNavigableUrl(url)) {
            return null;
          }

          const formData = new FormData(form);

          for (const [name, value] of formData.entries()) {
            url.searchParams.append(name, typeof value === 'string' ? value : value.name);
          }

          return url.href;
        } catch {
          return null;
        }
      };

      const findSearchContainer = (target) => {
        return (
          target?.closest?.(
            '.nav-search, .bili-header__search, .center-search-container, .mini-header__search, form[action*="search.bilibili.com"]'
          ) || null
        );
      };

      const findSearchInput = (target) => {
        const container = findSearchContainer(target);
        const selectors = [
          '.nav-search-input',
          'input[name="keyword"]',
          'input[type="search"]',
          'input[placeholder*="搜索"]',
          'input[placeholder*="搜尋"]'
        ];

        for (const selector of selectors) {
          const input = container?.querySelector?.(selector) || document.querySelector(selector);

          if (input && 'value' in input) {
            return input;
          }
        }

        return null;
      };

      const buildBilibiliSearchUrl = (target) => {
        const input = findSearchInput(target);
        const keyword = String(input?.value || '').trim();

        if (!keyword) {
          return null;
        }

        const url = new URL('https://search.bilibili.com/all');
        url.searchParams.set('keyword', keyword);

        return url.href;
      };

      const resolveBilibiliSearchUrlFromButton = (target) => {
        const control = target?.closest?.(
          '.nav-search-btn, .search-btn, button[type="submit"], input[type="submit"], button[aria-label*="搜索"], [role="button"][aria-label*="搜索"]'
        );

        if (!control || !findSearchContainer(control)) {
          return null;
        }

        return buildBilibiliSearchUrl(control);
      };

      const resolveBilibiliSearchUrlFromEnter = (event) => {
        if (event.key !== 'Enter' || event.isComposing) {
          return null;
        }

        const target = event.target;
        const tagName = target?.tagName?.toLowerCase?.();

        if (tagName !== 'input' && tagName !== 'textarea') {
          return null;
        }

        if (!findSearchContainer(target)) {
          return null;
        }

        return buildBilibiliSearchUrl(target);
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
          const searchUrl = resolveBilibiliSearchUrlFromButton(event.target);

          const petHint = resolvePetHint(event.target);

          if (petHint) {
            requestPetHint(petHint);
          }

          if (searchUrl) {
            event.preventDefault();
            event.stopPropagation();
            requestOpenInTab(searchUrl);
            return;
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

      document.addEventListener(
        'keydown',
        (event) => {
          if (event.defaultPrevented) {
            return;
          }

          const searchUrl = resolveBilibiliSearchUrlFromEnter(event);

          if (!searchUrl) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          requestOpenInTab(searchUrl);
        },
        true
      );

      document.addEventListener(
        'submit',
        (event) => {
          if (event.defaultPrevented) {
            return;
          }

          const url = buildGetFormUrl(event.target);

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
