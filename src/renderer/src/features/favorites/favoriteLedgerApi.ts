import type { FavoriteLedger, FavoriteLedgerSaveOptions } from '@shared/types'

export type FavoriteLedgerPreviewItem = {
  aid: number
  title: string
  sourceFolderTitle: string
  targetLedgerId: string
  targetFolderId?: string
  targetDisplayName: string
  reviewRequired: boolean
  alreadyInTarget: boolean
  selected: boolean
  selectedCandidateTarget?: boolean
}

function scriptPayload(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

function sharedScriptHelpers(): string {
  return `
    const readCookie = (name) =>
      document.cookie
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith(name + '='))
        ?.slice(name.length + 1) || '';
    const readCredentials = () => ({
      csrf: readCookie('bili_jct'),
      mid: readCookie('DedeUserID')
    });
    const ensureApiOk = async (response, label = 'Bilibili API') => {
      const contentType = response.headers?.get?.('content-type') || '';
      const bodyText = await response.text();
      const trimmedBody = bodyText.trim();
      if (/html/i.test(contentType) || /^<!doctype html/i.test(trimmedBody) || /^<html/i.test(trimmedBody)) {
        throw new Error(label + ' returned HTML instead of JSON. Please log in to Bilibili again or retry later.');
      }

      let json = null;
      try {
        json = bodyText ? JSON.parse(bodyText) : null;
      } catch {
        throw new Error(label + ' returned a non-JSON response.');
      }

      if (!response.ok || !json || json.code !== 0) {
        throw new Error(label + ' failed: ' + (json?.message || response.statusText || 'Bilibili API request failed'));
      }
      return json;
    };
    const buildListUrl = (mid) => {
      const url = new URL('https://api.bilibili.com/x/v3/fav/folder/created/list-all');
      url.searchParams.set('up_mid', String(mid));
      url.searchParams.set('type', '2');
      return url.toString();
    };
    const findFolderId = (folder) => folder?.id ?? folder?.fid;
    const syncLedgerFolderIds = (ledgers, folders) => {
      const folderById = new Map(
        folders
          .map((folder) => [String(findFolderId(folder) || ''), folder])
          .filter(([folderId]) => folderId)
      );
      return ledgers.map((ledger) => {
        const storedFolder = ledger.bilibiliFolderId
          ? folderById.get(String(ledger.bilibiliFolderId))
          : null;
        const folder = storedFolder || folders.find((candidate) => candidate?.title === ledger.displayName);
        const folderId = findFolderId(folder);
        if (folderId) {
          return { ...ledger, bilibiliFolderId: String(folderId) };
        }

        const { bilibiliFolderId, ...ledgerWithoutStaleFolderId } = ledger;
        return ledgerWithoutStaleFolderId;
      });
    };
  `
}

export function buildFavoriteLedgerStatusScript(ledgers: FavoriteLedger[]): string {
  const payload = scriptPayload({ ledgers })

  return `
    (async () => {
      const payload = ${payload};
      ${sharedScriptHelpers()}
      const { csrf, mid } = readCredentials();
      if (!csrf || !mid) {
        return { ok: false, ledgers: payload.ledgers, missingLedgerIds: [], message: '未能读取登录凭据，无法查验册目。' };
      }

      const response = await fetch(buildListUrl(mid), { credentials: 'include' });
      const json = await ensureApiOk(response, 'favorite folder list');
      const folders = Array.isArray(json.data?.list) ? json.data.list : [];
      const nextLedgers = syncLedgerFolderIds(payload.ledgers, folders);

      return {
        ok: true,
        ledgers: nextLedgers,
        missingLedgerIds: nextLedgers.filter((ledger) => ledger.enabled && !ledger.bilibiliFolderId).map((ledger) => ledger.id),
        message: '册目查验已毕。'
      };
    })();
  `
}

export function buildEnsureFavoriteLedgersScript(ledgers: FavoriteLedger[]): string {
  const payload = scriptPayload({ ledgers })

  return `
    (async () => {
      const payload = ${payload};
      ${sharedScriptHelpers()}
      const { csrf, mid } = readCredentials();
      if (!csrf || !mid) {
        return { ok: false, ledgers: payload.ledgers, steps: [], missingTargets: [], message: '未能读取登录凭据，无法备齐册目。' };
      }

      const steps = ['api:ledger:list'];
      const listResponse = await fetch(buildListUrl(mid), { credentials: 'include' });
      const listJson = await ensureApiOk(listResponse, 'favorite folder list');
      const folders = Array.isArray(listJson.data?.list) ? listJson.data.list : [];
      const nextLedgers = syncLedgerFolderIds(payload.ledgers, folders);

      for (let index = 0; index < nextLedgers.length; index += 1) {
        const ledger = nextLedgers[index];
        if (!ledger.enabled || ledger.bilibiliFolderId) {
          continue;
        }

        const body = new URLSearchParams();
        body.set('csrf', csrf);
        body.set('privacy', '0');
        body.set('title', ledger.displayName);
        const response = await fetch('https://api.bilibili.com/x/v3/fav/folder/add', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'content-type': 'application/x-www-form-urlencoded;charset=UTF-8'
          },
          body
        });
        const json = await ensureApiOk(response, 'favorite ledger create');
        const folderId = json.data?.id ?? json.data?.fid;
        if (folderId) {
          nextLedgers[index] = { ...ledger, bilibiliFolderId: String(folderId) };
        }
        steps.push('api:ledger:create:' + ledger.id);
      }

      const missingTargets = nextLedgers.filter((ledger) => ledger.enabled && !ledger.bilibiliFolderId).map((ledger) => ledger.id);

      return {
        ok: missingTargets.length === 0,
        ledgers: nextLedgers,
        steps,
        missingTargets,
        message: missingTargets.length === 0 ? '册目已备齐。' : '尚有册目未能备齐。'
      };
    })();
  `
}

export function buildSaveFavoriteLedgersScript(
  nextLedgers: FavoriteLedger[],
  previousLedgers: FavoriteLedger[],
  options: FavoriteLedgerSaveOptions = {}
): string {
  const payload = scriptPayload({ nextLedgers, options, previousLedgers })

  return `
    (async () => {
      const payload = ${payload};
      ${sharedScriptHelpers()}
      const { csrf, mid } = readCredentials();
      if (!csrf || !mid) {
        return {
          ok: false,
          ledgers: payload.nextLedgers,
          steps: [],
          missingTargets: ['favorite-api-user'],
          message: 'favorite credentials are unavailable'
        };
      }

      const steps = ['api:ledger:list'];
      const listResponse = await fetch(buildListUrl(mid), { credentials: 'include' });
      const listJson = await ensureApiOk(listResponse, 'favorite folder list');
      const folders = Array.isArray(listJson.data?.list) ? listJson.data.list : [];
      const folderById = new Map(
        folders
          .map((folder) => [String(findFolderId(folder) || ''), folder])
          .filter(([folderId]) => folderId)
      );
      let nextLedgers = syncLedgerFolderIds(payload.nextLedgers, folders);

      for (let index = 0; index < nextLedgers.length; index += 1) {
        const ledger = nextLedgers[index];
        if (!ledger.enabled || ledger.bilibiliFolderId) {
          continue;
        }

        const body = new URLSearchParams();
        body.set('csrf', csrf);
        body.set('privacy', '0');
        body.set('title', ledger.displayName);
        const response = await fetch('https://api.bilibili.com/x/v3/fav/folder/add', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'content-type': 'application/x-www-form-urlencoded;charset=UTF-8'
          },
          body
        });
        const json = await ensureApiOk(response, 'favorite ledger create');
        const folderId = json.data?.id ?? json.data?.fid;
        if (folderId) {
          nextLedgers[index] = { ...ledger, bilibiliFolderId: String(folderId) };
        }
        steps.push('api:ledger:create:' + ledger.id);
      }

      const canDeleteManagedFolder = (ledger) => {
        if (!ledger.bilibiliFolderId) {
          return false;
        }

        const folder = folderById.get(String(ledger.bilibiliFolderId));
        const remoteTitle = String(folder?.title ?? '');
        return String(ledger.displayName || '').startsWith('Bilimi') || remoteTitle.startsWith('Bilimi');
      };
      const canDeleteRemovedLedger = (ledger) => !ledger.isDefault && canDeleteManagedFolder(ledger);
      const shouldDeleteDisabled = payload.options?.deleteDisabled !== false;
      const disabledLedgers = shouldDeleteDisabled
        ? nextLedgers.filter((ledger) => !ledger.enabled && canDeleteManagedFolder(ledger))
        : [];

      for (const ledger of disabledLedgers) {
        const body = new URLSearchParams();
        body.set('csrf', csrf);
        body.set('media_ids', String(ledger.bilibiliFolderId));
        const response = await fetch('https://api.bilibili.com/x/v3/fav/folder/del', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'content-type': 'application/x-www-form-urlencoded;charset=UTF-8'
          },
          body
        });
        await ensureApiOk(response, 'favorite ledger delete');
        nextLedgers = nextLedgers.map((item) => {
          if (item.id !== ledger.id) {
            return item;
          }

          const { bilibiliFolderId, ...ledgerWithoutFolderId } = item;
          return ledgerWithoutFolderId;
        });
        steps.push('api:ledger:delete:' + ledger.id);
      }

      const nextLedgerIds = new Set(nextLedgers.map((ledger) => ledger.id));
      const removedLedgers = payload.previousLedgers.filter(
        (ledger) => !nextLedgerIds.has(ledger.id) && canDeleteRemovedLedger(ledger)
      );

      for (const ledger of removedLedgers) {
        const body = new URLSearchParams();
        body.set('csrf', csrf);
        body.set('media_ids', String(ledger.bilibiliFolderId));
        const response = await fetch('https://api.bilibili.com/x/v3/fav/folder/del', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'content-type': 'application/x-www-form-urlencoded;charset=UTF-8'
          },
          body
        });
        await ensureApiOk(response, 'favorite ledger delete');
        steps.push('api:ledger:delete:' + ledger.id);
      }

      const missingTargets = nextLedgers
        .filter((ledger) => ledger.enabled && !ledger.bilibiliFolderId)
        .map((ledger) => ledger.id);

      return {
        ok: missingTargets.length === 0,
        ledgers: nextLedgers,
        steps,
        missingTargets,
        message: missingTargets.length === 0 ? 'favorite ledgers saved' : 'some favorite ledgers are still missing'
      };
    })();
  `
}

export function buildScanOldFavoritesScript(ledgers: FavoriteLedger[]): string {
  const payload = scriptPayload({ ledgers })

  return `
    (async () => {
      const payload = ${payload};
      ${sharedScriptHelpers()}
      const steps = [];

      try {
        const { mid } = readCredentials();
        if (!mid) {
          return {
            ok: false,
            sourceFolders: [],
            targetMembership: {},
            steps,
            missingTargets: ['favorite-api-user'],
            message: 'favorite user is unavailable'
          };
        }

        const listResponse = await fetch(buildListUrl(mid), { credentials: 'include' });
        const listJson = await ensureApiOk(listResponse, 'favorite folder list');
        const folders = Array.isArray(listJson.data?.list) ? listJson.data.list : [];
        const targetFolderIds = new Set(
          payload.ledgers
            .map((ledger) => ledger.bilibiliFolderId)
            .filter(Boolean)
            .map(String)
        );
        const sourceFolders = [];
        const targetMembership = {};
        steps.push('api:favorite:list');

        const buildResourceUrl = (folderId, page) => {
          const url = new URL('https://api.bilibili.com/x/v3/fav/resource/list');
          url.searchParams.set('media_id', String(folderId));
          url.searchParams.set('pn', String(page));
          url.searchParams.set('ps', '20');
          url.searchParams.set('type', '0');
          url.searchParams.set('order', 'mtime');
          url.searchParams.set('platform', 'web');
          return url.toString();
        };
        const readFolderVideos = async (folderId) => {
          const videos = [];
          let page = 1;
          const cleanText = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
          const readTagName = (tag) =>
            typeof tag === 'string'
              ? cleanText(tag)
              : cleanText(tag?.name ?? tag?.tag_name ?? tag?.title);
          const readTags = (media) => {
            const rawTags = Array.isArray(media?.tags)
              ? media.tags
              : Array.isArray(media?.tag)
                ? media.tag
                : [];
            return rawTags.map(readTagName).filter(Boolean).slice(0, 20);
          };
          const readAuthor = (media) =>
            cleanText(media?.upper?.name ?? media?.upper?.uname ?? media?.owner?.name ?? media?.author);
          const readCategory = (media) =>
            cleanText(media?.tname ?? media?.category ?? media?.typename ?? media?.type_name);
          const isVideoMedia = (media) => {
            const type = Number(media?.type);
            if (Number.isFinite(type)) {
              return type === 2;
            }

            const link = String(media?.link ?? media?.uri ?? media?.url ?? '');
            return /\\/video\\//i.test(link);
          };
          const isUnavailableMedia = (media) => {
            const title = cleanText(media?.title);
            const attr = Number(media?.attr);
            const state = Number(media?.state ?? media?.status);
            return (
              media?.is_invalid === true ||
              media?.invalid === true ||
              media?.is_deleted === true ||
              (Number.isFinite(attr) && attr !== 0) ||
              (Number.isFinite(state) && state < 0) ||
              /已失效|已删除|不存在|失效视频/.test(title)
            );
          };

          while (true) {
            const response = await fetch(buildResourceUrl(folderId, page), {
              credentials: 'include'
            });
            const json = await ensureApiOk(response, 'favorite resource list for folder ' + folderId);
            const medias = Array.isArray(json.data?.medias) ? json.data.medias : [];
            videos.push(...medias.filter((media) => isVideoMedia(media) && !isUnavailableMedia(media)).map((media) => ({
              aid: Number(media?.id ?? media?.aid),
              title: String(media?.title ?? ''),
              description: String(media?.intro ?? ''),
              author: readAuthor(media),
              tags: readTags(media),
              category: readCategory(media)
            })).filter((video) => Number.isFinite(video.aid) && video.aid > 0));

            if (!json.data?.has_more || medias.length === 0) {
              break;
            }

            page += 1;
          }

          return videos;
        };

        for (const folder of folders) {
          const folderId = findFolderId(folder);
          if (!folderId) {
            continue;
          }

          const folderIdString = String(folderId);
          const videos = await readFolderVideos(folderIdString);

          if (targetFolderIds.has(folderIdString)) {
            targetMembership[folderIdString] = videos.map((video) => video.aid);
            steps.push('api:favorite:scan-target:' + folderIdString);
          }

          sourceFolders.push({
            id: folderIdString,
            title: String(folder?.title ?? ''),
            videos
          });
          steps.push('api:favorite:scan-source:' + folderIdString);
        }

        return {
          ok: true,
          sourceFolders,
          targetMembership,
          steps,
          missingTargets: [],
          message: 'old favorites scanned'
        };
      } catch (error) {
        return {
          ok: false,
          sourceFolders: [],
          targetMembership: {},
          steps,
          missingTargets: ['favorite-ledger-api'],
          message: 'old favorite scan failed: ' + (error instanceof Error ? error.message : String(error || 'unknown error'))
        };
      }
    })();
  `
}

export function buildExecuteFavoriteLedgerPlanScript(items: FavoriteLedgerPreviewItem[]): string {
  const payload = scriptPayload({ items })

  return `
    (async () => {
      const payload = ${payload};
      ${sharedScriptHelpers()}
      const steps = [];
      const missingTargets = [];
      const appendFailures = [];
      let syncRequired = false;
      const syncRequiredMessage = '掌库和 B 站收藏夹不一致，请先同步掌库后再确认执行。';

      try {
        const { csrf } = readCredentials();
        if (!csrf) {
          return { ok: false, steps, missingTargets, message: '未能读取登录凭据，无法归册。' };
        }

        const executableItems = payload.items.filter((item) => {
          if (item.selected === false || item.alreadyInTarget === true) {
            return false;
          }
          if (!item.targetFolderId && !item.selectedCandidateTarget) {
            missingTargets.push(item.targetLedgerId);
            syncRequired = true;
            return false;
          }
          return true;
        });

        const appendItem = async (item, targetFolderId) => {
          const body = new URLSearchParams();
          body.set('add_media_ids', String(targetFolderId));
          body.set('csrf', csrf);
          body.set('del_media_ids', '');
          body.set('rid', String(item.aid));
          body.set('type', '2');
          body.set('platform', 'web');
          body.set('from_spmid', '');
          body.set('spmid', '333.788.0.0');
          body.set('statistics', JSON.stringify({ appId: 100, platform: 5 }));
          const response = await fetch('https://api.bilibili.com/x/v3/fav/resource/deal', {
            method: 'POST',
            credentials: 'include',
            headers: {
              'content-type': 'application/x-www-form-urlencoded;charset=UTF-8'
            },
            body
          });
          await ensureApiOk(response, 'favorite ledger append');
        };
        const refreshTargetFolderId = async (targetDisplayName) => {
          const { mid } = readCredentials();
          if (!mid || !targetDisplayName) {
            return '';
          }

          const response = await fetch(buildListUrl(mid), { credentials: 'include' });
          const json = await ensureApiOk(response, 'favorite folder list');
          const folders = Array.isArray(json.data?.list) ? json.data.list : [];
          const folder = folders.find((candidate) => candidate?.title === targetDisplayName);
          const folderId = findFolderId(folder);
          return folderId ? String(folderId) : '';
        };

        for (const item of executableItems) {
          try {
            let targetFolderId = item.targetFolderId;
            if (!targetFolderId && item.selectedCandidateTarget) {
              targetFolderId = await refreshTargetFolderId(item.targetDisplayName);
              if (targetFolderId) {
                steps.push('api:ledger:append-refresh:' + item.aid);
              }
            }
            if (!targetFolderId) {
              missingTargets.push(item.targetLedgerId);
              syncRequired = true;
              throw new Error(syncRequiredMessage);
            }
            await appendItem(item, targetFolderId);
            steps.push('api:ledger:append:' + item.aid);
          } catch (error) {
            try {
              const refreshedFolderId = await refreshTargetFolderId(item.targetDisplayName);
              if (!refreshedFolderId || refreshedFolderId === String(item.targetFolderId)) {
                if (!refreshedFolderId) {
                  syncRequired = true;
                }
                throw error;
              }

              steps.push('api:ledger:append-retry:' + item.aid);
              await appendItem(item, refreshedFolderId);
              steps.push('api:ledger:append:' + item.aid);
            } catch {
              const message = error instanceof Error ? error.message : String(error || 'unknown error');
              appendFailures.push({ aid: item.aid, title: item.title, message });
              missingTargets.push('favorite-ledger-append:' + item.aid);
              steps.push('api:ledger:append-failed:' + item.aid);
            }
          }
        }

        const appendCount = steps.filter((step) => step.startsWith('api:ledger:append:')).length;
        if (appendFailures.length > 0) {
          const isHtmlLoginFailure = (message) =>
            /returned HTML instead of JSON|log in to Bilibili/i.test(String(message || ''));
          const hasHtmlLoginFailure = appendFailures.some((failure) => isHtmlLoginFailure(failure.message));
          const summarizeFailureMessage = (message) =>
            isHtmlLoginFailure(message) ? 'Bilibili 登录状态失效' : String(message || 'unknown error');
          const failedTitles = appendFailures
            .slice(0, 3)
            .map((failure) => (failure.title || String(failure.aid)) + ': ' + summarizeFailureMessage(failure.message))
            .join('、');
          return {
            ok: false,
            steps,
            missingTargets,
            message:
              'old favorite organization partially completed: ' +
              appendCount +
              ' appended, ' +
              appendFailures.length +
              ' failed' +
              (failedTitles ? ' (' + failedTitles + ')' : '') +
              (syncRequired ? ' ' + syncRequiredMessage : '') +
              (hasHtmlLoginFailure ? ' 请重新登录 Bilibili 后再试。' : '') +
              '.'
          };
        }

        return {
          ok: missingTargets.length === 0,
          steps,
          missingTargets,
          message: missingTargets.length === 0 ? '旧藏已归册。' : syncRequiredMessage
        };
      } catch (error) {
        return {
          ok: false,
          steps,
          missingTargets: missingTargets.length > 0 ? missingTargets : ['favorite-ledger-api'],
          message: '旧藏归册未能完成：' + (error instanceof Error ? error.message : String(error || '未知错误'))
        };
      }
    })();
  `
}
