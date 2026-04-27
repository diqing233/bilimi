import type { AssistantAction } from '@shared/types'

type RecommendationKind = 'funny' | 'knowledge' | 'story' | 'suspicious'

export const BILIMI_FAVORITE_FOLDERS: Record<RecommendationKind, string> = {
  funny: 'Bilimi｜解闷小品',
  knowledge: 'Bilimi｜见闻增广',
  story: 'Bilimi｜剧情留档',
  suspicious: 'Bilimi｜谨慎观察'
}

export function buildAutomationScript(
  action: AssistantAction,
  favoritesFolderName: string,
  coinCount?: 1 | 2,
  commentDraft?: string,
  recommendationKind: RecommendationKind = 'funny'
): string {
  const payload = JSON.stringify({
    action,
    favoritesFolderName,
    coinCount,
    commentDraft,
    recommendationKind,
    favoriteFolders: BILIMI_FAVORITE_FOLDERS
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

        if ('value' in element) {
          element.value = value;
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          element.textContent = value;
          element.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }));
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

      const querySubmitButton = () =>
        byText('button,[role="button"],.comment-submit,.submit', ['发布', '发送', '提交']);

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

      const nodeOwnSearchText = (node) =>
        [
          node.getAttribute?.('aria-label'),
          node.getAttribute?.('title'),
          node.getAttribute?.('class'),
          ...Array.from(node.childNodes || [])
            .filter((child) => child.nodeType === Node.TEXT_NODE)
            .map((child) => child.textContent)
        ].filter(Boolean).join(' ');

      const targetFavoriteFolderName = () =>
        payload.favoriteFolders[payload.recommendationKind] || payload.favoritesFolderName;

      const matchingFavoriteKeywords = () => {
        const targetName = targetFavoriteFolderName();
        const keywordMap = {
          funny: ['解闷', '小品', '搞笑', '快乐', 'funny'],
          knowledge: ['见闻', '知识', '科普', '学习', 'knowledge'],
          story: ['剧情', '故事', '留档', 'story'],
          suspicious: ['谨慎', '观察', '避雷', '慎入', 'suspicious']
        };

        return [targetName, ...(keywordMap[payload.recommendationKind] || [])];
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
          for (const folderName of Object.values(payload.favoriteFolders)) {
            createdAll = (await createFavoriteFolder(folderName)) && createdAll;
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

      const queryCommentField = () =>
        document.querySelector('textarea') ||
        document.querySelector('[contenteditable="true"]') ||
        document.querySelector('input[type="text"]');

      const fillComment = async () => {
        const commentField = await waitForElement(queryCommentField, 'comment');

        if (!commentField) {
          return false;
        }

        if (!payload.commentDraft) {
          missingTargets.push('comment-draft');
          return false;
        }

        if ('value' in commentField) {
          commentField.value = payload.commentDraft;
          commentField.dispatchEvent(new Event('input', { bubbles: true }));
          commentField.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          commentField.textContent = payload.commentDraft;
          commentField.dispatchEvent(new InputEvent('input', { bubbles: true, data: payload.commentDraft }));
        }

        steps.push('comment:fill');
        return true;
      };

      const favoriteCurrentVideo = async () => {
        const favoriteOpened = click(await waitForElement(queryFavoriteButton, 'favorite'), 'favorite:open');
        if (favoriteOpened) {
          const selectedFolder = await ensureFavoriteFolder();
          if (!selectedFolder) {
            return;
          }

          click(selectedFolder, 'favorite:folder');
          click(await waitForElement(queryFavoriteConfirm, 'favorite-confirm'), 'favorite');
        }
      };

      if (payload.action === '赏' || payload.action === '赐') {
        click(await waitForElement(queryLikeButton, 'like'), 'like');
        await favoriteCurrentVideo();
      }

      if (payload.action === '藏') {
        await favoriteCurrentVideo();
      }

      if (payload.action === '赐') {
        const coinOpened = click(await waitForElement(queryCoinButton, 'coin'), 'coin:open');
        if (coinOpened) {
          const desiredCoinCount = String(payload.coinCount ?? 1);
          const coinChoice = await waitForElement(
            () => byText(
              'button,[role="button"],label,.coin-item,.coin-option',
              [desiredCoinCount, '投' + desiredCoinCount + '币', ' ' + desiredCoinCount + ' ']
            ),
            'coin-option'
          );
          click(coinChoice, 'coin:' + desiredCoinCount);
          click(
            await waitForElement(
              () => byText('button,[role="button"],.coin-submit,.submit', ['确定', '确认', '投币']),
              'coin-confirm'
            ),
            'coin:confirm'
          );
        }
      }

      if (payload.action === '表') {
        const filled = await fillComment();
        if (filled) {
          click(await waitForElement(querySubmitButton, 'comment-submit'), 'comment:submit');
        }
      }

      const success = missingTargets.length === 0;
      return {
        ok: success,
        steps,
        missingTargets,
        message: success ? '奏折批阅已成。' : '尚有 ' + missingTargets.join('、') + ' 未能寻见。'
      };
    })();
  `
}
