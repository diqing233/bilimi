import { BILIMI_LEDGER_PREFIX, isBilimiManagedLedgerName, stripBilimiLedgerPrefix } from '@shared/favoriteLedgers'
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
  desiredTargetFolderIds?: string[]
  currentBilimiFolderIds?: string[]
  reorganizeProtected?: boolean
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

function normalizeLedgerDisplayName(displayName: string) {
  return isBilimiManagedLedgerName(displayName)
    ? `${BILIMI_LEDGER_PREFIX}${stripBilimiLedgerPrefix(displayName)}`
    : displayName.trim()
}

function normalizeLedgerPayload(ledgers: FavoriteLedger[]) {
  return ledgers.map((ledger) => ({
    ...ledger,
    displayName: normalizeLedgerDisplayName(ledger.displayName)
  }))
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
  const payload = scriptPayload({ ledgers: normalizeLedgerPayload(ledgers) })

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
  const payload = scriptPayload({ ledgers: normalizeLedgerPayload(ledgers) })

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
  const payload = scriptPayload({
    nextLedgers: normalizeLedgerPayload(nextLedgers),
    options,
    previousLedgers: normalizeLedgerPayload(previousLedgers)
  })

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

export function buildOldFavoriteTagEnrichmentScript(
  action: 'read' | 'pause' | 'resume' | 'cancel' | 'cancel-scan' = 'read'
): string {
  return `(async () => {
    const key = 'bilimi:old-favorite-tag-enrichment:v1';
    const currentAccountMid = document.cookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('DedeUserID='))
      ?.slice('DedeUserID='.length) || '';
    let store;
    try { store = JSON.parse(localStorage.getItem(key) || '{}'); } catch { store = {}; }
    store.cache = store.cache && typeof store.cache === 'object' ? store.cache : {};
    if (!currentAccountMid || store.accountMid !== currentAccountMid) {
      store = {
        ...(currentAccountMid ? { accountMid: currentAccountMid } : {}),
        cache: store.cache,
        queue: [],
        controlRevision: Number(store.controlRevision || 0) + 1,
        progress: { completed: 0, total: 0, pending: 0, cacheHits: 0, succeeded: 0, failed: 0, status: 'complete' }
      };
      localStorage.setItem(key, JSON.stringify(store));
    }
    store.queue = Array.isArray(store.queue)
      ? Array.from(new Set(store.queue.map(Number).filter((aid) => Number.isFinite(aid) && aid > 0)))
      : [];
    store.controlRevision = Number(store.controlRevision || 0);
    store.progress = store.progress && typeof store.progress === 'object' ? store.progress : {
      completed: 0, total: store.queue.length, pending: store.queue.length,
      cacheHits: 0, succeeded: 0, failed: 0, status: store.queue.length ? 'paused' : 'complete'
    };
    const normalizeProgress = () => {
      const nonNegativeInteger = (value) => Math.max(0, Math.floor(Number(value) || 0));
      const total = Math.max(nonNegativeInteger(store.progress.total), store.queue.length);
      const status = store.queue.length === 0
        ? 'complete'
        : store.progress.status === 'running'
          ? 'running'
          : 'paused';
      const pending = status === 'complete' ? 0 : Math.min(store.queue.length, total);
      store.progress = {
        ...store.progress,
        total,
        completed: Math.min(nonNegativeInteger(store.progress.completed), total - pending),
        pending,
        cacheHits: nonNegativeInteger(store.progress.cacheHits),
        succeeded: nonNegativeInteger(store.progress.succeeded),
        failed: nonNegativeInteger(store.progress.failed),
        status
      };
    };
    normalizeProgress();
    const readTagList = (rawTags) => (Array.isArray(rawTags) ? rawTags : [])
      .map((tag) => String(typeof tag === 'string' ? tag : (tag?.name ?? tag?.tag_name ?? tag?.title ?? '')).trim())
      .filter(Boolean)
      .slice(0, 20);
    const writeStore = () => {
      normalizeProgress();
      localStorage.setItem(key, JSON.stringify(store));
    };
    const fetchWithTimeout = async (url, timeoutMs = 10000) => {
      const controller = new AbortController();
      let timeoutId;
      try {
        return await Promise.race([
          fetch(url, { credentials: 'include', signal: controller.signal }),
          new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
              controller.abort();
              reject(new Error('tag request timeout'));
            }, timeoutMs);
          })
        ]);
      } finally {
        clearTimeout(timeoutId);
      }
    };
    const startWorker = () => {
      if (window.__bilimiOldFavoriteTagWorkerRunning || !store.queue.length || store.progress.status === 'paused') return;
      window.__bilimiOldFavoriteTagWorkerRunning = true;
      void (async () => {
        let activeAid = null;
        let activeAidFailures = 0;
        while (true) {
          try { store = JSON.parse(localStorage.getItem(key) || '{}'); } catch { break; }
          if (!Array.isArray(store.queue) || !store.queue.length || store.progress?.status === 'paused') break;
          const aid = store.queue[0];
          if (activeAid !== aid) {
            activeAid = aid;
            activeAidFailures = 0;
          }
          const requestRevision = store.controlRevision;
          try {
            await new Promise((resolve) => setTimeout(resolve, 650 + Math.floor(Math.random() * 350)));
            const url = new URL('https://api.bilibili.com/x/tag/archive/tags');
            url.searchParams.set('aid', String(aid));
            const response = await fetchWithTimeout(url.toString());
            const json = await response.json();
            if (!response.ok || Number(json?.code) !== 0) throw new Error(String(json?.code ?? response.status));
            const tags = readTagList(Array.isArray(json.data) ? json.data : json.data?.tags);
            let controlledStore;
            try { controlledStore = JSON.parse(localStorage.getItem(key) || '{}'); } catch { controlledStore = store; }
            if (Number(controlledStore.controlRevision || 0) !== requestRevision) {
              controlledStore.cache = controlledStore.cache && typeof controlledStore.cache === 'object' ? controlledStore.cache : {};
              controlledStore.cache[String(aid)] = { tags, updatedAt: Date.now() };
              localStorage.setItem(key, JSON.stringify(controlledStore));
              store = controlledStore;
              break;
            }
            store.cache = store.cache && typeof store.cache === 'object' ? store.cache : {};
            store.cache[String(aid)] = { tags, updatedAt: Date.now() };
            store.queue.shift();
            store.progress.completed = Math.max(store.progress.completed, store.progress.total - store.queue.length);
            store.progress.pending = store.queue.length;
            store.progress.succeeded += 1;
            store.progress.status = store.queue.length ? 'running' : 'complete';
            activeAid = null;
            activeAidFailures = 0;
            writeStore();
          } catch (error) {
            let controlledStore;
            try { controlledStore = JSON.parse(localStorage.getItem(key) || '{}'); } catch { controlledStore = store; }
            if (Number(controlledStore.controlRevision || 0) !== Number(requestRevision || 0)) {
              store = controlledStore;
              break;
            }
            activeAidFailures += 1;
            const message = String(error?.message || error || '');
            if (/(-352|-412|-509|risk|频繁|风控|too fast)/i.test(message)) {
              store.progress.status = 'paused';
              writeStore();
              break;
            }
            if (activeAidFailures >= 3) {
              store.queue.shift();
              store.progress.completed = Math.max(store.progress.completed, store.progress.total - store.queue.length);
              store.progress.pending = store.queue.length;
              store.progress.failed += 1;
              store.progress.status = store.queue.length ? 'running' : 'complete';
              activeAid = null;
              activeAidFailures = 0;
              writeStore();
              continue;
            }
            writeStore();
            await new Promise((resolve) => setTimeout(resolve, Math.min(8000, 750 * (2 ** activeAidFailures))));
          }
        }
        window.__bilimiOldFavoriteTagWorkerRunning = false;
      })();
    };
    window.__bilimiStartOldFavoriteTagWorker = startWorker;
    if (${JSON.stringify(action)} === 'pause') {
      store.controlRevision += 1;
      store.progress.status = 'paused';
    }
    if (${JSON.stringify(action)} === 'resume' && store.queue.length) {
      store.controlRevision += 1;
      store.progress.status = 'running';
    }
    if (${JSON.stringify(action)} === 'cancel') {
      store.controlRevision += 1;
      store.queue = [];
      store.progress.pending = 0;
      store.progress.status = 'complete';
    }
    if (${JSON.stringify(action)} === 'cancel-scan') {
      store.controlRevision += 1;
      store.scanCancelled = true;
      store.queue = [];
      store.progress.pending = 0;
      store.progress.status = 'complete';
      store.lastScan = {
        ...(store.lastScan || {}),
        basic: { completed: 0, total: 0, status: 'cancelled' }
      };
    }
    writeStore();
    if (${JSON.stringify(action)} === 'resume') startWorker();
    const sourceFolders = (store.lastScan?.sourceFolders || []).map((folder) => ({
      ...folder,
      videos: (folder.videos || []).map((video) => ({
        ...video,
        tags: Array.isArray(store.cache[String(video.aid)]?.tags)
          ? store.cache[String(video.aid)].tags
          : (video.tags || [])
      }))
    }));
    return {
      accountMid: currentAccountMid,
      sourceFolders,
      scanProgress: {
        basic: store.lastScan?.basic || { completed: 0, total: 0, status: 'complete' },
        tags: store.progress
      }
    };
  })()`
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
        const normalizedLedgerName = (value) => String(value ?? '').trim().replace(/^bilimi[·\\s\\-路]*/i, '').trim();
        const ledgerByFolderId = new Map(
          payload.ledgers
            .filter((ledger) => ledger.bilibiliFolderId)
            .map((ledger) => [String(ledger.bilibiliFolderId), ledger])
        );
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
        const managedFolders = folders
          .map((folder) => {
            const id = findFolderId(folder);
            const title = String(folder?.title ?? '');
            if (!id || !/^bilimi[·\\s\\-路]*/i.test(title.trim())) {
              return null;
            }
            const idString = String(id);
            const ledger = ledgerByFolderId.get(idString) ?? payload.ledgers.find(
              (candidate) => normalizedLedgerName(candidate.displayName) === normalizedLedgerName(title)
            );
            return {
              id: idString,
              title,
              ledgerId: ledger?.id,
              isInbox: ledger?.id === 'inbox' || /待分类|暂存/.test(normalizedLedgerName(title))
            };
          })
          .filter(Boolean);
        const managedFolderIds = new Set(managedFolders.map((folder) => folder.id));
        let managedFolderScanComplete = true;
        const scanDiagnostics = {
          tagDetailRequests: 0,
          tagDetailFailures: 0,
          taggedVideos: 0,
          untaggedVideos: 0,
          folderFailures: []
        };
        const tagStoreKey = 'bilimi:old-favorite-tag-enrichment:v1';
        const tagCacheMaxAgeMs = 30 * 24 * 60 * 60 * 1000;
        const readTagStore = () => {
          try {
            const parsed = JSON.parse(localStorage.getItem(tagStoreKey) || '{}');
            return {
              ...parsed,
              cache: parsed.cache && typeof parsed.cache === 'object' ? parsed.cache : {},
              queue: Array.isArray(parsed.queue) ? parsed.queue.map(Number).filter(Number.isFinite) : [],
              progress: parsed.progress && typeof parsed.progress === 'object' ? parsed.progress : {}
            };
          } catch {
            return { cache: {}, queue: [], progress: {} };
          }
        };
        const writeTagStore = (store) => localStorage.setItem(tagStoreKey, JSON.stringify(store));
        const tagStore = readTagStore();
        if (tagStore.accountMid !== String(mid)) {
          const reusableCache = tagStore.cache;
          Object.keys(tagStore).forEach((key) => delete tagStore[key]);
          tagStore.accountMid = String(mid);
          tagStore.cache = reusableCache;
          tagStore.queue = [];
          tagStore.progress = { completed: 0, total: 0, pending: 0, cacheHits: 0, succeeded: 0, failed: 0, status: 'complete' };
        }
        tagStore.accountMid = String(mid);
        if (!payload.aid) {
          tagStore.controlRevision = Number(tagStore.controlRevision || 0) + 1;
          tagStore.scanCancelled = false;
          tagStore.queue = [];
          tagStore.progress = { ...(tagStore.progress || {}), pending: 0, status: 'paused' };
          writeTagStore(tagStore);
        }
        const missingTagAids = new Set();
        const cacheHitAids = new Set();
        const discoveredVideoAids = new Set();
        const persistBasicProgress = (status = 'running') => {
          const latest = readTagStore();
          latest.lastScan = {
            ...(latest.lastScan ?? {}),
            sourceFolders: latest.lastScan?.sourceFolders ?? [],
            basic: {
              completed: discoveredVideoAids.size,
              total: Math.max(discoveredVideoAids.size, Number(latest.lastScan?.basic?.total || 0)),
              status
            }
          };
          writeTagStore(latest);
        };
        const scanWasCancelled = () => Boolean(readTagStore().scanCancelled);
        if (!payload.aid) persistBasicProgress();
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
        let lastInitialTagRequestAt = 0;
        const paceInitialTagRequest = async () => {
          const elapsed = Date.now() - lastInitialTagRequestAt;
          if (lastInitialTagRequestAt > 0 && elapsed < 120) await wait(120 - elapsed);
          lastInitialTagRequestAt = Date.now();
        };
        const readQueuedTagList = (rawTags) => (Array.isArray(rawTags) ? rawTags : [])
          .map((tag) => String(typeof tag === 'string' ? tag : (tag?.name ?? tag?.tag_name ?? tag?.title ?? '')).trim())
          .filter(Boolean)
          .slice(0, 20);
        const fetchWithTimeout = async (url, timeoutMs = 10000) => {
          const controller = new AbortController();
          let timeoutId;
          try {
            return await Promise.race([
              fetch(url, { credentials: 'include', signal: controller.signal }),
              new Promise((_, reject) => {
                timeoutId = setTimeout(() => {
                  controller.abort();
                  reject(new Error('request timeout'));
                }, timeoutMs);
              })
            ]);
          } finally {
            clearTimeout(timeoutId);
          }
        };
        const readFolderVideos = async (folderId, onPageComplete = () => undefined) => {
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
          const cachedTags = (aid) => {
            const cached = tagStore.cache[String(aid)];
            if (!cached || !Array.isArray(cached.tags) || Date.now() - Number(cached.updatedAt || 0) > tagCacheMaxAgeMs) {
              return null;
            }
            cacheHitAids.add(Number(aid));
            return readTagList(cached.tags);
          };
          const fetchTagsNow = async (aid) => {
            scanDiagnostics.tagDetailRequests += 1;
            try {
              const response = await fetch(buildTagUrl(aid), { credentials: 'include' });
              const json = await ensureApiOk(response, 'video tag list for ' + aid);
              const rawTags = Array.isArray(json.data) ? json.data : (Array.isArray(json.data?.tags) ? json.data.tags : []);
              const nextTags = readTagList(rawTags);
              tagStore.cache[String(aid)] = { tags: nextTags, updatedAt: Date.now() };
              return nextTags;
            } catch {
              scanDiagnostics.tagDetailFailures += 1;
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
            if (!payload.aid && scanWasCancelled()) throw new Error('old favorite scan cancelled');
            let json;
            let lastError;
            for (let attempt = 1; attempt <= 3; attempt += 1) {
              try {
                const response = await fetchWithTimeout(buildResourceUrl(folderId, page));
                json = await ensureApiOk(response, 'favorite resource list for folder ' + folderId);
                break;
              } catch (error) {
                lastError = error;
                if (attempt < 3) await wait(40 * attempt);
              }
            }
            if (!json) throw lastError || new Error('favorite resource list failed');
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
              const cached = tags.length > 0 ? null : cachedTags(aid);
              const resolvedTags = tags.length > 0
                ? tags
                : payload.aid
                  ? await fetchTagsNow(aid)
                  : (cached ?? []);
              if (!payload.aid && tags.length === 0 && cached === null) {
                missingTagAids.add(aid);
              }
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
              discoveredVideoAids.add(aid);
            }
            videos.push(...pageVideos);
            onPageComplete(page);

            if (!json.data?.has_more || medias.length === 0) {
              break;
            }

            page += 1;
          }

          return videos;
        };

        for (const folder of folders) {
          if (!payload.aid && scanWasCancelled()) {
            return {
              ok: false,
              cancelled: true,
              sourceFolders: [],
              skippedSourceFolderTitles: [],
              targetMembership: {},
              steps: [...steps, 'api:favorite:scan-cancelled'],
              missingTargets: [],
              message: 'old favorite scan cancelled'
            };
          }
          const folderId = findFolderId(folder);
          if (!folderId) {
            continue;
          }

          const folderIdString = String(folderId);
          let videos = [];
          try {
            videos = await readFolderVideos(folderIdString, (page) => {
              if (!payload.aid) {
                persistBasicProgress();
              }
            });
          } catch (error) {
            if (managedFolderIds.has(folderIdString)) {
              managedFolderScanComplete = false;
            }
            skippedSourceFolderTitles.push(String(folder?.title ?? folderIdString));
            scanDiagnostics.folderFailures.push({
              folderTitle: String(folder?.title ?? folderIdString),
              message: String(error?.message || error || 'unknown error').slice(0, 160)
            });
            steps.push('api:favorite:scan-source-failed:' + folderIdString);
            if (!payload.aid) persistBasicProgress();
            continue;
          }

          if (managedFolderIds.has(folderIdString)) {
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
          if (!payload.aid) persistBasicProgress();
        }

        if (payload.aid && sourceFolders.length === 0 && fallbackSourceFolder) {
          sourceFolders.push(fallbackSourceFolder);
        }

        const uniqueVideos = new Map();
        const knownTagsByAid = new Map();
        for (const folder of sourceFolders) {
          for (const video of folder.videos) {
            if (!uniqueVideos.has(video.aid)) uniqueVideos.set(video.aid, video);
            if (Array.isArray(video.tags) && video.tags.length > 0) knownTagsByAid.set(video.aid, video.tags);
          }
        }
        const applyTagsToSourceFolders = (aid, tags) => {
          for (const folder of sourceFolders) {
            for (const video of folder.videos) {
              if (video.aid === aid) video.tags = tags;
            }
          }
        };
        for (const [aid, tags] of knownTagsByAid) applyTagsToSourceFolders(aid, tags);
        const queuedAids = Array.from(missingTagAids).filter(
          (aid) => !knownTagsByAid.has(aid) && !cacheHitAids.has(aid)
        );
        const initiallyCompletedTagAids = new Set(
          Array.from(knownTagsByAid.keys())
        );
        for (const aid of cacheHitAids) initiallyCompletedTagAids.add(aid);
        tagStore.queue = queuedAids;
        tagStore.lastScan = {
          sourceFolders,
          basic: {
            completed: uniqueVideos.size,
            total: uniqueVideos.size,
            status: 'complete'
          }
        };
        tagStore.progress = {
          completed: initiallyCompletedTagAids.size,
          total: uniqueVideos.size,
          pending: queuedAids.length,
          cacheHits: cacheHitAids.size,
          succeeded: 0,
          failed: 0,
          status: queuedAids.length > 0 ? 'running' : 'complete'
        };
        writeTagStore(tagStore);

        if (!payload.aid) {
          persistBasicProgress('complete');
        }
        const finalUniqueVideos = new Map();
        for (const folder of sourceFolders) {
          for (const video of folder.videos) {
            if (!finalUniqueVideos.has(video.aid)) finalUniqueVideos.set(video.aid, video);
          }
        }
        scanDiagnostics.taggedVideos = Array.from(finalUniqueVideos.values()).filter(
          (video) => Array.isArray(video.tags) && video.tags.length > 0
        ).length;
        scanDiagnostics.untaggedVideos = finalUniqueVideos.size - scanDiagnostics.taggedVideos;

        window.__bilimiStartOldFavoriteTagWorker = () => {
          if (window.__bilimiOldFavoriteTagWorkerRunning) return;
          const latestStore = readTagStore();
          if (!latestStore.queue.length || latestStore.progress?.status === 'paused') return;
          window.__bilimiOldFavoriteTagWorkerRunning = true;
          void (async () => {
            let consecutiveFailures = 0;
            while (latestStore.queue.length > 0) {
              const persisted = readTagStore();
              if (persisted.progress?.status === 'paused') break;
              Object.assign(latestStore, persisted);
              const aid = latestStore.queue[0];
              const requestRevision = Number(latestStore.controlRevision || 0);
              try {
                await wait(650 + Math.floor(Math.random() * 350));
                const response = await fetchWithTimeout(buildTagUrl(aid));
                const json = await ensureApiOk(response, 'video tag list for ' + aid);
                const rawTags = Array.isArray(json.data) ? json.data : (Array.isArray(json.data?.tags) ? json.data.tags : []);
                const controlledStore = readTagStore();
                const nextTags = readQueuedTagList(rawTags);
                if (Number(controlledStore.controlRevision || 0) !== requestRevision) {
                  controlledStore.cache[String(aid)] = { tags: nextTags, updatedAt: Date.now() };
                  writeTagStore(controlledStore);
                  Object.assign(latestStore, controlledStore);
                  break;
                }
                latestStore.cache[String(aid)] = { tags: nextTags, updatedAt: Date.now() };
                latestStore.queue.shift();
                latestStore.progress.completed += 1;
                latestStore.progress.pending = latestStore.queue.length;
                latestStore.progress.succeeded += 1;
                consecutiveFailures = 0;
              } catch (error) {
                const controlledStore = readTagStore();
                if (Number(controlledStore.controlRevision || 0) !== requestRevision) {
                  Object.assign(latestStore, controlledStore);
                  break;
                }
                consecutiveFailures += 1;
                latestStore.progress.failed += 1;
                const message = String(error?.message || error || '');
                if (/(-352|-412|-509|risk|频繁|风控|too fast)/i.test(message) || consecutiveFailures >= 3) {
                  latestStore.progress.status = 'paused';
                  writeTagStore(latestStore);
                  break;
                }
                latestStore.queue.push(latestStore.queue.shift());
                await wait(Math.min(8000, 750 * (2 ** consecutiveFailures)));
              }
              latestStore.progress.status = latestStore.queue.length > 0 ? 'running' : 'complete';
              writeTagStore(latestStore);
            }
            window.__bilimiOldFavoriteTagWorkerRunning = false;
          })();
        };
        return {
          ok: true,
          accountMid: String(mid),
          sourceFolders,
          skippedSourceFolderTitles,
          targetMembership,
          managedFolders,
          managedFolderScanComplete,
          scanDiagnostics,
          scanProgress: {
            basic: {
              completed: uniqueVideos.size,
              total: uniqueVideos.size,
              status: 'complete'
            },
            tags: tagStore.progress
          },
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

        const changeItemFolders = async (item, addFolderIds, removeFolderIds) => {
          const body = new URLSearchParams();
          body.set('add_media_ids', addFolderIds.join(','));
          body.set('csrf', csrf);
          body.set('del_media_ids', removeFolderIds.join(','));
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
        const appendItem = async (item, targetFolderId) =>
          changeItemFolders(item, [String(targetFolderId)], []);
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
          if (item.reorganizeProtected && Array.isArray(item.desiredTargetFolderIds)) {
            const desiredFolderIds = Array.from(new Set(item.desiredTargetFolderIds.map(String).filter(Boolean)));
            const currentFolderIds = Array.from(new Set((item.currentBilimiFolderIds ?? []).map(String).filter(Boolean)));
            if (desiredFolderIds.length === 0) {
              continue;
            }
            const addedFolderIds = desiredFolderIds.filter((folderId) => !currentFolderIds.includes(folderId));
            const removedFolderIds = currentFolderIds.filter((folderId) => !desiredFolderIds.includes(folderId));
            try {
              for (const folderId of addedFolderIds) {
                await appendItem(item, folderId);
                steps.push('api:ledger:append:' + item.aid + ':' + folderId);
              }
              if (removedFolderIds.length > 0) {
                await changeItemFolders(item, [], removedFolderIds);
                steps.push('api:ledger:remove:' + item.aid);
              }
              completedItems.push({
                ...item,
                finalFolderIds: desiredFolderIds,
                addedFolderIds,
                removedFolderIds
              });
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error || 'unknown error');
              if (isProtectionFailure(errorMessage)) {
                return protectionPausedResult(item, index, errorMessage);
              }
              const partial = addedFolderIds.length > 0 && steps.some((step) => step.startsWith('api:ledger:append:' + item.aid + ':'));
              appendFailures.push({ aid: item.aid, title: item.title, message: errorMessage, partial });
              missingTargets.push('favorite-ledger-reconcile:' + item.aid);
              steps.push('api:ledger:reconcile-failed:' + item.aid);
            }
            await paceBeforeNextItem(completedItems.length, index < executableItems.length - 1);
            continue;
          }
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
            completedItems.push({ ...item, targetFolderId: String(targetFolderId) });
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
              completedItems.push({ ...item, targetFolderId: String(refreshedFolderId) });
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
            partial: appendFailures.some((failure) => failure.partial),
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
          completedItems,
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
