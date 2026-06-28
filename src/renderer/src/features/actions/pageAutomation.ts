import type { AssistantAction, FavoriteLedger } from '@shared/types'

export function buildDanmakuFieldFocusScript(): string {
  return `
    (() => {
      const __bilimiDanmakuFieldFocus = true;
      void __bilimiDanmakuFieldFocus;
      const result = {
        ok: false,
        steps: [],
        missingTargets: [],
        message: '',
        sendButtonPoint: null
      };
      const isLikelyHidden = (node) => {
        const style = window.getComputedStyle?.(node);
        return style?.display === 'none' || style?.visibility === 'hidden';
      };
      const isVisibleInput = (node) => {
        if (!node || isLikelyHidden(node)) {
          return false;
        }

        const rect = node.getBoundingClientRect?.();
        return !rect || rect.width > 0 || rect.height > 0;
      };
      const normalized = (value) => String(value || '').replace(/\\s+/g, '').toLowerCase();
      const visibleCenter = (node) => {
        const rect = node?.getBoundingClientRect?.();
        if (!rect || rect.width <= 0 || rect.height <= 0) {
          return null;
        }

        return {
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2)
        };
      };
      const stateText = (node) =>
        normalized(
          [
            node?.getAttribute?.('aria-label'),
            node?.getAttribute?.('title'),
            node?.getAttribute?.('class'),
            node?.getAttribute?.('data-screen'),
            node?.getAttribute?.('data-mode'),
            node?.getAttribute?.('data-state'),
            node?.textContent
          ].join(' ')
        );
      const isExpandExitControl = (node) => {
        if (node?.getAttribute?.('aria-pressed') === 'true' || node?.getAttribute?.('aria-checked') === 'true') {
          return true;
        }

        const text = stateText(node);
        return (
          text.includes('退出宽屏') ||
          text.includes('退出网页全屏') ||
          text.includes('退出放大') ||
          text.includes('缩小') ||
          /(^|[-_\\s])(active|entered|on|selected)([-_\\s]|$)/.test(text)
        );
      };
      const isExpandedPlayerRoot = (node) => {
        const text = stateText(node);
        return /(^|[-_\\s])(wide|widescreen|webscreen|theater|expanded)([-_\\s]|$)/.test(text);
      };
      const queryPlayerExpandButton = () => {
        const selectors = [
          '.bpx-player-ctrl-wide',
          '.bpx-player-ctrl-web',
          '.bilibili-player-video-btn-widescreen',
          '.bilibili-player-video-btn-web-fullscreen',
          '[aria-label*="宽屏"]',
          '[title*="宽屏"]',
          '[aria-label*="网页全屏"]',
          '[title*="网页全屏"]',
          '[aria-label*="放大"]',
          '[title*="放大"]'
        ].join(',');

        return Array.from(document.querySelectorAll(selectors)).find(isVisibleInput) || null;
      };
      const ensurePlayerExpanded = () => {
        const expandButton = queryPlayerExpandButton();
        const playerRoots = [
          document.body,
          document.documentElement,
          ...Array.from(
            document.querySelectorAll(
              '.bpx-player-container,.bpx-player,.bilibili-player,#bilibili-player,[class*="player"]'
            )
          )
        ];

        if (playerRoots.some(isExpandedPlayerRoot) || (expandButton && isExpandExitControl(expandButton))) {
          result.steps.push('danmaku:player:expanded');
          return;
        }

        if (expandButton) {
          expandButton.click?.();
          result.steps.push('danmaku:player:expand');
        }
      };
      const selectors = [
        '.bpx-player-dm-input',
        '.bilibili-player-video-danmaku-input',
        '[class*="dm-input"]',
        '[class*="danmaku"][class*="input"]',
        '.bpx-player-sending-area input[type="text"]',
        '.bpx-player-sending-area textarea',
        '.bpx-player-sending-area [contenteditable="true"]'
      ].join(',');
      const field = Array.from(document.querySelectorAll(selectors)).find(isVisibleInput);

      if (!field) {
        result.missingTargets.push('danmaku-focus');
        result.message = '尚有 danmaku-focus 未能寻见。';
        return result;
      }

      ensurePlayerExpanded();

      const sendingArea =
        field.closest?.('.bpx-player-sending-area,.bilibili-player-video-sendbar') ||
        field.parentElement?.closest?.('[class*="danmaku"],[class*="bpx-player"]') ||
        field.parentElement ||
        document;
      const switchSelectors = [
        '.bpx-player-dm-switch',
        '.bpx-player-dm-switch-btn',
        '.bilibili-player-video-danmaku-switch',
        '[class*="dm-switch"]',
        '[class*="danmaku"][class*="switch"]',
        '[aria-label*="弹幕"]',
        '[title*="弹幕"]'
      ].join(',');
      const switchButton = Array.from(sendingArea.querySelectorAll?.(switchSelectors) || [])
        .filter((node) => node !== field)
        .find(isVisibleInput);
      const switchStateText = (node) =>
        String(
          [
            node?.getAttribute?.('aria-label'),
            node?.getAttribute?.('title'),
            node?.getAttribute?.('class'),
            node?.textContent
          ].join(' ')
        ).toLowerCase();
      const isClearlyOff = (node) => {
        if (node?.getAttribute?.('aria-checked') === 'false') {
          return true;
        }

        if (node?.getAttribute?.('aria-pressed') === 'false') {
          return true;
        }

        const text = switchStateText(node);
        if (!text) {
          return false;
        }

        if (text.includes('开启弹幕') || text.includes('打开弹幕')) {
          return true;
        }

        return /(^|[-_\\s])(off|close|closed|disabled|disable)([-_\\s]|$)/.test(text);
      };

      if (switchButton && isClearlyOff(switchButton)) {
        switchButton.click?.();
        result.steps.push('danmaku:switch:on');
      } else {
        result.steps.push('danmaku:switch:ready');
      }

      field.click?.();
      field.focus?.();
      result.steps.push('danmaku:focus');

      const sendSelectors = [
        '.bpx-player-dm-btn',
        '.bilibili-player-video-danmaku-send',
        '.bilibili-player-video-btn-send',
        '[class*="dm-btn"]',
        '[class*="danmaku"][class*="send"]',
        'button'
      ].join(',');
      const sendButton = Array.from(sendingArea.querySelectorAll?.(sendSelectors) || [])
        .filter((node) => node !== field && node !== switchButton)
        .find((node) => isVisibleInput(node) && visibleCenter(node));
      result.sendButtonPoint = visibleCenter(sendButton);
      result.ok = true;
      result.message = '弹幕栏已聚焦。';
      return result;
    })()
  `
}

export function buildDanmakuSubmitConfirmationScript(commentDraft = ''): string {
  const payload = JSON.stringify({ commentDraft })

  return `
    (async () => {
      const __bilimiDanmakuSubmitConfirmation = true;
      void __bilimiDanmakuSubmitConfirmation;
      const payload = ${payload};
      const wait = (delay) => new Promise((resolve) => setTimeout(resolve, delay));
      const normalize = (value) => (value || '').replace(/\\s+/g, '').trim();
      const readEditableText = (element) => {
        if (!element) {
          return '';
        }

        if ('value' in element) {
          return element.value || '';
        }

        return element.textContent || element.innerText || '';
      };
      const isLikelyHidden = (node) => {
        const style = window.getComputedStyle?.(node);
        return style?.display === 'none' || style?.visibility === 'hidden';
      };
      const isVisibleInput = (node) => {
        if (!node || isLikelyHidden(node)) {
          return false;
        }

        const rect = node.getBoundingClientRect?.();
        return !rect || rect.width > 0 || rect.height > 0;
      };
      const queryDanmakuField = () => {
        const selectors = [
          '.bpx-player-dm-input',
          '.bilibili-player-video-danmaku-input',
          '[class*="dm-input"]',
          '[class*="danmaku"][class*="input"]',
          '.bpx-player-sending-area input[type="text"]',
          '.bpx-player-sending-area textarea',
          '.bpx-player-sending-area [contenteditable="true"]'
        ].join(',');

        return Array.from(document.querySelectorAll(selectors)).find(isVisibleInput) || null;
      };
      const draftStillPresent = () => {
        const field = queryDanmakuField();
        return Boolean(field && normalize(readEditableText(field)).includes(normalize(payload.commentDraft)));
      };

      for (let index = 0; index < 12; index += 1) {
        if (!draftStillPresent()) {
          return {
            ok: true,
            steps: ['danmaku:submit'],
            missingTargets: [],
            message: '弹幕已发送。'
          };
        }

        await wait(100);
      }

      return {
        ok: false,
        steps: [],
        missingTargets: ['danmaku-submit-confirm'],
        message: '尚有 danmaku-submit-confirm 未能寻见。'
      };
    })()
  `
}

export function buildAutomationScript(
  action: AssistantAction,
  favoritesFolderName: string,
  coinCount?: 1 | 2,
  commentDraft?: string,
  favoriteLedgers: FavoriteLedger[] = [],
  targetLedgerId = '',
  options: { submitComment?: boolean } = {}
): string {
  const payload = JSON.stringify({
    action,
    favoritesFolderName,
    coinCount,
    commentDraft,
    favoriteLedgers,
    targetLedgerId,
    submitComment: options.submitComment ?? true
  })

  return `
    (async () => {
      const payload = ${payload};
      const steps = [];
      const missingTargets = [];

      const wait = (delay) => new Promise((resolve) => setTimeout(resolve, delay));

      const click = (element, stepName) => {
        if (!element) {
          return false;
        }

        element.click();
        steps.push(stepName);
        return true;
      };

      const typeText = (element, value) => {
        if (!element) {
          return false;
        }

        element.scrollIntoView?.({ block: 'center' });
        element.click?.();
        element.focus?.();

        if ('value' in element) {
          const prototype = Object.getPrototypeOf(element);
          const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
          element.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, data: value, inputType: 'insertText' }));
          valueSetter ? valueSetter.call(element, value) : (element.value = value);
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          const selection = window.getSelection?.();
          if (selection && document.createRange) {
            const range = document.createRange();
            range.selectNodeContents(element);
            range.collapse(false);
            selection.removeAllRanges();
            selection.addRange(range);
          }

          const inserted = document.execCommand?.('insertText', false, value);
          if (!inserted) {
            element.textContent = value;
            element.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
          }
          element.dispatchEvent(new Event('change', { bubbles: true }));
        }

        return true;
      };

      const normalize = (value) => (value || '').replace(/\\s+/g, '').trim();
      const textMatchers = (candidates) => (value) =>
        candidates.some((candidate) => normalize(value).includes(normalize(candidate)));
      const selectorList = (selectors) =>
        selectors
          .split(',')
          .map((selector) => selector.trim())
          .filter(Boolean);
      const isLikelyHidden = (node) => {
        const style = window.getComputedStyle?.(node);
        return style?.display === 'none' || style?.visibility === 'hidden';
      };
      const isVisibleInput = (node) => {
        if (!node || isLikelyHidden(node)) {
          return false;
        }

        if (node.disabled || node.readOnly) {
          return false;
        }

        const rect = node.getBoundingClientRect?.();
        const hasSearchText = Boolean(
          normalize(
            [
              node.getAttribute?.('aria-label'),
              node.getAttribute?.('placeholder'),
              node.getAttribute?.('class'),
              node.textContent
            ].filter(Boolean).join(' ')
          )
        );
        return !rect || rect.width > 0 || rect.height > 0 || hasSearchText;
      };
      const closestClickable = (node) =>
        node?.closest?.('button,[role="button"],a,[tabindex],.video-toolbar-left-item,.video-like,.video-coin,.video-fav,.toolbar-left-item,.toolbar-right-item,.ops span') || node;

      const byText = (selectors, candidates) => {
        const matcher = textMatchers(candidates);
        const nodes = Array.from(document.querySelectorAll(selectors));
        return nodes.find((node) => {
          if (isLikelyHidden(node)) {
            return false;
          }

          const text = [
            node.getAttribute?.('aria-label'),
            node.getAttribute?.('class'),
            node.getAttribute?.('data-title'),
            node.getAttribute?.('data-action'),
            node.getAttribute?.('data-type'),
            node.textContent,
            node.getAttribute?.('title')
          ].filter(Boolean).join(' ');
          return matcher(text);
        });
      };

      const isVisibleCandidate = (node) => {
        if (!node || isLikelyHidden(node)) {
          return false;
        }

        const rect = node.getBoundingClientRect?.();
        return !rect || rect.width > 0 || rect.height > 0 || Boolean(normalize(nodeSearchText(node)));
      };

      const bySelector = (selectors) => {
        const nodes = Array.from(document.querySelectorAll(selectors));
        return nodes.find((node) => !isLikelyHidden(node));
      };

      const bySelectorThenText = (selectors, candidates) => {
        const directSelector = selectorList(selectors).find((selector) => {
          if (!/[.#\\[]/.test(selector)) {
            return false;
          }

          return selectorList('button,[role="button"],a,[tabindex]').every(
            (genericSelector) => selector !== genericSelector
          );
        });
        const directMatch = directSelector ? bySelector(directSelector) : null;

        return closestClickable(directMatch || byText(selectors, candidates));
      };

      const waitForElement = async (queryElement, missingName, attempts = 20) => {
        for (let index = 0; index < attempts; index += 1) {
          const element = queryElement();

          if (element) {
            return element;
          }

          await wait(100);
        }

        missingTargets.push(missingName);
        return null;
      };

      const queryLikeButton = () =>
        bySelectorThenText(
          'button,[role="button"],.video-like,.like,.like-btn,[class*="like"],[class*="Like"],.toolbar-left button,.video-toolbar-left .toolbar-left-item,.video-toolbar-left-item,.ops span',
          ['点赞', '赞', 'like']
        );

      const queryFavoriteButton = () =>
        bySelectorThenText(
          'button,[role="button"],.video-fav,.fav,.favorite,.collect,[class*="fav"],[class*="Fav"],[class*="collect"],.toolbar-right button,.video-toolbar-left .toolbar-left-item,.video-toolbar-left-item',
          ['收藏', '加入收藏', 'favorite', 'fav', 'collect']
        );

      const queryCoinButton = () =>
        bySelectorThenText(
          'button,[role="button"],.video-coin,.coin,[class*="coin"],[class*="Coin"],.toolbar-right button,.video-toolbar-left .toolbar-left-item,.video-toolbar-left-item',
          ['投币', 'coin']
        );

      const coinDialogSelectors = [
        '.coin-dialog',
        '.coin-panel',
        '.coin-modal',
        '.coin-box',
        '.coin-popup',
        '.bili-dialog-bomb',
        '[role="dialog"]',
        '[class*="coin"][class*="dialog"]',
        '[class*="coin"][class*="panel"]',
        '[class*="coin"][class*="modal"]',
        '[class*="coin"][class*="box"]',
        '[class*="coin"][class*="popup"]',
        '[class*="Coin"][class*="Dialog"]',
        '[class*="Coin"][class*="Panel"]',
        '[class*="Coin"][class*="Modal"]'
      ].join(',');

      const queryCoinDialog = () => {
        const candidates = Array.from(document.querySelectorAll(coinDialogSelectors))
          .filter((node) => isVisibleCandidate(node));
        const coinMatcher = textMatchers(['投币', '硬币', 'coin']);
        return candidates.find((node) => coinMatcher(nodeSearchText(node))) || null;
      };

      const byTextWithin = (root, selectors, candidates) => {
        if (!root) {
          return null;
        }

        const matcher = textMatchers(candidates);
        const nodes = Array.from(root.querySelectorAll?.(selectors) || []);
        return nodes.find((node) => {
          if (isLikelyHidden(node)) {
            return false;
          }

          return matcher(nodeSearchText(node));
        });
      };

      const queryCoinOption = (coinDialog, desiredCoinCount) =>
        byTextWithin(
          coinDialog,
          'button,[role="button"],label,.coin-item,.coin-option,.mc-box,.coin-box,[class*="coin"][class*="item"],[class*="coin"][class*="option"],[class*="coin"][class*="box"],[class*="mc-box"]',
          [
            '投' + desiredCoinCount + '币',
            '投 ' + desiredCoinCount + ' 币',
            desiredCoinCount + '硬币',
            desiredCoinCount + ' 硬币',
            desiredCoinCount + '币',
            desiredCoinCount + ' 币'
          ]
        );

      const queryCoinConfirm = (coinDialog) =>
        byTextWithin(
          coinDialog,
          'button,[role="button"],.coin-submit,.submit,.bi-btn,.bili-btn,[class*="coin"][class*="submit"],[class*="confirm"],[class*="submit"],[class*="btn"],[class*="Btn"]',
          ['确定', '确认', '投币']
        );

      const commentSubmitSelectors = [
        'button',
        '[role="button"]',
        '[type="submit"]',
        '.comment-submit',
        '.comment-send',
        '.reply-send',
        '.send-btn',
        '.submit',
        '[class*="comment"][class*="submit"]',
        '[class*="comment"][class*="send"]',
        '[class*="reply"][class*="submit"]',
        '[class*="reply"][class*="send"]',
        '[class*="submit"]',
        '[class*="send"]'
      ].join(',');

      const queryFavoriteFolder = () =>
        byText(
          'button,[role="button"],label,.fav-item,.favorite-item,.group-item,.fav-video-list-item,.fav-list-item,.favorite-list-item,.folder-item,[class*="fav"][class*="item"],[class*="favorite"][class*="item"],[class*="folder"][class*="item"]',
          [payload.favoritesFolderName]
        );

      const favoriteFolderNodes = () =>
        Array.from(
          document.querySelectorAll(
            'button,[role="button"],label,.fav-item,.favorite-item,.group-item,.fav-video-list-item,.fav-list-item,.favorite-list-item,.folder-item,[class*="fav"][class*="item"],[class*="favorite"][class*="item"],[class*="folder"][class*="item"]'
          )
        );

      const nodeSearchText = (node) =>
        [
          node.getAttribute?.('aria-label'),
          node.getAttribute?.('title'),
          node.getAttribute?.('class'),
          node.textContent
        ].filter(Boolean).join(' ');

      const isFavoriteAlreadyActive = (node) => {
        if (!node) {
          return false;
        }

        const searchText = normalize(nodeSearchText(node)).toLowerCase();
        const classTokens = String(node.getAttribute?.('class') || '')
          .split(/\\s+/)
          .map((className) => className.toLowerCase())
          .filter(Boolean);
        const activeClassTokens = [
          'active',
          'on',
          'selected',
          'is-active',
          'is-selected',
          'is-fav',
          'is-favorite',
          'favorited',
          'collected'
        ];
        const stateAttributes = [
          node.getAttribute?.('aria-pressed'),
          node.getAttribute?.('aria-checked'),
          node.getAttribute?.('data-selected'),
          node.getAttribute?.('data-active'),
          node.getAttribute?.('data-fav'),
          node.getAttribute?.('data-favorite')
        ].filter(Boolean).map((value) => String(value).toLowerCase());

        return (
          normalize(searchText).includes(normalize('已收藏')) ||
          normalize(searchText).includes(normalize('取消收藏')) ||
          activeClassTokens.some((className) => classTokens.includes(className)) ||
          stateAttributes.some((value) => value === 'true' || value === '1')
        );
      };

      const isLikeAlreadyActive = (node) => {
        if (!node) {
          return false;
        }

        const searchText = normalize(nodeSearchText(node)).toLowerCase();
        const classTokens = String(node.getAttribute?.('class') || '')
          .split(/\\s+/)
          .map((className) => className.toLowerCase())
          .filter(Boolean);
        const activeClassTokens = [
          'active',
          'on',
          'selected',
          'is-active',
          'is-selected',
          'liked',
          'is-like',
          'is-liked'
        ];
        const stateAttributes = [
          node.getAttribute?.('aria-pressed'),
          node.getAttribute?.('aria-checked'),
          node.getAttribute?.('data-selected'),
          node.getAttribute?.('data-active'),
          node.getAttribute?.('data-like'),
          node.getAttribute?.('data-liked')
        ].filter(Boolean).map((value) => String(value).toLowerCase());

        return (
          normalize(searchText).includes(normalize('已点赞')) ||
          normalize(searchText).includes(normalize('取消点赞')) ||
          activeClassTokens.some((className) => classTokens.includes(className)) ||
          stateAttributes.some((value) => value === 'true' || value === '1')
        );
      };

      const nodeOwnSearchText = (node) =>
        [
          node.getAttribute?.('aria-label'),
          node.getAttribute?.('title'),
          node.getAttribute?.('class'),
          ...Array.from(node.childNodes || [])
            .filter((child) => child.nodeType === Node.TEXT_NODE)
            .map((child) => child.textContent)
        ].filter(Boolean).join(' ');

      const targetLedger = () =>
        payload.favoriteLedgers.find((ledger) => ledger.id === payload.targetLedgerId);

      const targetFavoriteFolderName = () => targetLedger()?.displayName || '';

      const matchingFavoriteKeywords = () => {
        const targetName = targetFavoriteFolderName();
        return [targetName, ...(targetLedger()?.keywords || []), payload.targetLedgerId].filter(Boolean);
      };

      const queryMatchingFavoriteFolder = () => {
        const matcher = textMatchers(matchingFavoriteKeywords());
        return favoriteFolderNodes().find((node) => {
          const text = nodeSearchText(node);
          return matcher(text) && normalize(text).includes(normalize('Bilimi'));
        });
      };

      const queryAnyBilimiFavoriteFolder = () =>
        favoriteFolderNodes().find((node) => normalize(nodeSearchText(node)).includes(normalize('Bilimi')));

      const queryCreateFavoriteButton = () => {
        const nodes = Array.from(
          document.querySelectorAll(
            'button,[role="button"],.fav-create,.favorite-create,.fav-add-folder,.fav-create-folder,.create,.new-folder,.add-folder,div[role="button"],span[role="button"],[class*="fav-add"],[class*="favorite-create"],[class*="create-folder"],[class*="add-folder"],[class*="new-folder"],div,span,li'
          )
        );

        const matchesCreateEntry = (text) => {
          const normalizedText = normalize(text).toLowerCase();

          if (normalizedText.includes('confirm') || normalizedText.includes('submit') || normalize(text).includes(normalize('确定')) || normalize(text).includes(normalize('确认'))) {
            return false;
          }

          return (
            normalize(text).includes(normalize('新建收藏夹')) ||
            normalize(text).includes(normalize('创建收藏夹')) ||
            normalize(text).includes(normalize('+新建收藏夹')) ||
            normalizedText.includes('newfolder') ||
            normalizedText.includes('addfolder') ||
            normalizedText.includes('createfolder') ||
            normalizedText.includes('favadd') ||
            normalizedText.includes('favoritecreate')
          );
        };

        const scoredMatches = nodes
          .map((node) => {
            if (!isVisibleCandidate(node)) {
              return null;
            }

            const ownText = nodeOwnSearchText(node);
            const fullText = nodeSearchText(node);
            const ownMatch = matchesCreateEntry(ownText);
            const fullMatch = matchesCreateEntry(fullText);

            if (!ownMatch && !fullMatch) {
              return null;
            }

            const hasMatchingChild = Array.from(node.children || []).some((child) =>
              matchesCreateEntry(nodeSearchText(child))
            );

            if (!ownMatch && hasMatchingChild) {
              return null;
            }

            const clickable = node.matches?.('button,[role="button"],[tabindex],a') || node.onclick;
            const score = (ownMatch ? 100 : 0) + (clickable ? 20 : 0) - normalize(fullText).length / 100;
            return { node, score };
          })
          .filter(Boolean)
          .sort((left, right) => right.score - left.score);

        return scoredMatches[0]?.node || null;
      };

      const scrollFavoriteDialogToBottom = () => {
        const modalCandidates = Array.from(
          document.querySelectorAll(
            '.bili-dialog-bomb,.fav-dialog,.favorite-dialog,[role="dialog"],[class*="dialog"],[class*="modal"]'
          )
        );
        const favoriteModal = modalCandidates.find((node) =>
          normalize(nodeSearchText(node)).includes(normalize('添加到收藏夹')) ||
          normalize(nodeSearchText(node)).includes(normalize('收藏夹')) ||
          normalize(nodeSearchText(node)).includes(normalize('新建收藏夹'))
        );
        const searchRoot = favoriteModal || document.body;
        const preferredContainers = Array.from(
          searchRoot.querySelectorAll?.(
            '.fav-list,.favorite-list,.fav-container,.favorite-container,[class*="fav"][class*="list"],[class*="favorite"][class*="list"]'
          ) || []
        );
        const scrollableContainers = Array.from(searchRoot.querySelectorAll?.('*') || []).filter((node) => {
          if (!('scrollTop' in node)) {
            return false;
          }

          return (node.scrollHeight || 0) > (node.clientHeight || 0);
        });
        const containers = [...new Set([...preferredContainers, ...scrollableContainers, searchRoot])];

        containers.forEach((container) => {
          if (!('scrollTop' in container)) {
            return;
          }

          const scrollDistance = Math.max(container.scrollHeight || 0, container.clientHeight || 0);
          container.scrollTop = scrollDistance;
          container.dispatchEvent(new Event('scroll', { bubbles: true }));
          container.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: scrollDistance || 800 }));
        });
      };

      const queryCreateFavoriteButtonAfterScroll = () => {
        const createButton = queryCreateFavoriteButton();

        if (createButton) {
          return createButton;
        }

        scrollFavoriteDialogToBottom();
        return queryCreateFavoriteButton();
      };

      const waitForCreateFavoriteButton = async () => {
        for (let index = 0; index < 12; index += 1) {
          const createButton = queryCreateFavoriteButtonAfterScroll();

          if (createButton) {
            return createButton;
          }

          await wait(120);
        }

        missingTargets.push('favorite-create-button');
        return null;
      };

      const queryFavoriteNameField = () =>
        document.querySelector('.fav-name-input,.favorite-name-input,.folder-name-input,[class*="name-input"],[class*="NameInput"]') ||
        document.querySelector('input[placeholder*="收藏"]') ||
        document.querySelector('input[placeholder*="名称"]') ||
        document.querySelector('input[type="text"]') ||
        document.querySelector('input:not([type]),input') ||
        document.querySelector('[contenteditable="true"]');

      const queryCreateFavoriteConfirm = () =>
        byText('.fav-create-confirm,.create-confirm,.create-submit,[class*="create-confirm"],[class*="create-submit"]', ['新建', '创建', '确定', '确认']) ||
        byText('[class*="confirm"],[class*="submit"]', ['创建', '确定', '确认']);

      const createFavoriteFolder = async (folderName) => {
        const createButton = await waitForCreateFavoriteButton();
        if (!createButton) {
          return false;
        }

        let nameField = queryFavoriteNameField();

        if (!nameField) {
          click(closestClickable(createButton), 'favorite:create-open');
          nameField = await waitForElement(queryFavoriteNameField, 'favorite-name-field', 10);
        } else {
          steps.push('favorite:create-open');
        }

        if (!typeText(nameField, folderName)) {
          return false;
        }

        steps.push('favorite:create-name:' + folderName);
        click(await waitForElement(queryCreateFavoriteConfirm, 'favorite-create-confirm', 5), 'favorite:create-confirm');
        await wait(80);
        return true;
      };

      const ensureFavoriteFolder = async () => {
        const existingMatch = queryMatchingFavoriteFolder();
        if (existingMatch) {
          return existingMatch;
        }

        const bilimiFolder = queryAnyBilimiFavoriteFolder();
        const legacyFolder = queryFavoriteFolder();
        const canCreateFolder = Boolean(queryCreateFavoriteButtonAfterScroll());

        if (!canCreateFolder) {
          return await waitForElement(
            () => queryMatchingFavoriteFolder() || queryFavoriteFolder() || queryAnyBilimiFavoriteFolder(),
            'favorites-folder'
          );
        }

        if (!bilimiFolder) {
          let createdAll = true;
          const enabledLedgers = payload.favoriteLedgers.filter((ledger) => ledger.enabled);
          for (const ledger of enabledLedgers) {
            createdAll = (await createFavoriteFolder(ledger.displayName)) && createdAll;
          }

          if (createdAll) {
            steps.push('favorite:create-defaults');
          }
        } else {
          await createFavoriteFolder(targetFavoriteFolderName());
          steps.push('favorite:create-category');
        }

        return (await waitForElement(queryMatchingFavoriteFolder, 'favorites-folder')) || legacyFolder || bilimiFolder;
      };

      const queryFavoriteConfirm = () =>
        byText('button,[role="button"],.fav-submit,.submit', ['完成', '确定', '确认', '保存']);

      const queryDanmakuField = () => {
        const selectors = [
          '.bpx-player-dm-input',
          '.bilibili-player-video-danmaku-input',
          '[class*="dm-input"]',
          '[class*="danmaku"][class*="input"]',
          '.bpx-player-sending-area input[type="text"]',
          '.bpx-player-sending-area textarea',
          '.bpx-player-sending-area [contenteditable="true"]'
        ].join(',');
        const nodes = Array.from(document.querySelectorAll(selectors));

        return nodes.find((node) => {
          if (!isVisibleInput(node)) {
            return false;
          }

          const text = [
            node.getAttribute?.('aria-label'),
            node.getAttribute?.('placeholder'),
            node.getAttribute?.('class'),
            node.closest?.('.bpx-player-sending-area,[class*="danmaku"],[class*="bpx-player"]')?.getAttribute?.('class')
          ].filter(Boolean).join(' ');
          const normalizedText = normalize(text).toLowerCase();

          return (
            normalizedText.includes(normalize('弹幕')) ||
            normalizedText.includes('danmaku') ||
            normalizedText.includes('dm-input') ||
            normalizedText.includes('bpx-player')
          );
        }) || null;
      };

      const queryDanmakuSubmitButton = (field = queryDanmakuField()) => {
        const root =
          field?.closest?.('.bpx-player-sending-area,.bilibili-player-video-sendbar') ||
          field?.parentElement?.closest?.('.bpx-player-sending-area,.bilibili-player-video-sendbar,[class*="danmaku"],[class*="bpx-player"]') ||
          document.body;
        const directSelectors = [
          '.bpx-player-dm-btn',
          '.bilibili-player-video-danmaku-send',
          '.bilibili-player-video-btn-send',
          '[class*="dm"][class*="btn"]',
          '[class*="danmaku"][class*="send"]'
        ].join(',');
        const selectors = [
          '[class*="send"]',
          'button',
          '[role="button"]'
        ].join(',');
        const directMatch = Array.from(root.querySelectorAll?.(directSelectors) || []).find(isVisibleCandidate);

        return closestClickable(directMatch || byTextWithin(root, selectors, ['发送', 'send']));
      };

      const commentRootContainerSelectors =
        '#comment,#commentapp,.comment-container,.comment-box,.reply-box,.bb-comment,.bili-comment,form,section,div';

      const isLikelyCommentText = (text) => {
        const normalizedText = normalize(text).toLowerCase();
        const looksLikeComment =
          normalizedText.includes(normalize('评论')) ||
          normalizedText.includes(normalize('回复')) ||
          normalizedText.includes('comment') ||
          normalizedText.includes('reply');
        const looksLikeDanmaku =
          normalizedText.includes(normalize('弹幕')) ||
          normalizedText.includes('danmaku') ||
          normalizedText.includes('dm-input') ||
          normalizedText.includes('bpx-player');

        return looksLikeComment && !looksLikeDanmaku;
      };

      const isVisibleVideoActionBar = () => {
        const selectors = [
          '.video-toolbar',
          '.video-toolbar-left',
          '.toolbar-left',
          '.video-actions',
          '.ops',
          '[class*="toolbar"][class*="left"]',
          '[class*="video"][class*="toolbar"]'
        ].join(',');
        const candidates = Array.from(document.querySelectorAll(selectors));

        return candidates.some((node) => {
          if (!isVisibleCandidate(node)) {
            return false;
          }

          const rect = node.getBoundingClientRect?.();
          const viewportHeight = window.innerHeight || 800;
          const viewportWidth = window.innerWidth || 1200;
          if (rect) {
            const sitsInMainColumn = rect.left < viewportWidth * 0.72;
            const sitsNearUpperScreen = rect.bottom >= 0 && rect.top <= viewportHeight * 0.45;
            if (!sitsInMainColumn || !sitsNearUpperScreen) {
              return false;
            }
          }

          const actionNodes = Array.from(
            node.querySelectorAll?.(
              '.video-like,.like,.video-coin,.coin,.video-fav,.fav,.favorite,.collect,.video-share,.share,[class*="like"],[class*="coin"],[class*="fav"],[class*="collect"],[class*="share"],button,[role="button"]'
            ) || []
          );
          const actionText = normalize([nodeSearchText(node), ...actionNodes.map(nodeSearchText)].join(' ')).toLowerCase();
          const actionHits = [
            actionText.includes(normalize('点赞')) || actionText.includes('like'),
            actionText.includes(normalize('投币')) || actionText.includes('coin'),
            actionText.includes(normalize('收藏')) || actionText.includes('favorite') || actionText.includes('fav') || actionText.includes('collect'),
            actionText.includes(normalize('分享')) || actionText.includes('share')
          ].filter(Boolean).length;

          return actionHits >= 2;
        });
      };

      const queryCommentRoot = () => {
        const selectors = [
          '#comment',
          '#commentapp',
          '.comment-container',
          '.comment-box',
          '.reply-box',
          '.bb-comment',
          '.bili-comment',
          '[class*="comment"]',
          '[class*="reply"]'
        ];

        for (const selector of selectors) {
          const root = Array.from(document.querySelectorAll(selector)).find((node) => {
            if (!isVisibleCandidate(node)) {
              return false;
            }

            const text = nodeSearchText(node);
            return (
              normalize(text).includes(normalize('评论')) ||
              normalize(text).includes(normalize('发布')) ||
              normalize(text).includes(normalize('回复')) ||
              Boolean(node.querySelector?.('.reply-box,.reply-box-textarea,.comment-box-textarea,textarea,[contenteditable="true"]'))
            );
          });

          if (root) {
            return root;
          }
        }

        const standaloneField = Array.from(
          document.querySelectorAll('textarea,[contenteditable="true"],input[type="text"]')
        ).find((node) => {
          if (!isVisibleInput(node)) {
            return false;
          }

          const text = [
            node.getAttribute?.('aria-label'),
            node.getAttribute?.('placeholder'),
            node.getAttribute?.('data-placeholder'),
            node.getAttribute?.('class'),
            node.textContent
          ].filter(Boolean).join(' ');

          return isLikelyCommentText(text);
        });

        if (standaloneField) {
          return standaloneField.closest?.(commentRootContainerSelectors) || standaloneField.parentElement || document.body;
        }

        const standaloneActivator = Array.from(document.querySelectorAll('div,section,form')).find((node) => {
          if (!isVisibleCandidate(node)) {
            return false;
          }

          if (node.querySelector?.('textarea,[contenteditable="true"],input[type="text"]')) {
            return false;
          }

          const ownText = [
            node.getAttribute?.('aria-label'),
            node.getAttribute?.('title'),
            node.getAttribute?.('data-placeholder'),
            node.getAttribute?.('placeholder'),
            node.getAttribute?.('class'),
            node.textContent
          ].filter(Boolean).join(' ');

          return isLikelyCommentText(ownText);
        });

        if (standaloneActivator) {
          return standaloneActivator.closest?.(commentRootContainerSelectors) || standaloneActivator;
        }

        return null;
      };

      const queryCommentField = (root = queryCommentRoot()) => {
        if (!root) {
          return null;
        }

        const selectors = [
          '.reply-box-textarea[contenteditable="true"]',
          '.reply-box textarea',
          '.reply-box [contenteditable="true"]',
          '.comment-box-textarea[contenteditable="true"]',
          '.comment-box textarea',
          '.comment-box [contenteditable="true"]',
          '[class*="reply"] textarea',
          '[class*="reply"] [contenteditable="true"]',
          '[class*="comment"] textarea',
          '[class*="comment"] [contenteditable="true"]',
          '[data-placeholder][contenteditable="true"]',
          'textarea',
          '[contenteditable="true"]',
          'input[type="text"]'
        ];

        for (const selector of selectors) {
          const field = Array.from(root.querySelectorAll?.(selector) || []).find(isVisibleInput);
          if (field) {
            return field;
          }
        }

        return null;
      };

      const querySubmitButton = (root = queryCommentRoot()) =>
        closestClickable(byTextWithin(root, commentSubmitSelectors, ['发布', '提交', '发送']));

      const queryCommentActivator = (root = queryCommentRoot()) => {
        if (!root) {
          return null;
        }

        const selectors = [
          '.reply-box',
          '.comment-box',
          '.reply-box-placeholder',
          '.comment-box-placeholder',
          '[class*="input"][class*="placeholder"]',
          '[class*="placeholder"]',
          '[class*="input"][class*="shell"]',
          '[class*="reply"][class*="box"]',
          '[class*="comment"][class*="box"]'
        ].join(',');
        const nodes = Array.from(root.querySelectorAll?.(selectors) || []);
        return nodes.find((node) => isVisibleCandidate(node) && isLikelyCommentText(nodeSearchText(node))) || null;
      };

      const activateCommentBox = async (commentRoot) => {
        const activator = queryCommentActivator(commentRoot);
        if (!activator) {
          return false;
        }

        click(closestClickable(activator), 'comment:activate');
        await wait(120);
        return true;
      };

      const isReadyCommentRoot = (commentRoot) =>
        Boolean(commentRoot && (queryCommentField(commentRoot) || queryCommentActivator(commentRoot)));

      const scrollPageTowardComments = async () => {
        const actionBarVisible = isVisibleVideoActionBar();
        const delta = actionBarVisible ? 180 : Math.max(window.innerHeight || 800, 800);
        const scrollTargets = [document.scrollingElement, document.documentElement, document.body]
          .filter(Boolean)
          .filter((target, index, targets) => targets.indexOf(target) === index);

        scrollTargets.forEach((target) => {
          if (target && 'scrollTop' in target) {
            target.scrollTop += delta;
          }
          target?.dispatchEvent?.(new Event('scroll', { bubbles: true }));
        });
        if (!String(navigator.userAgent || '').toLowerCase().includes('jsdom')) {
          try {
            window.scrollBy?.(0, delta);
          } catch {
            // Some embedded pages expose scrollBy but disallow programmatic window scrolling.
          }
        }
        window.dispatchEvent?.(new Event('scroll'));
        window.dispatchEvent?.(new WheelEvent('wheel', { bubbles: true, deltaY: delta }));
        if (actionBarVisible) {
          steps.push('comment:action-bar-visible');
          steps.push('comment:nearby-scroll');
        } else {
          steps.push('comment:page-scroll');
        }
        steps.push('comment:reveal');
        await wait(250);
      };

      const revealCommentRoot = async (commentRoot) => {
        if (isReadyCommentRoot(commentRoot)) {
          commentRoot.scrollIntoView?.({ block: 'center' });
          commentRoot.dispatchEvent?.(new Event('scroll', { bubbles: true }));
        } else {
          commentRoot?.scrollIntoView?.({ block: 'center' });
          commentRoot?.dispatchEvent?.(new Event('scroll', { bubbles: true }));
          await scrollPageTowardComments();
          return;
        }

        window.dispatchEvent?.(new Event('scroll'));
        window.dispatchEvent?.(new WheelEvent('wheel', { bubbles: true, deltaY: 800 }));
        steps.push('comment:reveal');
        await wait(120);
      };

      const waitForCommentRoot = async () => {
        let commentRoot = queryCommentRoot();
        if (isReadyCommentRoot(commentRoot)) {
          steps.push('comment:root');
          return commentRoot;
        }

        steps.push(commentRoot ? 'comment:wait-ready' : 'comment:wait-root');
        let loggedWeakRoot = false;
        for (let index = 0; index < 20; index += 1) {
          if (commentRoot && !loggedWeakRoot) {
            steps.push('comment:weak-root');
            loggedWeakRoot = true;
          }
          await revealCommentRoot(commentRoot);
          commentRoot = queryCommentRoot();
          if (isReadyCommentRoot(commentRoot)) {
            steps.push('comment:root');
            return commentRoot;
          }

          await wait(150);
        }

        missingTargets.push('comment-root');
        return null;
      };

      const readEditableText = (element) => {
        if (!element) {
          return '';
        }

        if ('value' in element) {
          return element.value || '';
        }

        return element.textContent || element.innerText || '';
      };

      const waitForCommentText = async (commentField) => {
        for (let index = 0; index < 8; index += 1) {
          if (normalize(readEditableText(commentField)).includes(normalize(payload.commentDraft))) {
            return true;
          }

          await wait(50);
        }

        missingTargets.push('comment-fill');
        return false;
      };

      const waitForDanmakuText = async (danmakuField) => {
        for (let index = 0; index < 8; index += 1) {
          if (normalize(readEditableText(danmakuField)).includes(normalize(payload.commentDraft))) {
            return true;
          }

          await wait(50);
        }

        missingTargets.push('danmaku-fill');
        return false;
      };

      const isDraftStillInField = (field) =>
        normalize(readEditableText(field)).includes(normalize(payload.commentDraft));

      const waitForDanmakuSubmitConfirmation = async (danmakuField) => {
        for (let index = 0; index < 8; index += 1) {
          if (!isDraftStillInField(danmakuField)) {
            return true;
          }

          await wait(80);
        }

        return false;
      };

      const dispatchEnterKey = (element) => {
        ['keydown', 'keypress', 'keyup'].forEach((eventName) => {
          element.dispatchEvent(
            new KeyboardEvent(eventName, {
              key: 'Enter',
              code: 'Enter',
              keyCode: 13,
              which: 13,
              bubbles: true,
              cancelable: true
            })
          );
        });
      };

      const dispatchShortcutKey = (key, code, keyCode) => {
        const target = document.activeElement && document.activeElement !== document.body
          ? document.activeElement
          : document.body || document.documentElement;
        ['keydown', 'keypress', 'keyup'].forEach((eventName) => {
          target?.dispatchEvent?.(
            new KeyboardEvent(eventName, {
              key,
              code,
              keyCode,
              which: keyCode,
              bubbles: true,
              cancelable: true
            })
          );
        });
      };

      const openDanmakuComposer = async () => {
        dispatchShortcutKey('d', 'KeyD', 68);
        steps.push('danmaku:shortcut:d');
        await wait(120);
        dispatchShortcutKey('Enter', 'Enter', 13);
        steps.push('danmaku:compose-enter');
        await wait(120);
      };

      const submitDanmaku = async (danmaku) => {
        danmaku.field.focus?.();
        dispatchEnterKey(danmaku.field);
        await wait(80);

        if (!(await waitForDanmakuSubmitConfirmation(danmaku.field))) {
          const submitButton = await waitForElement(
            () => queryDanmakuSubmitButton(danmaku.field),
            'danmaku-submit'
          );
          if (!submitButton) {
            return false;
          }

          submitButton.click?.();
          await wait(80);
        }

        if (!(await waitForDanmakuSubmitConfirmation(danmaku.field))) {
          missingTargets.push('danmaku-submit-confirm');
          return false;
        }

        steps.push('danmaku:submit');
        return true;
      };

      const fillDanmaku = async () => {
        if (!payload.commentDraft) {
          missingTargets.push('comment-draft');
          return false;
        }

        await openDanmakuComposer();

        const danmakuField = queryDanmakuField();
        if (!danmakuField) {
          missingTargets.push('danmaku-field');
          return false;
        }

        danmakuField.click?.();
        danmakuField.focus?.();
        steps.push('danmaku:focus');

        if (!typeText(danmakuField, payload.commentDraft)) {
          return false;
        }

        if (!(await waitForDanmakuText(danmakuField))) {
          return false;
        }

        steps.push('danmaku:fill');
        return {
          field: danmakuField,
          root:
            danmakuField.closest?.('.bpx-player-sending-area,.bilibili-player-video-sendbar') ||
            danmakuField.parentElement?.closest?.('.bpx-player-sending-area,.bilibili-player-video-sendbar,[class*="danmaku"],[class*="bpx-player"]') ||
            document.body
        };
      };

      const fillComment = async () => {
        const commentRoot = await waitForCommentRoot();
        if (!commentRoot) {
          return false;
        }

        await revealCommentRoot(commentRoot);
        let commentField = queryCommentField(commentRoot);

        if (!commentField) {
          await activateCommentBox(commentRoot);
          commentField = await waitForElement(() => queryCommentField(commentRoot), 'comment');
        }

        if (!commentField) {
          return false;
        }

        if (!payload.commentDraft) {
          missingTargets.push('comment-draft');
          return false;
        }

        commentField.click?.();
        commentField.focus?.();
        steps.push('comment:focus');

        if (!typeText(commentField, payload.commentDraft)) {
          return false;
        }

        if (!(await waitForCommentText(commentField))) {
          return false;
        }

        steps.push('comment:fill');
        commentField.scrollIntoView?.({ block: 'center' });
        commentField.focus?.();
        return { field: commentField, root: commentRoot };
      };

      const favoriteCurrentVideo = async () => {
        if (!targetLedger()) {
          missingTargets.push('target-ledger');
          return;
        }

        const favoriteButton = await waitForElement(queryFavoriteButton, 'favorite');
        if (isFavoriteAlreadyActive(favoriteButton)) {
          steps.push('favorite:already-collected');
          missingTargets.push('favorite-api-required');
          return;
        }

        const favoriteOpened = click(favoriteButton, 'favorite:open');
        if (favoriteOpened) {
          const selectedFolder = await ensureFavoriteFolder();
          if (!selectedFolder) {
            return;
          }

          click(selectedFolder, 'favorite:folder');
          click(await waitForElement(queryFavoriteConfirm, 'favorite-confirm'), 'favorite');
        }
      };

      const likeRequired = payload.action === '赏' || payload.action === '赐';
      let likeCompleted = true;

      if (likeRequired) {
        const likeButton = await waitForElement(queryLikeButton, 'like');

        if (isLikeAlreadyActive(likeButton)) {
          steps.push('like:already-liked');
        } else {
          likeCompleted = click(likeButton, 'like');
        }
      }

      if (likeRequired && likeCompleted) {
        await favoriteCurrentVideo();
      }

      if (payload.action === '藏') {
        await favoriteCurrentVideo();
      }

      if (payload.action === '赐' && likeCompleted) {
        const coinOpened = click(await waitForElement(queryCoinButton, 'coin'), 'coin:open');
        if (coinOpened) {
          const desiredCoinCount = String(payload.coinCount ?? 1);
          const coinDialog = await waitForElement(queryCoinDialog, 'coin-dialog');
          const coinChoice = await waitForElement(
            () => queryCoinOption(coinDialog, desiredCoinCount),
            'coin-option'
          );
          click(coinChoice, 'coin:' + desiredCoinCount);
          click(
            await waitForElement(
              () => queryCoinConfirm(coinDialog),
              'coin-confirm'
            ),
            'coin:confirm'
          );
        }
      }

      if (payload.action === '表') {
        const danmaku = await fillDanmaku();
        if (danmaku && payload.submitComment) {
          await submitDanmaku(danmaku);
        } else if (danmaku) {
          steps.push('danmaku:awaiting-submit');
        }
      }

      const success = missingTargets.length === 0;
      return {
        ok: success,
        steps,
        missingTargets,
        message: success && payload.action === '表' && !payload.submitComment
          ? '弹幕已填好，请主人确认后按 Enter 发送。'
          : success ? '奏折批阅已成。' : '尚有 ' + missingTargets.join('、') + ' 未能寻见。'
      };
    })();
  `
}
