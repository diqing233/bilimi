import type { FavoriteLedger } from '@shared/types'

export function buildFavoriteApiFallbackScript(
  favoriteLedgers: FavoriteLedger[],
  targetLedgerId: string
): string {
  const payload = JSON.stringify({
    favoriteLedgers,
    targetLedgerId
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

        const targetLedger = payload.favoriteLedgers.find(
          (ledger) => ledger.id === payload.targetLedgerId
        );
        const targetFolderName = targetLedger?.displayName;

        if (!targetFolderName) {
          return fail('favorite-api-target-ledger', '未找到目标 Bilimi 收藏账本，无法调用收藏接口。');
        }
        const listUrl = new URL('https://api.bilibili.com/x/v3/fav/folder/created/list-all');
        listUrl.searchParams.set('up_mid', String(mid));
        listUrl.searchParams.set('type', '2');
        listUrl.searchParams.set('rid', String(aid));

        const listData = await requestJson(listUrl.toString());
        steps.push('api:favorite:list');

        const folders = Array.isArray(listData?.list) ? listData.list : [];
        let targetFolder = folders.find((folder) => folder?.title === targetFolderName);

        if (!targetFolder) {
          const createBody = new URLSearchParams({
            csrf,
            privacy: '0',
            title: targetFolderName
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
          steps.push('api:favorite:create-folder');
        }

        const folderId = targetFolder?.id || targetFolder?.fid;

        if (!folderId) {
          return fail('favorite-api-folder-id', 'B 站收藏接口未返回 Bilimi 收藏夹 ID。');
        }

        const dealBody = new URLSearchParams({
          add_media_ids: String(folderId),
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

        return {
          ok: true,
          steps,
          missingTargets: [],
          message: '已用 B 站接口归入 Bilimi 收藏夹。'
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
