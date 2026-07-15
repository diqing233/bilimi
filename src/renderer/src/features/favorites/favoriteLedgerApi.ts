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
    const createApiError = (message, metadata = {}) => Object.assign(new Error(message), {
      bilimiApiError: true,
      ...metadata
    });
    const responseDiagnostics = (response) => {
      let finalUrl = '';
      try {
        const parsed = new URL(String(response?.url || ''));
        if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
          const trustedBilibiliHost = parsed.hostname === 'bilibili.com' || parsed.hostname.endsWith('.bilibili.com');
          finalUrl = parsed.origin + (trustedBilibiliHost ? parsed.pathname : '');
        }
      } catch {}
      return {
        httpStatus: Number(response?.status || 0),
        contentType: String(response?.headers?.get?.('content-type') || '').slice(0, 120),
        finalUrl,
        redirected: Boolean(response?.redirected)
      };
    };
    const ensureApiOk = async (response, label = 'Bilibili API') => {
      const contentType = response.headers?.get?.('content-type') || '';
      const bodyText = await response.text();
      const trimmedBody = bodyText.trim();
      if (/html/i.test(contentType) || /^<!doctype html/i.test(trimmedBody) || /^<html/i.test(trimmedBody)) {
        const diagnostics = responseDiagnostics(response);
        const loginSignal = /\\/(?:login|passport)(?:\\/|$)/i.test(diagnostics.finalUrl) ||
          /^https?:\\/\\/passport\\.bilibili\\.com(?:\\/|$)/i.test(diagnostics.finalUrl);
        const riskSignal = /captcha|risk|访问频繁|风控|安全验证|异常请求/i.test(trimmedBody);
        throw createApiError(label + ' returned HTML instead of JSON. Please log in to Bilibili again or retry later.', {
          kind: 'html', ...diagnostics, loginSignal, riskSignal
        });
      }

      let json = null;
      try {
        json = bodyText ? JSON.parse(bodyText) : null;
      } catch {
        throw createApiError(label + ' returned a non-JSON response.', {
          kind: 'non-json', ...responseDiagnostics(response)
        });
      }

      if (!response.ok || !json || json.code !== 0) {
        const apiCode = Number(json?.code);
        const httpStatus = Number(response?.status || 0);
        throw createApiError(label + ' failed: ' + (json?.message || response.statusText || 'Bilibili API request failed'), {
          kind: !response.ok ? 'http' : 'api',
          ...responseDiagnostics(response),
          apiCode,
          loginSignal: apiCode === -101,
          riskSignal: [403, 412].includes(httpStatus) || [-352, -509].includes(apiCode)
        });
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
      const invalidNameLedgers = payload.ledgers.filter(
        (ledger) => ledger.enabled && Array.from(String(ledger.displayName || '')).length > 20
      );
      if (invalidNameLedgers.length > 0) {
        return {
          ok: false,
          ledgers: payload.ledgers,
          steps: [],
          missingTargets: invalidNameLedgers.map((ledger) => ledger.id),
          message: '收藏夹名称不能超过 20 个字'
        };
      }
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
      const invalidNameLedgers = payload.nextLedgers.filter(
        (ledger) => ledger.enabled && Array.from(String(ledger.displayName || '')).length > 20
      );
      if (invalidNameLedgers.length > 0) {
        return {
          ok: false,
          ledgers: payload.nextLedgers,
          steps: [],
          missingTargets: invalidNameLedgers.map((ledger) => ledger.id),
          message: '收藏夹名称不能超过 20 个字'
        };
      }
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

export type OldFavoriteBatchCursor = {
  accountMid: string
  folderId: string
  nextPage: number
  folderOrder: string[]
}

export type OldFavoriteBatchCommitToken = {
  version: 1
  accountMid: string
  scanRunId: string
  folderOrder: string[]
  expectedCurrentCursor: OldFavoriteBatchCursor | null
  nextCursor: OldFavoriteBatchCursor | null
  seenAids: number[]
}

export function buildOldFavoriteTagEnrichmentScript(
  action: 'read' | 'progress' | 'pause' | 'resume' | 'cancel' | 'cancel-scan' = 'read'
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
        cache: {},
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
    const progressBeforeNormalization = JSON.stringify(store.progress);
    normalizeProgress();
    const progressWasNormalized = JSON.stringify(store.progress) !== progressBeforeNormalization;
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
            const contentType = String(response.headers.get('content-type') || '').toLowerCase();
            const bodyText = await response.text();
            if (contentType.includes('text/html') || /^\s*<!doctype html|^\s*<html/i.test(bodyText)) {
              throw Object.assign(new Error('tag request returned HTML; please log in again'), { global: true });
            }
            let json;
            try { json = bodyText ? JSON.parse(bodyText) : null; } catch {
              throw Object.assign(new Error('tag request returned invalid JSON'), { global: true });
            }
            const code = Number(json?.code);
            if (!response.ok || code !== 0) {
              const message = String(json?.message || code || response.status);
              throw Object.assign(new Error(message), {
                global: [-101, -352, -412, -509].includes(code) || /risk|频繁|风控|too fast|login|未登录/i.test(message)
              });
            }
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
            if (error?.global || /(-101|-352|-412|-509|risk|频繁|风控|too fast|login|未登录)/i.test(message)) {
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
        let handoffStore;
        try { handoffStore = JSON.parse(localStorage.getItem(key) || '{}'); } catch { handoffStore = {}; }
        if (handoffStore.progress?.status === 'running' && Array.isArray(handoffStore.queue) && handoffStore.queue.length > 0) {
          setTimeout(() => {
            if (!window.__bilimiOldFavoriteTagWorkerRunning) window.__bilimiStartOldFavoriteTagWorker?.();
          }, 0);
        }
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
      if (window.__bilimiOldFavoriteScanControl) {
        window.__bilimiOldFavoriteScanControl.cancelled = true;
      }
      store.queue = [];
      store.progress.pending = 0;
      store.progress.status = 'complete';
      store.lastScan = {
        ...(store.lastScan || {}),
        basic: { ...(store.lastScan?.basic || {}), status: 'cancelled', phase: 'cancelled' }
      };
    }
    if (${JSON.stringify(action)} !== 'progress' || progressWasNormalized) writeStore();
    if (${JSON.stringify(action)} === 'resume') startWorker();
    const sourceFolders = ${JSON.stringify(action)} === 'progress' ? [] : (store.lastScan?.sourceFolders || []).map((folder) => ({
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

export function buildCommitOldFavoriteBatchCheckpointScript(
  token: OldFavoriteBatchCommitToken
): string {
  return `(async () => {
    ${sharedScriptHelpers()}
    const token = ${scriptPayload(token)};
    const tagStoreKey = 'bilimi:old-favorite-tag-enrichment:v1';
    const batchStatusKey = 'bilimi:old-favorite-batch-status:v1';
    const stale = (code, message) => ({ ok: false, committed: false, stale: true, code, message });
    const sameStrings = (left, right) =>
      Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length && left.every((value, index) => String(value) === String(right[index]));
    const normalizeCursor = (cursor) => {
      if (!cursor || typeof cursor !== 'object') return null;
      const accountMid = String(cursor.accountMid ?? '');
      const folderId = String(cursor.folderId ?? '');
      const nextPage = Math.max(1, Math.floor(Number(cursor.nextPage) || 0));
      const folderOrder = Array.isArray(cursor.folderOrder) ? cursor.folderOrder.map(String) : [];
      return accountMid && folderId && nextPage > 0 && folderOrder.length > 0
        ? { accountMid, folderId, nextPage, folderOrder }
        : null;
    };
    const sameCursor = (left, right) => {
      const normalizedLeft = normalizeCursor(left);
      const normalizedRight = normalizeCursor(right);
      if (!normalizedLeft || !normalizedRight) return normalizedLeft === normalizedRight;
      return normalizedLeft.accountMid === normalizedRight.accountMid &&
        normalizedLeft.folderId === normalizedRight.folderId &&
        normalizedLeft.nextPage === normalizedRight.nextPage &&
        sameStrings(normalizedLeft.folderOrder, normalizedRight.folderOrder);
    };
    const { mid } = readCredentials();
    if (!mid) return stale('account-missing', 'Bilibili account is not signed in.');
    if (
      token?.version !== 1 ||
      String(token.accountMid ?? '') !== String(mid) ||
      !String(token.scanRunId ?? '') ||
      !Array.isArray(token.folderOrder) ||
      !Array.isArray(token.seenAids)
    ) return stale('token-invalid', 'Old favorite batch checkpoint token is invalid.');

    let store;
    try {
      store = JSON.parse(localStorage.getItem(tagStoreKey) || '{}');
    } catch {
      return stale('store-invalid', 'Old favorite batch checkpoint store is invalid.');
    }
    if (String(store.accountMid ?? '') !== String(mid)) {
      return stale('account-stale', 'Old favorite batch checkpoint account changed.');
    }
    const latestBasic = store.lastScan?.basic;
    if (
      latestBasic?.status !== 'complete' ||
      String(latestBasic?.runId ?? '') !== String(token.scanRunId)
    ) return stale('run-stale', 'Old favorite batch checkpoint scan run changed.');
    const latestFolderOrder = store.lastScan?.batch?.folderOrder;
    if (!sameStrings(latestFolderOrder, token.folderOrder)) {
      return stale('folder-order-stale', 'Old favorite folder order changed.');
    }

    const expectedCursor = normalizeCursor(token.expectedCurrentCursor);
    const nextCursor = normalizeCursor(token.nextCursor);
    if (token.expectedCurrentCursor && !expectedCursor) {
      return stale('token-invalid', 'Old favorite expected checkpoint cursor is invalid.');
    }
    if (token.nextCursor && !nextCursor) {
      return stale('token-invalid', 'Old favorite next checkpoint cursor is invalid.');
    }
    for (const cursor of [expectedCursor, nextCursor].filter(Boolean)) {
      if (
        cursor.accountMid !== String(mid) ||
        !sameStrings(cursor.folderOrder, token.folderOrder)
      ) return stale('token-invalid', 'Old favorite checkpoint cursor does not match its token.');
    }

    const seenAids = Array.from(new Set(
      token.seenAids.map(Number).filter((aid) => Number.isFinite(aid) && aid > 0)
    ));
    if (seenAids.length !== new Set(token.seenAids.map(Number)).size) {
      return stale('token-invalid', 'Old favorite checkpoint aids are invalid.');
    }
    const currentCursor = normalizeCursor(store.batchCursor);
    const currentSeenAids = new Set(
      (Array.isArray(store.batchSeenAids) ? store.batchSeenAids : [])
        .map(Number)
        .filter((aid) => Number.isFinite(aid) && aid > 0)
    );
    const alreadyContainsBatch = seenAids.every((aid) => currentSeenAids.has(aid));
    const exhausted = token.nextCursor === null;
    const exhaustedMarkerMatches = exhausted &&
      String(store.batchExhausted?.accountMid ?? '') === String(mid) &&
      String(store.batchExhausted?.scanRunId ?? '') === String(token.scanRunId) &&
      sameStrings(store.batchExhausted?.folderOrder, token.folderOrder);
    const alreadyCommitted = alreadyContainsBatch && (
      exhausted ? exhaustedMarkerMatches && currentCursor === null : sameCursor(currentCursor, nextCursor)
    );
    if (alreadyCommitted) {
      localStorage.removeItem(batchStatusKey);
      return { ok: true, committed: true, idempotent: true, exhausted };
    }
    if (!sameCursor(currentCursor, expectedCursor)) {
      return stale('cursor-stale', 'Old favorite batch checkpoint cursor changed.');
    }

    const nextStore = {
      ...store,
      batchSeenAids: Array.from(new Set([...currentSeenAids, ...seenAids]))
    };
    if (exhausted) {
      delete nextStore.batchCursor;
      nextStore.batchExhausted = {
        accountMid: String(mid),
        scanRunId: String(token.scanRunId),
        folderOrder: token.folderOrder.map(String)
      };
    } else {
      nextStore.batchCursor = nextCursor;
      delete nextStore.batchExhausted;
    }
    localStorage.setItem(tagStoreKey, JSON.stringify(nextStore));
    localStorage.removeItem(batchStatusKey);
    return { ok: true, committed: true, idempotent: false, exhausted };
  })()`
}

export function buildReadOldFavoriteBatchStatusScript(): string {
  return `(() => {
    ${sharedScriptHelpers()}
    const { mid } = readCredentials();
    if (!mid) return { pending: false };
    let status;
    try {
      status = JSON.parse(localStorage.getItem('bilimi:old-favorite-batch-status:v1') || '{}');
    } catch {
      return { pending: false };
    }
    return {
      pending: String(status.accountMid ?? '') === String(mid) &&
        Boolean(String(status.scanRunId ?? ''))
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

        const tagStoreKey = 'bilimi:old-favorite-tag-enrichment:v1';
        let recoveringPendingBatch = false;
        if (!payload.aid) {
          try {
            const pendingBatch = JSON.parse(localStorage.getItem('bilimi:old-favorite-batch-status:v1') || '{}');
            recoveringPendingBatch = String(pendingBatch.accountMid ?? '') === String(mid) &&
              Boolean(String(pendingBatch.scanRunId ?? ''));
          } catch {}
        }
        let scanRevision = 0;
        let scanRunId = '';
        let scanControl = null;
        if (!payload.aid) {
          let initialStore;
          try { initialStore = JSON.parse(localStorage.getItem(tagStoreKey) || '{}'); } catch { initialStore = {}; }
          if (initialStore.accountMid !== String(mid)) {
            initialStore = {
              accountMid: String(mid),
              cache: initialStore.cache && typeof initialStore.cache === 'object' ? initialStore.cache : {},
              queue: [],
              progress: { completed: 0, total: 0, pending: 0, cacheHits: 0, succeeded: 0, failed: 0, status: 'paused' }
            };
          }
          scanRevision = Number(initialStore.controlRevision || 0) + 1;
          scanRunId = String(Date.now()) + ':' + scanRevision + ':' + Math.random().toString(36).slice(2);
          initialStore.accountMid = String(mid);
          initialStore.controlRevision = scanRevision;
          initialStore.scanCancelled = false;
          initialStore.queue = [];
          initialStore.progress = { ...(initialStore.progress || {}), pending: 0, status: 'paused' };
          initialStore.lastScan = {
            sourceFolders: [],
            basic: { completed: 0, total: 0, status: 'running', runId: scanRunId, phase: 'listing' }
          };
          localStorage.setItem(tagStoreKey, JSON.stringify(initialStore));
          scanControl = { revision: scanRevision, cancelled: false };
          window.__bilimiOldFavoriteScanControl = scanControl;
        }
        const scanControlWasCancelled = () => {
          if (payload.aid) return false;
          return Boolean(scanControl?.cancelled) || window.__bilimiOldFavoriteScanControl !== scanControl;
        };

        const fetchJsonWithTimeout = async (url, label, timeoutMs = 10000, shouldCancel = () => false) => {
          const controller = new AbortController();
          let timeoutId;
          let cancelIntervalId;
          try {
            return await Promise.race([
              (async () => {
                const response = await fetch(url, { credentials: 'include', signal: controller.signal });
                return ensureApiOk(response, label);
              })(),
              new Promise((_, reject) => {
                timeoutId = setTimeout(() => {
                  controller.abort();
                  reject(new Error('request timeout'));
                }, timeoutMs);
              }),
              new Promise((_, reject) => {
                cancelIntervalId = setInterval(() => {
                  if (!shouldCancel()) return;
                  controller.abort();
                  reject(createApiError('scan cancelled', { kind: 'cancelled' }));
                }, 50);
              })
            ]);
          } finally {
            clearTimeout(timeoutId);
            clearInterval(cancelIntervalId);
          }
        };
        let listJson;
        try {
          listJson = await fetchJsonWithTimeout(buildListUrl(mid), 'favorite folder list', 10000, scanControlWasCancelled);
        } catch (error) {
          if (error?.kind === 'cancelled' || scanControlWasCancelled()) {
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
          if (!payload.aid) {
            let failedStore;
            try { failedStore = JSON.parse(localStorage.getItem(tagStoreKey) || '{}'); } catch { failedStore = {}; }
            if (Number(failedStore.controlRevision || 0) === scanRevision && !failedStore.scanCancelled) {
              failedStore.lastScan = {
                ...(failedStore.lastScan || {}),
                basic: { ...(failedStore.lastScan?.basic || {}), status: 'failed', phase: 'failed' }
              };
              localStorage.setItem(tagStoreKey, JSON.stringify(failedStore));
            }
          }
          throw error;
        }
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
        let managedFolderFailure = false;
        const scanDiagnostics = {
          tagDetailRequests: 0,
          tagDetailFailures: 0,
          taggedVideos: 0,
          untaggedVideos: 0,
          folderFailures: []
        };
        const tagCacheMaxAgeMs = 30 * 24 * 60 * 60 * 1000;
        const normalizeTagStoreProgress = (store) => {
          const nonNegativeInteger = (value) => Math.max(0, Math.floor(Number(value) || 0));
          const queueLength = Array.isArray(store.queue) ? store.queue.length : 0;
          const total = Math.max(nonNegativeInteger(store.progress?.total), queueLength);
          const pending = Math.min(queueLength, total);
          store.progress = {
            ...(store.progress || {}),
            total,
            completed: Math.min(nonNegativeInteger(store.progress?.completed), total - pending),
            pending,
            cacheHits: nonNegativeInteger(store.progress?.cacheHits),
            succeeded: nonNegativeInteger(store.progress?.succeeded),
            failed: nonNegativeInteger(store.progress?.failed)
          };
          return store;
        };
        const readTagStore = () => {
          try {
            const parsed = JSON.parse(localStorage.getItem(tagStoreKey) || '{}');
            return normalizeTagStoreProgress({
              ...parsed,
              cache: parsed.cache && typeof parsed.cache === 'object' ? parsed.cache : {},
              queue: Array.isArray(parsed.queue) ? parsed.queue.map(Number).filter(Number.isFinite) : [],
              progress: parsed.progress && typeof parsed.progress === 'object' ? parsed.progress : {}
            });
          } catch {
            return { cache: {}, queue: [], progress: {} };
          }
        };
        const writeTagStore = (store) => localStorage.setItem(
          tagStoreKey,
          JSON.stringify(normalizeTagStoreProgress(store))
        );
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
        const batchLimit = 3000;
        const savedBatchCursor = !payload.aid && tagStore.batchCursor?.accountMid === String(mid)
          ? tagStore.batchCursor
          : null;
        const previouslyCompletedBatchAids = new Set(
          savedBatchCursor && Array.isArray(tagStore.batchSeenAids)
            ? tagStore.batchSeenAids.map(Number).filter(Number.isFinite)
            : []
        );
        const batchAcceptedAids = new Set();
        let nextBatchCursor = null;
        let ordinaryFailureCursor = null;
        let batchHasMore = false;
        if (payload.aid) {
          scanRevision = Number(tagStore.controlRevision || 0);
          scanRunId = String(tagStore.lastScan?.basic?.runId || '');
        }
        const missingTagAids = new Set();
        const cacheHitAids = new Set();
        const discoveredVideoAids = new Set();
        let inProgressFolderAids = new Set();
        const persistBasicProgress = (status = 'running', location = {}) => {
          const latest = readTagStore();
          if (Number(latest.controlRevision || 0) !== scanRevision) return;
          const visibleAids = new Set([...discoveredVideoAids, ...inProgressFolderAids]);
          const previousTotal = latest.lastScan?.basic?.runId === scanRunId
            ? Number(latest.lastScan?.basic?.total || 0)
            : 0;
          latest.lastScan = {
            ...(latest.lastScan ?? {}),
            sourceFolders: latest.lastScan?.sourceFolders ?? [],
            basic: {
              completed: visibleAids.size,
              total: Math.max(visibleAids.size, previousTotal),
              status,
              runId: scanRunId,
              ...location
            }
          };
          writeTagStore(latest);
        };
        const scanWasCancelled = () => {
          return scanControlWasCancelled();
        };
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
        const buildManagedMembershipUrl = (folderId) => {
          const url = new URL('https://api.bilibili.com/x/v3/fav/resource/ids');
          url.searchParams.set('media_id', String(folderId));
          return url.toString();
        };
        const buildTagUrl = (aid) => {
          const url = new URL('https://api.bilibili.com/x/tag/archive/tags');
          url.searchParams.set('aid', String(aid));
          return url.toString();
        };
        const wait = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));
        const waitForRetry = async (delayMs) => {
          let remainingMs = delayMs;
          while (remainingMs > 0) {
            if (scanWasCancelled()) return false;
            const sliceMs = Math.min(50, remainingMs);
            await wait(sliceMs);
            remainingMs -= sliceMs;
          }
          return !scanWasCancelled();
        };
        let lastInitialTagRequestAt = 0;
        const paceInitialTagRequest = async () => {
          const elapsed = Date.now() - lastInitialTagRequestAt;
          if (lastInitialTagRequestAt > 0 && elapsed < 120) await wait(120 - elapsed);
          lastInitialTagRequestAt = Date.now();
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
                  reject(new Error('request timeout'));
                }, timeoutMs);
              })
            ]);
          } finally {
            clearTimeout(timeoutId);
          }
        };
        const readQueuedTagList = (rawTags) => (Array.isArray(rawTags) ? rawTags : [])
          .map((tag) => String(typeof tag === 'string' ? tag : (tag?.name ?? tag?.tag_name ?? tag?.title ?? '')).trim())
          .filter(Boolean)
          .slice(0, 20);
        const isRetryableResourceError = (error) => {
          if (error?.kind === 'invariant') return true;
          if (error instanceof TypeError || error?.name === 'AbortError') return true;
          if (String(error?.message || error || '') === 'request timeout') return true;
          const httpStatus = Number(error?.httpStatus || 0);
          if (error?.kind === 'http') return httpStatus === 429 || httpStatus >= 500;
          const apiCode = Number(error?.apiCode);
          if (error?.kind === 'api') return [-500, -502, -503, -504].includes(apiCode);
          return false;
        };
        const readFolderVideos = async (
          folderId,
          folderTitle,
          expectedMediaCount,
          onPageComplete = () => undefined,
          startPage = 1,
          applyBatchLimit = true
        ) => {
          const videos = [];
          const pageChunks = [];
          let page = startPage;
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
            if (!payload.aid && scanWasCancelled()) return { videos, cancelled: true };
            let json;
            let lastError;
            let attempts = 0;
            const requestStartedAt = Date.now();
            for (let attempt = 1; attempt <= 3; attempt += 1) {
              if (!payload.aid && scanWasCancelled()) return { videos, cancelled: true };
              attempts = attempt;
              if (!payload.aid) persistBasicProgress('running', {
                folderId: String(folderId), folderTitle: String(folderTitle || folderId), page, attempt, phase: 'requesting'
              });
              try {
                const candidate = await fetchJsonWithTimeout(
                  buildResourceUrl(folderId, page),
                  'favorite resource list for folder ' + folderId,
                  10000,
                  scanControlWasCancelled
                );
                const rawMedias = candidate.data?.medias;
                const declaredCounts = [candidate.data?.info?.media_count, expectedMediaCount]
                  .filter((value) => value !== null && value !== undefined);
                const allCountsAreReliable = declaredCounts.length > 0 && declaredCounts.every(
                  (count) => typeof count === 'number' && Number.isFinite(count) && count >= 0
                );
                const isReliablyEmpty = rawMedias === null && candidate.data?.has_more === false &&
                  allCountsAreReliable && declaredCounts.every((count) => count === 0);
                if (isReliablyEmpty) {
                  candidate.data.medias = [];
                } else if (!Array.isArray(rawMedias)) {
                  throw createApiError('favorite resource list returned invalid media data', { kind: 'schema' });
                }
                if (candidate.data?.has_more && candidate.data.medias.length === 0) {
                  throw createApiError('favorite resource list returned an empty page with more results', { kind: 'invariant' });
                }
                json = candidate;
                break;
              } catch (error) {
                lastError = error;
                if (!payload.aid && (error?.kind === 'cancelled' || scanWasCancelled())) {
                  return { videos, cancelled: true };
                }
                if (!isRetryableResourceError(error)) break;
                if (attempt < 3) {
                  if (!payload.aid) persistBasicProgress('running', {
                    folderId: String(folderId), folderTitle: String(folderTitle || folderId), page, attempt, phase: 'retrying'
                  });
                  if (!await waitForRetry(attempt === 1 ? 1000 : 2500)) {
                    return { videos, cancelled: true };
                  }
                }
              }
            }
            if (!json) {
              return {
                videos,
                failure: {
                  failedPage: page,
                  attempts,
                  status: videos.length > 0 ? 'partial' : 'failed',
                  operation: 'resource-list',
                  message: String(lastError?.message || lastError || 'favorite resource list failed').slice(0, 160),
                  errorKind: String(lastError?.kind || 'unknown').slice(0, 40),
                  durationMs: Math.max(0, Date.now() - requestStartedAt),
                  httpStatus: Number(lastError?.httpStatus || 0),
                  apiCode: Number(lastError?.apiCode),
                  contentType: String(lastError?.contentType || '').slice(0, 120),
                  finalUrl: String(lastError?.finalUrl || '').slice(0, 300),
                  redirected: Boolean(lastError?.redirected),
                  loginSignal: Boolean(lastError?.loginSignal),
                  riskSignal: Boolean(lastError?.riskSignal)
                }
              };
            }
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
            }
            const businessPageVideos = !payload.aid
              ? pageVideos.filter((video) => !previouslyCompletedBatchAids.has(video.aid))
              : pageVideos;
            if (!payload.aid) {
              const newPageAids = new Set(
                businessPageVideos.map((video) => video.aid).filter((aid) => !batchAcceptedAids.has(aid))
              );
              if (applyBatchLimit && batchAcceptedAids.size + newPageAids.size > batchLimit) {
                return {
                  videos,
                  pageChunks,
                  batchBoundary: { folderId: String(folderId), nextPage: page }
                };
              }
              if (applyBatchLimit) {
                for (const aid of newPageAids) batchAcceptedAids.add(aid);
              }
            }
            videos.push(...(applyBatchLimit ? businessPageVideos : pageVideos));
            pageChunks.push({ page, videos: pageVideos });
            if (!payload.aid && applyBatchLimit) {
              for (const video of businessPageVideos) inProgressFolderAids.add(video.aid);
            }
            if (payload.aid || !scanWasCancelled()) onPageComplete(page);

            if (!json.data?.has_more || medias.length === 0) {
              break;
            }

            if (!payload.aid && applyBatchLimit && batchAcceptedAids.size >= batchLimit) {
              return {
                videos,
                pageChunks,
                batchBoundary: { folderId: String(folderId), nextPage: page + 1 }
              };
            }

            page += 1;
          }

          return { videos, pageChunks };
        };
        const readManagedFolderMembership = async (folderId) => {
          try {
            const json = await fetchJsonWithTimeout(
              buildManagedMembershipUrl(folderId),
              'managed favorite membership for folder ' + folderId,
              10000,
              scanControlWasCancelled
            );
            if (!Array.isArray(json.data)) {
              throw createApiError('managed favorite membership returned invalid id data', { kind: 'schema' });
            }
            const aids = Array.from(new Set(
              json.data
                .filter((item) => Number(item?.type) === 2)
                .map((item) => Number(item?.id ?? item?.aid))
                .filter((aid) => Number.isFinite(aid) && aid > 0)
                .filter((aid) => !payload.aid || aid === Number(payload.aid))
            ));
            return { videos: aids.map((aid) => ({ aid })), pageChunks: [] };
          } catch (error) {
            return {
              videos: [],
              failure: {
                failedPage: 1,
                attempts: 1,
                status: 'failed',
                operation: 'target-membership',
                message: String(error?.message || error || 'managed favorite membership failed').slice(0, 160),
                httpStatus: Number(error?.httpStatus || 0),
                contentType: String(error?.contentType || '').slice(0, 120),
                finalUrl: String(error?.finalUrl || '').slice(0, 300),
                redirected: Boolean(error?.redirected)
              }
            };
          }
        };

        const cancelledScanResult = () => ({
          ok: false,
          cancelled: true,
          sourceFolders: [],
          skippedSourceFolderTitles: [],
          targetMembership: {},
          steps: [...steps, 'api:favorite:scan-cancelled'],
          missingTargets: [],
          message: 'old favorite scan cancelled'
        });

        if (!payload.aid && scanWasCancelled()) return cancelledScanResult();

        const currentFolderOrder = folders.map((folder) => String(findFolderId(folder) ?? '')).filter(Boolean);
        const savedFolderOrder = Array.isArray(savedBatchCursor?.folderOrder)
          ? savedBatchCursor.folderOrder.map(String)
          : null;
        const cursorOrderChanged = Boolean(
          savedFolderOrder && (
            savedFolderOrder.length !== currentFolderOrder.length ||
            savedFolderOrder.some((folderId, index) => folderId !== currentFolderOrder[index])
          )
        );
        const savedCursorTargetsManagedFolder = Boolean(
          savedBatchCursor && managedFolderIds.has(String(savedBatchCursor.folderId ?? ''))
        );
        const savedFolderIndex = savedBatchCursor && !cursorOrderChanged && !savedCursorTargetsManagedFolder
          ? folders.findIndex((folder) => String(findFolderId(folder) ?? '') === String(savedBatchCursor.folderId ?? ''))
          : -1;
        const savedBatchCursorInvalid = Boolean(
          savedBatchCursor && (savedFolderIndex < 0 || cursorOrderChanged || savedCursorTargetsManagedFolder)
        );
        if (savedBatchCursorInvalid) previouslyCompletedBatchAids.clear();
        let businessBatchClosed = false;
        let ordinaryGlobalFailure = null;
        for (let folderIndex = 0; folderIndex < folders.length; folderIndex += 1) {
          const folder = folders[folderIndex];
          if (!payload.aid && scanWasCancelled()) {
            return cancelledScanResult();
          }
          const folderId = findFolderId(folder);
          if (!folderId) {
            continue;
          }

          const folderIdString = String(folderId);
          const isManagedFolder = managedFolderIds.has(folderIdString);
          if (
            !payload.aid &&
            !isManagedFolder &&
            (businessBatchClosed || (savedFolderIndex >= 0 && folderIndex < savedFolderIndex))
          ) continue;
          const includeInBusinessBatch = payload.aid
            ? true
            : !isManagedFolder && !businessBatchClosed;
          const rawExpectedMediaCount = folder?.media_count ?? folder?.count;
          const declaredFolderCounts = [folder?.media_count, folder?.count]
            .filter((count) => count !== null && count !== undefined);
          const isReliablyEmptyFolder = declaredFolderCounts.length > 0 && declaredFolderCounts.every(
            (count) => typeof count === 'number' && Number.isFinite(count) && count >= 0 && count === 0
          );
          const acceptedAidsBeforeFolder = new Set(batchAcceptedAids);
          inProgressFolderAids = new Set();
          const folderScan = !isManagedFolder && ordinaryGlobalFailure
            ? {
                videos: [],
                pageChunks: [],
                failure: {
                  failedPage: 1,
                  attempts: 0,
                  status: 'failed',
                  operation: 'resource-list',
                  message: 'skipped because a global favorite resource interface failure opened the circuit',
                  errorKind: 'global-circuit-open',
                  durationMs: 0,
                  httpStatus: 0,
                  apiCode: 0,
                  contentType: '',
                  finalUrl: '',
                  redirected: false,
                  loginSignal: Boolean(ordinaryGlobalFailure.loginSignal),
                  riskSignal: Boolean(ordinaryGlobalFailure.riskSignal)
                }
              }
            : isReliablyEmptyFolder
            ? { videos: [], pageChunks: [] }
            : isManagedFolder
              ? await readManagedFolderMembership(folderIdString)
              : await readFolderVideos(
                folderIdString,
                String(folder?.title ?? folderIdString),
                rawExpectedMediaCount,
                (page) => {
                  if (!payload.aid) {
                    persistBasicProgress();
                  }
                },
                savedFolderIndex === folderIndex ? Math.max(1, Number(savedBatchCursor?.nextPage) || 1) : 1,
                true
              );
          if (!payload.aid && scanWasCancelled()) return cancelledScanResult();
          let videos = folderScan.videos;
          const failure = folderScan.failure;

          if (isManagedFolder && (!failure || videos.length > 0)) {
            targetMembership[folderIdString] = videos.map((video) => video.aid);
          }

          if (failure) {
            inProgressFolderAids = new Set();
            if (isManagedFolder) {
              managedFolderScanComplete = false;
              managedFolderFailure = true;
            } else {
              if (!ordinaryGlobalFailure && (
                failure.errorKind === 'html' ||
                failure.loginSignal ||
                failure.riskSignal
              )) {
                ordinaryGlobalFailure = failure;
              }
              batchAcceptedAids.clear();
              for (const aid of acceptedAidsBeforeFolder) batchAcceptedAids.add(aid);
              if (!ordinaryFailureCursor) {
                ordinaryFailureCursor = {
                  accountMid: String(mid),
                  folderId: folderIdString,
                  nextPage: 1,
                  folderOrder: currentFolderOrder
                };
                batchHasMore = true;
              }
            }
            skippedSourceFolderTitles.push(String(folder?.title ?? folderIdString));
            scanDiagnostics.folderFailures.push({
              folderId: folderIdString,
              folderTitle: String(folder?.title ?? folderIdString),
              failedPage: failure.failedPage,
              attempts: failure.attempts,
              status: failure.status,
              message: failure.message,
              retainedVideoCount: videos.length,
              ...(failure.operation ? { operation: failure.operation } : {}),
              ...(failure.errorKind ? { errorKind: failure.errorKind } : {}),
              ...(Number.isFinite(failure.durationMs) ? { durationMs: failure.durationMs } : {}),
              ...(failure.httpStatus ? { httpStatus: failure.httpStatus } : {}),
              ...(Number.isFinite(failure.apiCode) ? { apiCode: failure.apiCode } : {}),
              ...(failure.contentType ? { contentType: failure.contentType } : {}),
              ...(failure.finalUrl ? { finalUrl: failure.finalUrl } : {}),
              ...(typeof failure.redirected === 'boolean' ? { redirected: failure.redirected } : {}),
              ...(typeof failure.loginSignal === 'boolean' ? { loginSignal: failure.loginSignal } : {}),
              ...(typeof failure.riskSignal === 'boolean' ? { riskSignal: failure.riskSignal } : {})
            });
            steps.push('api:favorite:scan-source-failed:' + folderIdString);
            if (!payload.aid) persistBasicProgress();
            continue;
          }

          if (isManagedFolder) {
            steps.push((payload.aid ? 'api:favorite:scan-video-target:' : 'api:favorite:scan-target:') + folderIdString);
          }

          const sourceFolder = {
            id: folderIdString,
            title: String(folder?.title ?? ''),
            mediaCount: Number(folder?.media_count ?? folder?.count ?? videos.length),
            scanFailed: false,
            scanStatus: 'complete',
            readVideoCount: videos.length,
            videos
          };

          if (!payload.aid && includeInBusinessBatch) {
            for (const video of videos) discoveredVideoAids.add(video.aid);
            inProgressFolderAids = new Set();
          }

          if (!payload.aid && includeInBusinessBatch) {
            sourceFolders.push(sourceFolder);
            steps.push('api:favorite:scan-source:' + folderIdString);
          } else if (videos.length > 0 && !targetFolderIds.has(folderIdString)) {
            sourceFolders.push(sourceFolder);
            steps.push('api:favorite:scan-video-source:' + folderIdString);
          } else if (videos.length > 0 && !fallbackSourceFolder) {
            fallbackSourceFolder = sourceFolder;
          }
          if (!payload.aid) persistBasicProgress();
          if (!payload.aid && folderScan.batchBoundary) {
            nextBatchCursor = {
              accountMid: String(mid),
              folderId: folderScan.batchBoundary.folderId,
              nextPage: folderScan.batchBoundary.nextPage,
              folderOrder: currentFolderOrder
            };
            batchHasMore = true;
            businessBatchClosed = true;
            continue;
          }
          if (!payload.aid && batchAcceptedAids.size >= batchLimit && folderIndex + 1 < folders.length) {
            const nextOrdinaryFolder = folders
              .slice(folderIndex + 1)
              .find((candidate) => {
                const candidateId = findFolderId(candidate);
                return candidateId && !managedFolderIds.has(String(candidateId));
              });
            const nextFolderId = findFolderId(nextOrdinaryFolder);
            if (nextFolderId) {
              nextBatchCursor = {
                accountMid: String(mid),
                folderId: String(nextFolderId),
                nextPage: 1,
                folderOrder: currentFolderOrder
              };
              batchHasMore = true;
            }
            businessBatchClosed = true;
          }
        }

        if (payload.aid && sourceFolders.length === 0 && fallbackSourceFolder) {
          sourceFolders.push(fallbackSourceFolder);
        }
        const resumableBatchCursor = ordinaryFailureCursor ?? nextBatchCursor;

        const completeSourceFolders = sourceFolders.filter((folder) => folder.scanFailed !== true);
        const uniqueVideos = new Map();
        const knownTagsByAid = new Map();
        for (const folder of completeSourceFolders) {
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
          (aid) => uniqueVideos.has(aid) && !knownTagsByAid.has(aid) && !cacheHitAids.has(aid)
        );
        const initiallyCompletedTagAids = new Set(
          Array.from(knownTagsByAid.keys()).filter((aid) => uniqueVideos.has(aid))
        );
        for (const aid of cacheHitAids) {
          if (uniqueVideos.has(aid)) initiallyCompletedTagAids.add(aid);
        }
        const completedScanRunId = payload.aid ? tagStore.lastScan?.basic?.runId : scanRunId;
        tagStore.queue = queuedAids;
        tagStore.lastScan = {
          sourceFolders,
          basic: {
            completed: uniqueVideos.size,
            total: uniqueVideos.size,
            status: 'complete',
            ...(completedScanRunId ? { runId: completedScanRunId } : {})
          },
          ...(!payload.aid ? { batch: { folderOrder: currentFolderOrder } } : {})
        };
        tagStore.progress = {
          completed: initiallyCompletedTagAids.size,
          total: uniqueVideos.size,
          pending: queuedAids.length,
          cacheHits: Array.from(cacheHitAids).filter((aid) => uniqueVideos.has(aid)).length,
          succeeded: 0,
          failed: 0,
          status: queuedAids.length > 0 ? 'running' : 'complete'
        };
        if (!payload.aid && savedBatchCursorInvalid) {
          delete tagStore.batchCursor;
          delete tagStore.batchSeenAids;
        }
        writeTagStore(tagStore);
        if (!payload.aid) {
          localStorage.setItem('bilimi:old-favorite-batch-status:v1', JSON.stringify({
            accountMid: String(mid),
            scanRunId: String(completedScanRunId || '')
          }));
        }

        if (!payload.aid) {
          persistBasicProgress('complete');
        }
        const finalUniqueVideos = new Map();
        for (const folder of completeSourceFolders) {
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
                const message = String(error?.message || error || '');
                if (/(-101|-352|-412|-509|risk|频繁|风控|too fast|login|未登录|returned HTML)/i.test(message)) {
                  latestStore.progress.status = 'paused';
                  writeTagStore(latestStore);
                  break;
                }
                if (consecutiveFailures >= 3) {
                  latestStore.queue.shift();
                  latestStore.progress.completed = Math.max(
                    latestStore.progress.completed,
                    latestStore.progress.total - latestStore.queue.length
                  );
                  latestStore.progress.pending = latestStore.queue.length;
                  latestStore.progress.failed += 1;
                  latestStore.progress.status = latestStore.queue.length > 0 ? 'running' : 'complete';
                  consecutiveFailures = 0;
                  writeTagStore(latestStore);
                  continue;
                }
                latestStore.queue.push(latestStore.queue.shift());
                await wait(Math.min(8000, 750 * (2 ** consecutiveFailures)));
              }
              latestStore.progress.status = latestStore.queue.length > 0 ? 'running' : 'complete';
              writeTagStore(latestStore);
            }
            window.__bilimiOldFavoriteTagWorkerRunning = false;
            const handoffStore = readTagStore();
            if (handoffStore.progress?.status === 'running' && handoffStore.queue.length > 0) {
              setTimeout(() => {
                if (!window.__bilimiOldFavoriteTagWorkerRunning) window.__bilimiStartOldFavoriteTagWorker?.();
              }, 0);
            }
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
          recoveringPendingBatch,
          scanDiagnostics,
          batch: {
            limit: batchLimit,
            hasMore: batchHasMore,
            ...(resumableBatchCursor ? { nextCursor: resumableBatchCursor } : {}),
            ...(!payload.aid ? {
              commitToken: {
                version: 1,
                accountMid: String(mid),
                scanRunId: String(completedScanRunId || ''),
                folderOrder: currentFolderOrder,
                expectedCurrentCursor: savedBatchCursorInvalid ? null : (savedBatchCursor ?? null),
                nextCursor: resumableBatchCursor ?? null,
                seenAids: Array.from(uniqueVideos.keys())
              }
            } : {})
          },
          scanProgress: {
            basic: {
              completed: uniqueVideos.size,
              total: uniqueVideos.size,
              status: 'complete',
              ...(completedScanRunId ? { runId: completedScanRunId } : {})
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

        const appendItemFolders = async (item, addFolderIds) => {
          const body = new URLSearchParams();
          body.set('add_media_ids', addFolderIds.join(','));
          body.set('csrf', csrf);
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
          appendItemFolders(item, [String(targetFolderId)]);
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
            try {
              for (const folderId of addedFolderIds) {
                await appendItem(item, folderId);
                steps.push('api:ledger:append:' + item.aid + ':' + folderId);
              }
              completedItems.push({
                ...item,
                finalFolderIds: Array.from(new Set([...currentFolderIds, ...desiredFolderIds])),
                addedFolderIds,
                removedFolderIds: []
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
