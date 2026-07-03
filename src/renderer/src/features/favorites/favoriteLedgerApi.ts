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

export type FavoriteLedgerExecutionPacingOptions = {
  appendDelayMs?: {
    max: number
    min: number
  }
  cooldownDelayMs?: {
    max: number
    min: number
  }
  cooldownEvery?: number
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
        return /^bilimi[·\\s-]?/i.test(String(ledger.displayName || '')) || /^bilimi[·\\s-]?/i.test(remoteTitle);
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
  return buildOldFavoriteScanScript({ ledgers })
}

export function buildScanOldFavoriteVideoScript(ledgers: FavoriteLedger[], aid: number): string {
  return buildOldFavoriteScanScript({ ledgers, aid })
}

function buildOldFavoriteScanScript(args: { ledgers: FavoriteLedger[]; aid?: number }): string {
  const payload = scriptPayload({ ledgers: args.ledgers, aid: args.aid ?? null })

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
        let fallbackSourceFolder = null;
        const skippedSourceFolderTitles = [];
        const targetMembership = {};
        const scanDiagnostics = {
          tagDetailRequests: 0,
          tagDetailFailures: 0,
          taggedVideos: 0,
          untaggedVideos: 0
        };
        const tagDetailCache = new Map();
        let lastTagDetailRequestAt = 0;
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
        const buildTagUrl = (aid) => {
          const url = new URL('https://api.bilibili.com/x/tag/archive/tags');
          url.searchParams.set('aid', String(aid));
          return url.toString();
        };
        const wait = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));
        const paceTagDetailRequest = async () => {
          const elapsed = Date.now() - lastTagDetailRequestAt;
          if (lastTagDetailRequestAt > 0 && elapsed < 120) {
            await wait(120 - elapsed);
          }
          lastTagDetailRequestAt = Date.now();
        };
        const readFolderVideos = async (folderId) => {
          const videos = [];
          let page = 1;
          const cleanText = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
          const readTagName = (tag) =>
            typeof tag === 'string'
              ? cleanText(tag)
              : cleanText(tag?.name ?? tag?.tag_name ?? tag?.title);
          const readTagList = (rawTags) => rawTags.map(readTagName).filter(Boolean).slice(0, 20);
          const readTags = (media) => {
            const rawTags = Array.isArray(media?.tags)
              ? media.tags
              : Array.isArray(media?.tag)
                ? media.tag
                : [];
            return readTagList(rawTags);
          };
          const fetchDetailTags = async (aid) => {
            if (tagDetailCache.has(aid)) {
              return tagDetailCache.get(aid);
            }

            scanDiagnostics.tagDetailRequests += 1;
            try {
              await paceTagDetailRequest();
              const response = await fetch(buildTagUrl(aid), { credentials: 'include' });
              const json = await ensureApiOk(response, 'video tag list for ' + aid);
              const rawTags = Array.isArray(json.data)
                ? json.data
                : Array.isArray(json.data?.tags)
                  ? json.data.tags
                  : [];
              const tags = readTagList(rawTags);
              tagDetailCache.set(aid, tags);
              return tags;
            } catch {
              scanDiagnostics.tagDetailFailures += 1;
              tagDetailCache.set(aid, []);
              return [];
            }
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
            const pageVideos = [];
            for (const media of medias.filter((media) => isVideoMedia(media) && !isUnavailableMedia(media))) {
              const aid = Number(media?.id ?? media?.aid);
              if (!Number.isFinite(aid) || aid <= 0) {
                continue;
              }
              if (payload.aid && aid !== Number(payload.aid)) {
                continue;
              }

              const tags = readTags(media);
              const resolvedTags = tags.length > 0 ? tags : await fetchDetailTags(aid);
              if (resolvedTags.length > 0) {
                scanDiagnostics.taggedVideos += 1;
              } else {
                scanDiagnostics.untaggedVideos += 1;
              }
              pageVideos.push({
                aid,
                title: String(media?.title ?? ''),
                description: String(media?.intro ?? ''),
                author: readAuthor(media),
                tags: resolvedTags,
                category: readCategory(media)
              });
            }
            videos.push(...pageVideos);

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
          let videos = [];
          try {
            videos = await readFolderVideos(folderIdString);
          } catch {
            skippedSourceFolderTitles.push(String(folder?.title ?? folderIdString));
            steps.push('api:favorite:scan-source-failed:' + folderIdString);
            continue;
          }

          if (targetFolderIds.has(folderIdString)) {
            targetMembership[folderIdString] = videos.map((video) => video.aid);
            steps.push((payload.aid ? 'api:favorite:scan-video-target:' : 'api:favorite:scan-target:') + folderIdString);
          }

          const sourceFolder = {
            id: folderIdString,
            title: String(folder?.title ?? ''),
            videos
          };

          if (!payload.aid) {
            sourceFolders.push(sourceFolder);
            steps.push('api:favorite:scan-source:' + folderIdString);
          } else if (videos.length > 0 && !targetFolderIds.has(folderIdString)) {
            sourceFolders.push(sourceFolder);
            steps.push('api:favorite:scan-video-source:' + folderIdString);
          } else if (videos.length > 0 && !fallbackSourceFolder) {
            fallbackSourceFolder = sourceFolder;
          }
        }

        if (payload.aid && sourceFolders.length === 0 && fallbackSourceFolder) {
          sourceFolders.push(fallbackSourceFolder);
        }

        return {
          ok: true,
          sourceFolders,
          skippedSourceFolderTitles,
          targetMembership,
          scanDiagnostics,
          steps,
          missingTargets: [],
          message:
            skippedSourceFolderTitles.length === 0
              ? (payload.aid ? 'old favorite video refreshed' : 'old favorites scanned')
              : 'old favorites scanned; skipped ' + skippedSourceFolderTitles.length + ' folder' + (skippedSourceFolderTitles.length === 1 ? '' : 's') + ': ' + skippedSourceFolderTitles.slice(0, 3).join(', ')
        };
      } catch (error) {
        return {
          ok: false,
          sourceFolders: [],
          skippedSourceFolderTitles: [],
          targetMembership: {},
          steps,
          missingTargets: ['favorite-ledger-api'],
          message: 'old favorite scan failed: ' + (error instanceof Error ? error.message : String(error || 'unknown error'))
        };
      }
    })();
  `
}

export function buildExecuteFavoriteLedgerPlanScript(
  items: FavoriteLedgerPreviewItem[],
  pacingOptions: FavoriteLedgerExecutionPacingOptions = {}
): string {
  const payload = scriptPayload({
    items,
    pacing: {
      appendDelayMs: pacingOptions.appendDelayMs ?? { min: 1200, max: 3000 },
      cooldownDelayMs: pacingOptions.cooldownDelayMs ?? { min: 15000, max: 45000 },
      cooldownEvery: pacingOptions.cooldownEvery ?? 25
    }
  })

  return `
    (async () => {
      const payload = ${payload};
      ${sharedScriptHelpers()}
      const steps = [];
      const missingTargets = [];
      const appendFailures = [];
      const completedItems = [];
      let syncRequired = false;
      const syncRequiredMessage = '掌库和 B 站收藏夹不一致，请先同步掌库后再确认执行。';
      const protectionMessage = 'Bilibili may be protecting your account from high-frequency favorite changes. Old favorite organization is paused; wait a while, then continue with the remaining items.';
      const wait = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));
      const randomDelay = (range) => {
        const min = Math.max(0, Number(range?.min ?? 0));
        const max = Math.max(min, Number(range?.max ?? min));
        return Math.round(min + Math.random() * (max - min));
      };
      const isProtectionFailure = (message) =>
        /-509|request too fast|too many|rate|frequency|frequent|captcha|verify|protection|risk/i.test(String(message || ''));

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
        const protectionPausedResult = (item, index, message) => {
          appendFailures.push({ aid: item.aid, title: item.title, message });
          steps.push('api:ledger:protection-paused:' + item.aid);
          return {
            ok: false,
            steps,
            missingTargets: ['favorite-ledger-protection'],
            message: protectionMessage,
            paused: true,
            completedCount: completedItems.length,
            failedCount: appendFailures.length,
            remainingCount: executableItems.length - index - 1
          };
        };

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
        const paceBeforeNextItem = async (completedCount, hasNextItem) => {
          if (!hasNextItem || completedCount <= 0) {
            return;
          }

          const cooldownEvery = Math.max(1, Number(payload.pacing.cooldownEvery || 1));
          const shouldCooldown = completedCount % cooldownEvery === 0;
          const delayMs = randomDelay(shouldCooldown ? payload.pacing.cooldownDelayMs : payload.pacing.appendDelayMs);
          if (delayMs <= 0) {
            return;
          }

          steps.push((shouldCooldown ? 'api:ledger:cooldown:' : 'api:ledger:pace:') + delayMs);
          await wait(delayMs);
        };

        for (let index = 0; index < executableItems.length; index += 1) {
          const item = executableItems[index];
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
            completedItems.push(item);
            steps.push('api:ledger:append:' + item.aid);
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error || 'unknown error');
            if (isProtectionFailure(errorMessage)) {
              return protectionPausedResult(item, index, errorMessage);
            }

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
              completedItems.push(item);
              steps.push('api:ledger:append:' + item.aid);
            } catch (retryError) {
              const retryMessage = retryError instanceof Error ? retryError.message : String(retryError || '');
              if (isProtectionFailure(retryMessage)) {
                return protectionPausedResult(item, index, retryMessage);
              }

              appendFailures.push({ aid: item.aid, title: item.title, message: errorMessage });
              missingTargets.push('favorite-ledger-append:' + item.aid);
              steps.push('api:ledger:append-failed:' + item.aid);
            }
          }

          await paceBeforeNextItem(completedItems.length, index < executableItems.length - 1);
        }

        const appendCount = completedItems.length;
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
