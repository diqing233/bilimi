import type { FavoriteLedger } from '@shared/types'

type FavoriteApiAdjustmentOptions = {
  addLedgerIds: string[]
  removeLedgerIds: string[]
}

export function buildFavoriteApiFallbackScript(
  favoriteLedgers: FavoriteLedger[],
  targetLedgerId: string,
  targetLedgerIds: string[] = [targetLedgerId]
): string {
  const payload = JSON.stringify({
    favoriteLedgers,
    targetLedgerId,
    targetLedgerIds
  })

  return `
    (async () => {
      const payload = ${payload};
      const steps = [];
      const missingTargets = [];

      const readCookie = (name) =>
        document.cookie
          .split(';')
          .map((part) => part.trim())
          .find((part) => part.startsWith(name + '='))
          ?.slice(name.length + 1) || '';

      const fail = (target, message) => {
        missingTargets.push(target);
        return {
          ok: false,
          steps,
          missingTargets,
          message
        };
      };

      const queryFavoriteToolbarButton = () => {
        const selectors = [
          '.video-toolbar-left .video-fav',
          '.video-toolbar-left-item.video-fav',
          '.video-toolbar-left-item[class*="fav"]',
          '.toolbar-left-item[class*="fav"]',
          '.toolbar-right [class*="fav"]',
          '.video-fav',
          '[class*="video-fav"]',
          'button[aria-label*="收藏"]',
          '[role="button"][aria-label*="收藏"]',
          'button[title*="收藏"]',
          '[role="button"][title*="收藏"]'
        ].join(',');

        const nodes = Array.from(document.querySelectorAll(selectors));
        return nodes.find((node) => {
          const style = window.getComputedStyle?.(node);
          if (style?.display === 'none' || style?.visibility === 'hidden') {
            return false;
          }

          const text = [
            node.getAttribute?.('aria-label'),
            node.getAttribute?.('title'),
            node.getAttribute?.('class'),
            node.textContent
          ].filter(Boolean).join(' ');
          return /收藏|favorite|fav|collect/i.test(text);
        }) || null;
      };

      const syncToolbarFavoriteState = () => {
        const favoriteButton = queryFavoriteToolbarButton();

        if (!favoriteButton) {
          return false;
        }

        const activeColor = '#00aeec';
        const activeClassNames = ['active', 'on', 'selected', 'is-active', 'is-fav', 'favorited', 'collected'];
        const styledNodes = [
          favoriteButton,
          ...Array.from(favoriteButton.querySelectorAll?.('svg,path,use,i,span') || [])
        ];

        activeClassNames.forEach((className) => favoriteButton.classList?.add(className));
        favoriteButton.setAttribute?.('aria-label', '已收藏');
        favoriteButton.setAttribute?.('title', '已收藏');
        favoriteButton.setAttribute?.('aria-pressed', 'true');
        favoriteButton.setAttribute?.('data-active', 'true');
        favoriteButton.setAttribute?.('data-favorite', 'true');

        styledNodes.forEach((node) => {
          node.style?.setProperty('color', activeColor, 'important');
          node.style?.setProperty('fill', activeColor, 'important');

          if (node.tagName?.toLowerCase() === 'path') {
            node.style?.setProperty('stroke', activeColor, 'important');
          }
        });

        favoriteButton.dispatchEvent?.(
          new CustomEvent('bilimi:favorite-synced', {
            bubbles: true,
            detail: { source: 'favorite-api' }
          })
        );
        return true;
      };

      const requestJson = async (url, options = {}) => {
        const response = await fetch(url, {
          credentials: 'include',
          ...options
        });
        const json = await response.json().catch(() => null);

        if (!response.ok || !json || json.code !== 0) {
          throw new Error(json?.message || response.statusText || 'Bilibili API request failed');
        }

        return json.data;
      };

      const readAidFromPage = () =>
        window.__INITIAL_STATE__?.aid ||
        window.__INITIAL_STATE__?.videoData?.aid ||
        window.__INITIAL_STATE__?.videoData?.stat?.aid ||
        window.aid ||
        null;

      const readBvidFromPage = () =>
        window.__INITIAL_STATE__?.bvid ||
        window.__INITIAL_STATE__?.videoData?.bvid ||
        location.pathname.match(/\\/video\\/(BV[^/?#]+)/)?.[1] ||
        '';

      const resolveAid = async () => {
        const pageAid = readAidFromPage();

        if (pageAid) {
          return pageAid;
        }

        const bvid = readBvidFromPage();

        if (!bvid) {
          return null;
        }

        const viewUrl = new URL('https://api.bilibili.com/x/web-interface/view');
        viewUrl.searchParams.set('bvid', bvid);
        const data = await requestJson(viewUrl.toString());
        return data?.aid || null;
      };

      try {
        const csrf = readCookie('bili_jct');
        const mid = readCookie('DedeUserID');

        if (!csrf) {
          return fail('favorite-api-csrf', '未能读取登录凭据，无法调用 B 站收藏接口。');
        }

        if (!mid) {
          return fail('favorite-api-user', '未能读取 B 站用户 ID，无法调用收藏接口。');
        }

        const aid = await resolveAid();

        if (!aid) {
          return fail('favorite-api-aid', '未能读取当前视频 aid，无法调用收藏接口。');
        }

        const targetLedgerIds = Array.from(new Set(
          (Array.isArray(payload.targetLedgerIds) && payload.targetLedgerIds.length > 0
            ? payload.targetLedgerIds
            : [payload.targetLedgerId]
          ).filter(Boolean)
        ));
        const targetLedgers = targetLedgerIds
          .map((ledgerId) => payload.favoriteLedgers.find((ledger) => ledger.id === ledgerId))
          .filter(Boolean);
        const targetLedger = targetLedgers[0];
        const targetFolderName = targetLedger?.displayName;

        if (!targetFolderName) {
          return fail('favorite-api-target-ledger', '未找到目标 bilimi 收藏账本，无法调用收藏接口。');
        }
        const listUrl = new URL('https://api.bilibili.com/x/v3/fav/folder/created/list-all');
        listUrl.searchParams.set('up_mid', String(mid));
        listUrl.searchParams.set('type', '2');
        listUrl.searchParams.set('rid', String(aid));

        const listData = await requestJson(listUrl.toString());
        steps.push('api:favorite:list');

        const folders = Array.isArray(listData?.list) ? listData.list : [];
        const ensureTargetFolder = async (ledger) => {
          let targetFolder = folders.find((folder) => folder?.title === ledger.displayName);

          if (!targetFolder) {
            const createBody = new URLSearchParams({
              csrf,
              privacy: '0',
              title: ledger.displayName
            });
            const createData = await requestJson(
              'https://api.bilibili.com/x/v3/fav/folder/add',
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: createBody
              }
            );
            targetFolder = createData;
            folders.push(targetFolder);
            steps.push('api:favorite:create-folder');
          }

          return targetFolder?.id || targetFolder?.fid || '';
        };
        const folderIds = [];
        const favoriteFolderIdsByLedgerId = {};
        for (const ledger of targetLedgers) {
          const folderId = await ensureTargetFolder(ledger);
          if (folderId) {
            const normalizedFolderId = String(folderId);
            folderIds.push(normalizedFolderId);
            favoriteFolderIdsByLedgerId[ledger.id] = normalizedFolderId;
          }
        }

        if (folderIds.length === 0) {
          return fail('favorite-api-folder-id', 'B 站收藏接口未返回 bilimi 收藏夹 ID。');
        }

        const dealBody = new URLSearchParams({
          add_media_ids: folderIds.join(','),
          csrf,
          del_media_ids: '',
          from_spmid: '',
          platform: 'web',
          rid: String(aid),
          spmid: '333.788.0.0',
          statistics: JSON.stringify({ appId: 100, platform: 5 }),
          type: '2'
        });

        await requestJson('https://api.bilibili.com/x/v3/fav/resource/deal', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: dealBody
        });
        steps.push('api:favorite:add');

        if (syncToolbarFavoriteState()) {
          steps.push('api:favorite:sync-toolbar');
        }

        return {
          ok: true,
          steps,
          missingTargets: [],
          favoriteFolderIdsByLedgerId,
          message: '已用 B 站接口归入 bilimi 收藏夹：' +
            targetLedgers.map((ledger) => ledger.displayName).join('、') +
            '。'
        };
      } catch (error) {
        return {
          ok: false,
          steps,
          missingTargets: missingTargets.length > 0 ? missingTargets : ['favorite-api'],
          message:
            'B 站收藏接口未能完成：' +
            (error instanceof Error ? error.message : String(error || '未知错误'))
        };
      }
    })();
  `
}

export function buildFavoriteApiAdjustmentScript(
  favoriteLedgers: FavoriteLedger[],
  options: FavoriteApiAdjustmentOptions
): string {
  const payload = JSON.stringify({
    favoriteLedgers,
    addLedgerIds: options.addLedgerIds,
    removeLedgerIds: options.removeLedgerIds
  })

  return `
    (async () => {
      const payload = ${payload};
      const steps = [];
      const missingTargets = [];

      const readCookie = (name) =>
        document.cookie
          .split(';')
          .map((part) => part.trim())
          .find((part) => part.startsWith(name + '='))
          ?.slice(name.length + 1) || '';

      const fail = (target, message) => {
        missingTargets.push(target);
        return {
          ok: false,
          steps,
          missingTargets,
          message
        };
      };

      const requestJson = async (url, options = {}) => {
        const response = await fetch(url, {
          credentials: 'include',
          ...options
        });
        const json = await response.json().catch(() => null);

        if (!response.ok || !json || json.code !== 0) {
          throw new Error(json?.message || response.statusText || 'Bilibili API request failed');
        }

        return json.data;
      };

      const readAidFromPage = () =>
        window.__INITIAL_STATE__?.aid ||
        window.__INITIAL_STATE__?.videoData?.aid ||
        window.__INITIAL_STATE__?.videoData?.stat?.aid ||
        window.aid ||
        null;

      const readBvidFromPage = () =>
        window.__INITIAL_STATE__?.bvid ||
        window.__INITIAL_STATE__?.videoData?.bvid ||
        location.pathname.match(/\\/video\\/(BV[^/?#]+)/)?.[1] ||
        '';

      const resolveAid = async () => {
        const pageAid = readAidFromPage();

        if (pageAid) {
          return pageAid;
        }

        const bvid = readBvidFromPage();

        if (!bvid) {
          return null;
        }

        const viewUrl = new URL('https://api.bilibili.com/x/web-interface/view');
        viewUrl.searchParams.set('bvid', bvid);
        const data = await requestJson(viewUrl.toString());
        return data?.aid || null;
      };

      try {
        const csrf = readCookie('bili_jct');
        const mid = readCookie('DedeUserID');

        if (!csrf) {
          return fail('favorite-api-csrf', '未能读取登录凭据，无法调用 B 站收藏接口。');
        }

        if (!mid) {
          return fail('favorite-api-user', '未能读取 B 站用户 ID，无法调用收藏接口。');
        }

        const aid = await resolveAid();

        if (!aid) {
          return fail('favorite-api-aid', '未能读取当前视频 aid，无法调用收藏接口。');
        }

        const unique = (values) => Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean)));
        const addLedgerIds = unique(payload.addLedgerIds);
        const removeLedgerIds = unique(payload.removeLedgerIds).filter((ledgerId) => !addLedgerIds.includes(ledgerId));

        if (addLedgerIds.length === 0 && removeLedgerIds.length === 0) {
          return fail('favorite-api-adjust-targets', 'DeepSeek 没有可调整的 bilimi 收藏目标。');
        }

        const listUrl = new URL('https://api.bilibili.com/x/v3/fav/folder/created/list-all');
        listUrl.searchParams.set('up_mid', String(mid));
        listUrl.searchParams.set('type', '2');
        listUrl.searchParams.set('rid', String(aid));

        const listData = await requestJson(listUrl.toString());
        steps.push('api:favorite:adjust-list');

        const folders = Array.isArray(listData?.list) ? listData.list : [];
        const findFolderId = (folder) => folder?.id || folder?.fid || '';
        const ensureTargetFolder = async (ledger) => {
          let targetFolder = folders.find((folder) => folder?.title === ledger.displayName);

          if (!targetFolder) {
            const createBody = new URLSearchParams({
              csrf,
              privacy: '0',
              title: ledger.displayName
            });
            const createData = await requestJson(
              'https://api.bilibili.com/x/v3/fav/folder/add',
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: createBody
              }
            );
            targetFolder = createData;
            folders.push(targetFolder);
            steps.push('api:favorite:adjust-create-folder');
          }

          return findFolderId(targetFolder);
        };
        const addFolderIds = [];
        for (const ledgerId of addLedgerIds) {
          const ledger = payload.favoriteLedgers.find((candidate) => candidate.id === ledgerId);
          if (!ledger) {
            continue;
          }
          const folderId = await ensureTargetFolder(ledger);
          if (folderId) {
            addFolderIds.push(String(folderId));
          }
        }
        const removeFolderIds = [];
        for (const ledgerId of removeLedgerIds) {
          const ledger = payload.favoriteLedgers.find((candidate) => candidate.id === ledgerId);
          const folder = ledger ? folders.find((candidate) => candidate?.title === ledger.displayName) : null;
          const folderId = findFolderId(folder);
          if (folderId) {
            removeFolderIds.push(String(folderId));
          }
        }

        if (addFolderIds.length === 0 && removeFolderIds.length === 0) {
          return fail('favorite-api-adjust-folder-id', '未找到可调整的 bilimi 收藏夹 ID。');
        }

        const dealBody = new URLSearchParams({
          add_media_ids: addFolderIds.join(','),
          csrf,
          del_media_ids: removeFolderIds.join(','),
          from_spmid: '',
          platform: 'web',
          rid: String(aid),
          spmid: '333.788.0.0',
          statistics: JSON.stringify({ appId: 100, platform: 5 }),
          type: '2'
        });

        await requestJson('https://api.bilibili.com/x/v3/fav/resource/deal', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: dealBody
        });
        steps.push('api:favorite:adjust');

        return {
          ok: true,
          steps,
          missingTargets: [],
          message: 'DeepSeek 后台归类调整已完成。'
        };
      } catch (error) {
        return {
          ok: false,
          steps,
          missingTargets: missingTargets.length > 0 ? missingTargets : ['favorite-api-adjust'],
          message:
            'DeepSeek 后台归类调整未能完成：' +
            (error instanceof Error ? error.message : String(error || '未知错误'))
        };
      }
    })();
  `
}
