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
  stagingFolderIds?: string[]
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
  return ledgers.map((ledger) => {
    const bilibiliFolderIds = [...new Set([
      ...(ledger.bilibiliFolderIds ?? []),
      ...(ledger.bilibiliFolderId ? [ledger.bilibiliFolderId] : [])
    ].map((folderId) => String(folderId).trim()).filter(Boolean))]
    return {
      ...ledger,
      ...(bilibiliFolderIds.length ? {
        bilibiliFolderId: bilibiliFolderIds[0],
        bilibiliFolderIds
      } : {}),
      displayName: normalizeLedgerDisplayName(ledger.displayName)
    }
  })
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
    const normalizeFolderTitle = (title) => String(title || '')
      .trim()
      .replace(/^bilimi\\s*[·:：\-]?\\s*/iu, '')
      .trim();
    // Only the current numeric shard suffix denotes a capacity shard.
    const normalizeLogicalFolderTitle = (title) => normalizeFolderTitle(title).replace(/\\s*·\\s*([2-9]\\d*)$/u, '').trim();
    const isBilimiManagedFolder = (folder) => /^bilimi(?=$|[\\s·.：:-]|[\\u3400-\\u9fff])/iu.test(String(folder?.title || '').trim());
    const remoteFolderCandidates = (ledger, folders) => {
      const normalizedLedgerTitle = normalizeLogicalFolderTitle(ledger.displayName);
      return folders
        .filter((candidate) => isBilimiManagedFolder(candidate) &&
          normalizeLogicalFolderTitle(candidate?.title) === normalizedLedgerTitle && findFolderId(candidate))
        .map((candidate) => ({
          id: String(findFolderId(candidate)),
          title: String(candidate.title || ''),
          memberCount: Math.max(0, Number(candidate.media_count ?? candidate.count ?? 0) || 0)
        }));
    };
    const ledgerRemoteFolderIds = (ledger) => Array.from(new Set([
      ...(Array.isArray(ledger?.bilibiliFolderIds) ? ledger.bilibiliFolderIds : []),
      ...(ledger?.bilibiliFolderId ? [ledger.bilibiliFolderId] : [])
    ].map((folderId) => String(folderId || '').trim()).filter(Boolean)));
    const syncLedgerFolderIds = (ledgers, folders, selectedRemoteFolderIds = {}) => {
      const folderById = new Map(
        folders
          .map((folder) => [String(findFolderId(folder) || ''), folder])
          .filter(([folderId]) => folderId)
      );
      return ledgers.map((ledger) => {
        const normalizedLedgerTitle = normalizeLogicalFolderTitle(ledger.displayName);
        const candidates = remoteFolderCandidates(ledger, folders);
        const selectedRemoteFolderId = String(selectedRemoteFolderIds?.[ledger.id] || '').trim();
        const selectedFolder = selectedRemoteFolderId
          ? folderById.get(selectedRemoteFolderId)
          : null;
        if (selectedFolder && isBilimiManagedFolder(selectedFolder) &&
          normalizeLogicalFolderTitle(selectedFolder.title) === normalizedLedgerTitle) {
          return { ...ledger, bilibiliFolderId: selectedRemoteFolderId, bilibiliFolderIds: [selectedRemoteFolderId], bilibiliFolderTitle: String(selectedFolder.title || ledger.displayName), bilibiliFolderVideoCount: Math.max(0, Number(selectedFolder.media_count ?? selectedFolder.count ?? 0) || 0), bindingState: 'bound' };
        }
        // A create response already gave us this exact remote ID, but it has
        // not passed the repository's independent inventory verification.
        // Keep it pending even if the page list has caught up: treating it as
        // bound here would permit a write before the formal binding exists.
        if (ledger.pendingRemoteBinding && (ledger.pendingRemoteFolderId || ledger.bilibiliFolderId)) {
          return { ...ledger, bindingState: 'unbound' };
        }
        // A persisted binding is keyed by the remote folder ID. Bilibili users
        // may rename a bound folder, so a title mismatch must not silently
        // discard an otherwise valid binding.
        const storedFolders = ledgerRemoteFolderIds(ledger)
          .map((folderId) => folderById.get(folderId))
          .filter(Boolean);
        if (storedFolders.length) {
          if (ledger.syncState === 'local-draft' && ledger.bindingState === 'unbound') return ledger;
          const primaryFolder = storedFolders[0];
          const folderIds = storedFolders.map((folder) => String(findFolderId(folder)));
          return { ...ledger, bilibiliFolderId: folderIds[0], bilibiliFolderIds: folderIds, bilibiliFolderTitle: String(primaryFolder.title || ledger.displayName), bilibiliFolderVideoCount: storedFolders.reduce((count, folder) => count + Math.max(0, Number(folder.media_count ?? folder.count ?? 0) || 0), 0), bindingState: 'bound' };
        }

        if (candidates.length && (ledger.isDefault || ledger.id === 'inbox')) {
          const folderIds = candidates.map((candidate) => candidate.id);
          return { ...ledger, bilibiliFolderId: folderIds[0], bilibiliFolderIds: folderIds, bilibiliFolderTitle: candidates[0].title, bilibiliFolderVideoCount: candidates.reduce((count, candidate) => count + candidate.memberCount, 0), bindingState: 'unbound' };
        }
        const { bilibiliFolderId, bilibiliFolderIds, bilibiliFolderTitle, bilibiliFolderVideoCount, bindingState: _bindingState, ...ledgerWithoutStaleFolderId } = ledger;
        return {
          ...ledgerWithoutStaleFolderId,
          bindingState: candidates.length > 0 ? 'unbound' : 'unbacked'
        };
      });
    };
    const collectUnboundCandidates = (ledgers, folders) => ledgers
      .filter((ledger) => ledger.bindingState === 'unbound')
      .map((ledger) => ({ ledgerId: ledger.id, candidates: remoteFolderCandidates(ledger, folders) }));
    const stableRemoteDraftLedgerId = (remoteFolderId) => {
      let hash = 2166136261;
      for (const character of String(remoteFolderId || '').trim()) {
        hash ^= character.codePointAt(0) || 0;
        hash = Math.imul(hash, 16777619);
      }
      return 'custom-remote-' + (hash >>> 0).toString(36);
    };
    const appendRemoteOnlyDrafts = (ledgers, folders, dismissedRemoteFolderIds = []) => {
      const nextLedgers = [];
      const ledgerIndexById = new Map();
      const remoteDraftIndexByTitle = new Map();
      for (const ledger of ledgers) {
        const normalizedTitle = normalizeLogicalFolderTitle(ledger.displayName);
        const isRemoteDraft = ledger.syncState === 'local-draft' && ledger.bindingState === 'unbound' &&
          isBilimiManagedFolder({ title: ledger.displayName }) && ledgerRemoteFolderIds(ledger).length > 0;
        const sameRemoteDraftIndex = isRemoteDraft ? remoteDraftIndexByTitle.get(normalizedTitle) : undefined;
        if (sameRemoteDraftIndex !== undefined) {
          const existing = nextLedgers[sameRemoteDraftIndex];
          const folderIds = Array.from(new Set([...ledgerRemoteFolderIds(existing), ...ledgerRemoteFolderIds(ledger)]));
          nextLedgers[sameRemoteDraftIndex] = {
            ...existing,
            bilibiliFolderId: folderIds[0],
            bilibiliFolderIds: folderIds,
            bilibiliFolderVideoCount: Math.max(0, Number(existing.bilibiliFolderVideoCount || 0)) + Math.max(0, Number(ledger.bilibiliFolderVideoCount || 0))
          };
          continue;
        }
        const existingIndex = ledgerIndexById.get(ledger.id);
        if (existingIndex === undefined) {
          ledgerIndexById.set(ledger.id, nextLedgers.length);
          nextLedgers.push(ledger);
          if (isRemoteDraft) remoteDraftIndexByTitle.set(normalizedTitle, nextLedgers.length - 1);
          continue;
        }
        const existing = nextLedgers[existingIndex];
        if (!existing.bilibiliFolderId && ledger.bilibiliFolderId) {
          nextLedgers[existingIndex] = ledger;
        }
      }
      // An older discovery pass could persist a remote-only draft even though
      // every one of its physical folder IDs already belongs to the same
      // title's bound logical folder. This is a duplicate projection, not an
      // ambiguous same-name Bilibili folder, so it can be safely discarded.
      const boundFolderIdsByTitle = new Map();
      for (const ledger of nextLedgers) {
        if (ledger.syncState === 'local-draft' || ledger.bindingState !== 'bound') continue;
        const normalizedTitle = normalizeLogicalFolderTitle(ledger.displayName);
        if (!normalizedTitle) continue;
        const folderIds = boundFolderIdsByTitle.get(normalizedTitle) || new Set();
        for (const folderId of ledgerRemoteFolderIds(ledger)) folderIds.add(folderId);
        boundFolderIdsByTitle.set(normalizedTitle, folderIds);
      }
      const deduplicatedLedgers = nextLedgers.filter((ledger) => {
        if (ledger.syncState !== 'local-draft' || !isBilimiManagedFolder({ title: ledger.displayName })) return true;
        const folderIds = ledgerRemoteFolderIds(ledger);
        const boundFolderIds = boundFolderIdsByTitle.get(normalizeLogicalFolderTitle(ledger.displayName));
        return !folderIds.length || !boundFolderIds || !folderIds.every((folderId) => boundFolderIds.has(folderId));
      });
      ledgerIndexById.clear();
      remoteDraftIndexByTitle.clear();
      deduplicatedLedgers.forEach((ledger, index) => {
        ledgerIndexById.set(ledger.id, index);
        if (ledger.syncState === 'local-draft' && ledger.bindingState === 'unbound' && isBilimiManagedFolder({ title: ledger.displayName })) {
          remoteDraftIndexByTitle.set(normalizeLogicalFolderTitle(ledger.displayName), index);
        }
      });
      const dismissedIds = new Set((Array.isArray(dismissedRemoteFolderIds) ? dismissedRemoteFolderIds : []).map((id) => String(id || '').trim()).filter(Boolean));
      const knownRemoteFolderIds = new Set(deduplicatedLedgers.flatMap(ledgerRemoteFolderIds));
      // A normal local rule with the same title is an explicit rebind
      // candidate, not a remote-only draft. A local bilimi-prefixed draft is
      // kept separate so the owner can choose which one to bind.
      const localRebindTitles = new Set(deduplicatedLedgers
        .filter((ledger) => ledger.bindingState === 'unbound' && !isBilimiManagedFolder({ title: ledger.displayName }))
        .map((ledger) => normalizeLogicalFolderTitle(ledger.displayName)));
      let priority = deduplicatedLedgers.reduce((max, ledger) => Math.max(max, Number(ledger.priority) || 0), -1) + 1;
      const foldersByTitle = new Map();
      for (const folder of folders) {
        if (!isBilimiManagedFolder(folder)) continue;
        const folderId = String(findFolderId(folder) || '').trim();
        const displayName = String(folder.title || '').trim();
        const normalizedTitle = normalizeLogicalFolderTitle(displayName);
        if (!folderId || dismissedIds.has(folderId) || knownRemoteFolderIds.has(folderId) || localRebindTitles.has(normalizedTitle) || !displayName || !normalizedTitle) continue;
        const group = foldersByTitle.get(normalizedTitle) || [];
        group.push({ folder, folderId, displayName });
        foldersByTitle.set(normalizedTitle, group);
      }
      for (const [normalizedTitle, group] of foldersByTitle) {
        group.sort((left, right) => left.folderId.localeCompare(right.folderId, undefined, { numeric: true }));
        const folderIds = group.map((entry) => entry.folderId);
        const id = stableRemoteDraftLedgerId(normalizedTitle);
        const existingIndex = remoteDraftIndexByTitle.get(normalizedTitle) ?? ledgerIndexById.get(id);
        const displayName = group[0].displayName;
        const videoCount = group.reduce((count, entry) => count + Math.max(0, Number(entry.folder.media_count ?? entry.folder.count ?? 0) || 0), 0);
        if (existingIndex !== undefined) {
          const existing = deduplicatedLedgers[existingIndex];
          if (existing.syncState === 'local-draft' && existing.bindingState === 'unbound') {
            const allFolderIds = Array.from(new Set([...ledgerRemoteFolderIds(existing), ...folderIds]));
            deduplicatedLedgers[existingIndex] = { ...existing, bilibiliFolderId: allFolderIds[0], bilibiliFolderIds: allFolderIds, bilibiliFolderVideoCount: Math.max(0, Number(existing.bilibiliFolderVideoCount || 0)) + videoCount };
            for (const folderId of allFolderIds) knownRemoteFolderIds.add(folderId);
          }
          continue;
        }
        for (const folderId of folderIds) knownRemoteFolderIds.add(folderId);
        ledgerIndexById.set(id, deduplicatedLedgers.length);
        remoteDraftIndexByTitle.set(normalizedTitle, deduplicatedLedgers.length);
        deduplicatedLedgers.push({
          id,
          displayName,
          keywords: [],
          ruleType: 'keyword',
          enabled: false,
          priority: priority++,
          bilibiliFolderId: folderIds[0],
          bilibiliFolderIds: folderIds,
          bilibiliFolderVideoCount: videoCount,
          bindingState: 'unbound',
          syncState: 'local-draft',
          isDefault: false
        });
      }
      return deduplicatedLedgers;
    };
  `
}

export function buildFavoriteLedgerStatusScript(ledgers: FavoriteLedger[], dismissedRemoteFolderIds: string[] = []): string {
  const payload = scriptPayload({ ledgers: normalizeLedgerPayload(ledgers), dismissedRemoteFolderIds })

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
      const nextLedgers = appendRemoteOnlyDrafts(syncLedgerFolderIds(payload.ledgers, folders), folders, payload.dismissedRemoteFolderIds);
      const dismissedRemoteFolderIds = new Set((Array.isArray(payload.dismissedRemoteFolderIds) ? payload.dismissedRemoteFolderIds : []).map((id) => String(id || '').trim()).filter(Boolean));
      const remoteOnlyDraftLedgerIds = nextLedgers
        .filter((ledger) => ledger.syncState === 'local-draft' && ledger.bindingState === 'unbound' && ledgerRemoteFolderIds(ledger).some((folderId) => !dismissedRemoteFolderIds.has(folderId)))
        .map((ledger) => ledger.id);
      const unboundLedgerIds = nextLedgers
        .filter((ledger) => ledger.enabled && ledger.syncState !== 'local-draft' && ledger.bindingState === 'unbound')
        .map((ledger) => ledger.id);
      const unboundCandidates = collectUnboundCandidates(nextLedgers, folders);

      return {
        ok: unboundLedgerIds.length === 0,
        ledgers: nextLedgers,
        missingLedgerIds: nextLedgers.filter((ledger) => ledger.enabled && ledger.syncState !== 'local-draft' && ledger.bindingState !== 'bound').map((ledger) => ledger.id),
        backupConflictLedgerIds: [],
        unboundLedgerIds,
        unboundCandidates,
        remoteOnlyDraftLedgerIds,
        message: unboundLedgerIds.length === 0 ? '册目查验已毕。' : '发现未绑定的 bilimi 收藏夹，请在备册时主动确认复用对应收藏夹。'
      };
    })();
  `
}

export function buildFavoriteLedgerWriteCapacityScript(
  ledgers: FavoriteLedger[],
  targetLedgerIds: string[]
): string {
  const payload = scriptPayload({ ledgers: normalizeLedgerPayload(ledgers), targetLedgerIds })

  return `
    (async () => {
      const payload = ${payload};
      ${sharedScriptHelpers()}
      const { csrf, mid } = readCredentials();
      if (!csrf || !mid) return { ok: false, missingTargets: ['favorite-api-user'], message: 'B 站登录凭证不可用，无法检查收藏夹分区。' };
      const response = await fetch(buildListUrl(mid), { credentials: 'include' });
      const json = await ensureApiOk(response, 'favorite folder list');
      const folders = Array.isArray(json.data?.list) ? json.data.list : [];
      const folderById = new Map(folders.map((folder) => [String(findFolderId(folder) || ''), folder]));
      const fullLedgerIds = [];
      const missingLedgerIds = [];
      for (const ledgerId of Array.from(new Set(payload.targetLedgerIds || [])).filter(Boolean)) {
        const ledger = payload.ledgers.find((candidate) => candidate.id === ledgerId);
        const folderIds = ledger ? ledgerRemoteFolderIds(ledger) : [];
        const boundFolders = folderIds.map((folderId) => folderById.get(folderId)).filter(Boolean);
        if (!ledger || !boundFolders.length) {
          missingLedgerIds.push(ledgerId);
          continue;
        }
        if (!boundFolders.some((folder) => Math.max(0, Number(folder.media_count ?? folder.count ?? 0) || 0) < 1000)) {
          fullLedgerIds.push(ledgerId);
        }
      }
      return {
        ok: missingLedgerIds.length === 0 && fullLedgerIds.length === 0,
        steps: ['api:favorite:capacity-list'],
        missingTargets: [...missingLedgerIds, ...fullLedgerIds.map((ledgerId) => 'favorite-shard-confirmation:' + ledgerId)],
        fullLedgerIds,
        message: fullLedgerIds.length
          ? '目标 bilimi 收藏夹的已绑定分区已满，需要确认备册新的分区后才能继续批阅。'
          : missingLedgerIds.length
            ? '未找到可用的正式绑定收藏夹分区。'
            : '收藏夹分区容量可用。'
      };
    })();
  `
}

export function buildCreateFavoriteLedgerPhysicalShardScript(ledger: FavoriteLedger): string {
  const payload = scriptPayload({ ledger: normalizeLedgerPayload([ledger])[0] })

  return `
    (async () => {
      const payload = ${payload};
      ${sharedScriptHelpers()}
      const { csrf, mid } = readCredentials();
      if (!csrf || !mid) return { ok: false, missingTargets: ['favorite-api-user'], message: 'B 站登录凭证不可用，无法备册新分区。' };
      const listResponse = await fetch(buildListUrl(mid), { credentials: 'include' });
      const listJson = await ensureApiOk(listResponse, 'favorite folder list');
      const folders = Array.isArray(listJson.data?.list) ? listJson.data.list : [];
      if (folders.length >= 99) {
        return { ok: false, missingTargets: ['favorite-folder-limit'], message: 'B 站收藏夹数量已达到 99 个上限，无法备册新的分区。' };
      }
      const boundFolderIds = ledgerRemoteFolderIds(payload.ledger);
      const title = String(payload.ledger.displayName || '').trim();
      const boundFolders = boundFolderIds
        .map((folderId) => folders.find((folder) => String(findFolderId(folder) || '') === folderId))
        .filter(Boolean);
      if (!boundFolders.length) {
        return { ok: false, missingTargets: ['favorite-shard-unbound'], message: '未找到已绑定的 B 站收藏夹，无法备册新分区。' };
      }
      const available = [...boundFolders].reverse().find((folder) => Math.max(0, Number(folder.media_count ?? folder.count ?? 0) || 0) < 1000);
      if (available) {
        return { ok: true, steps: ['api:favorite:capacity-list'], existingFolder: { id: String(findFolderId(available)), title: String(available.title || ''), shardNumber: 1 }, message: '已有可用收藏夹分区。' };
      }
      const suffixNumber = (value) => {
        const match = String(value || '').trim().match(/·(?:0*(\d+))$/u);
        return match ? Number(match[1]) : 1;
      };
      // Count every matching remote shard, not just the IDs whose formal
      // binding is already persisted. A prior creation can be visible before
      // its binding reconciliation completes; it must still reserve its slot.
      const normalizeShardBaseTitle = (value) => String(value || '').trim().replace(/\s*\u00b7\s*(?:0*(?:[2-9]\d*))$/u, '');
      const matchingRemoteShards = folders.filter((folder) => normalizeShardBaseTitle(folder.title) === title);
      const nextShardNumber = Math.max(...matchingRemoteShards.map((folder) => suffixNumber(folder.title)), 1) + 1;
      const suffix = '·' + String(nextShardNumber);
      const shardTitle = Array.from(title).slice(0, Math.max(1, 20 - Array.from(suffix).length)).join('') + suffix;
      const body = new URLSearchParams({ csrf, privacy: '0', title: shardTitle });
      const createResponse = await fetch('https://api.bilibili.com/x/v3/fav/folder/add', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body
      });
      const createJson = await ensureApiOk(createResponse, 'favorite physical shard create');
      const folderId = findFolderId(createJson.data);
      if (!folderId) return { ok: false, missingTargets: ['favorite-shard-create'], message: 'B 站没有返回新分区的收藏夹编号。' };
      return {
        ok: true,
        steps: ['api:favorite:capacity-list', 'api:favorite:shard-create'],
        folder: { id: String(folderId), title: shardTitle, shardNumber: nextShardNumber },
        message: '新的 B 站收藏夹分区已创建，等待登记绑定。'
      };
    })();
  `
}

export function buildEnsureFavoriteLedgersScript(
  ledgers: FavoriteLedger[],
  options: Pick<FavoriteLedgerSaveOptions, 'rebindRemoteFolderIds' | 'lightweightBackup'> = {}
): string {
  const payload = scriptPayload({
    ledgers: normalizeLedgerPayload(ledgers),
    options: {
      rebindRemoteFolderIds: options.rebindRemoteFolderIds,
      lightweightBackup: options.lightweightBackup
    }
  })

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
      const nextLedgers = syncLedgerFolderIds(payload.ledgers, folders, payload.options?.rebindRemoteFolderIds);
      const unboundLedgerIds = nextLedgers
        .filter((ledger) => ledger.enabled && ledger.syncState !== 'local-draft' && ledger.bindingState === 'unbound')
        .map((ledger) => ledger.id);
      if (unboundLedgerIds.length > 0) {
        return {
          ok: false,
          ledgers: nextLedgers,
          steps,
          missingTargets: unboundLedgerIds,
          unboundLedgerIds,
          unboundCandidates: collectUnboundCandidates(nextLedgers, folders),
          message: '发现未绑定的 bilimi 收藏夹，请确认要重新绑定的候选收藏夹。'
        };
      }

      // Existing remote folder IDs are authoritative during ordinary backup.
      // Renaming is reserved for an explicit user-confirmed binding repair.

      for (let index = 0; index < nextLedgers.length; index += 1) {
        const ledger = nextLedgers[index];
        if (!ledger.enabled || ledger.syncState === 'local-draft' || ledger.bilibiliFolderId) {
          continue;
        }

        const recheckResponse = await fetch(buildListUrl(mid), { credentials: 'include' });
        const recheckJson = await ensureApiOk(recheckResponse, 'favorite folder list');
        const recheckedFolders = Array.isArray(recheckJson.data?.list) ? recheckJson.data.list : [];
        const recheckedCandidates = remoteFolderCandidates(ledger, recheckedFolders);
        if (recheckedCandidates.length > 0) {
          return {
            ok: false,
            ledgers: nextLedgers,
            steps,
            missingTargets: [ledger.id],
            unboundLedgerIds: [ledger.id],
            unboundCandidates: [{ ledgerId: ledger.id, candidates: recheckedCandidates }],
            message: '发现未绑定的 bilimi 收藏夹，请确认要重新绑定的候选收藏夹。'
          };
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
          nextLedgers[index] = { ...ledger, bilibiliFolderId: String(folderId), bilibiliFolderTitle: ledger.displayName, bindingState: 'bound' };
        }
        steps.push('api:ledger:create:' + ledger.id);
      }

      const missingTargets = nextLedgers.filter((ledger) => ledger.enabled && ledger.syncState !== 'local-draft' && ledger.bindingState !== 'bound').map((ledger) => ledger.id);

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
  const { rediscoverDeletedRemoteDrafts: _rediscoverDeletedRemoteDrafts, ...remoteSaveOptions } = options
  const payload = scriptPayload({
    nextLedgers: normalizeLedgerPayload(nextLedgers),
    options: remoteSaveOptions,
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
          message: 'B 站登录凭证不可用，请刷新 B 站页面后重试。'
        };
      }

      const steps = ['api:ledger:list'];
      const listResponse = await fetch(buildListUrl(mid), { credentials: 'include' });
      const listJson = await ensureApiOk(listResponse, 'favorite folder list');
      const folders = Array.isArray(listJson.data?.list) ? listJson.data.list : [];
      let nextLedgers = syncLedgerFolderIds(payload.nextLedgers, folders, payload.options?.rebindRemoteFolderIds);
      const unboundLedgerIds = nextLedgers
        .filter((ledger) => ledger.enabled && ledger.syncState !== 'local-draft' && ledger.bindingState === 'unbound')
        .map((ledger) => ledger.id);
      if (unboundLedgerIds.length > 0) {
        return {
          ok: false,
          ledgers: nextLedgers,
          steps,
          missingTargets: unboundLedgerIds,
          unboundLedgerIds,
          unboundCandidates: collectUnboundCandidates(nextLedgers, folders),
          message: '发现未绑定的 bilimi 收藏夹，请确认要重新绑定的候选收藏夹。'
        };
      }

      // Existing remote folder IDs are authoritative during ordinary save.
      // Renaming is reserved for an explicit user-confirmed binding repair.

      for (let index = 0; index < nextLedgers.length; index += 1) {
        const ledger = nextLedgers[index];
        if (!ledger.enabled || ledger.syncState === 'local-draft' || ledger.bilibiliFolderId) {
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
          nextLedgers[index] = { ...ledger, bilibiliFolderId: String(folderId), bilibiliFolderTitle: ledger.displayName, bindingState: 'bound' };
        }
        steps.push('api:ledger:create:' + ledger.id);
      }

      const missingTargets = nextLedgers
        .filter((ledger) => ledger.enabled && ledger.syncState !== 'local-draft' && ledger.bindingState !== 'bound')
        .map((ledger) => ledger.id);

      return {
        ok: missingTargets.length === 0,
        ledgers: nextLedgers,
        steps,
        missingTargets,
        message: missingTargets.length === 0 ? '收藏夹已备册。' : '部分收藏夹尚未备册。'
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
        ? store.progress.status === 'partial' ? 'partial' : 'complete'
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
        let completedSinceCheckpoint = 0;
        let lastCheckpointAt = Date.now();
        let checkpointDirty = false;
        try {
        while (true) {
          let controlledStore;
          try { controlledStore = JSON.parse(localStorage.getItem(key) || '{}'); } catch { break; }
          if (Number(controlledStore.controlRevision || 0) !== Number(store.controlRevision || 0)) {
            store = controlledStore;
            break;
          }
          if (!Array.isArray(store.queue) || !store.queue.length || controlledStore.progress?.status === 'paused') break;
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
              const loginSignal = /login|log in|未登录/i.test(bodyText) || /login|passport/i.test(String(response.url || ''));
              const riskSignal = /risk|频繁|风控|too fast|captcha|安全验证/i.test(bodyText);
              throw Object.assign(new Error('tag request returned HTML; please log in again'), {
                global: true,
                loginSignal,
                riskSignal
              });
            }
            let json;
            try { json = bodyText ? JSON.parse(bodyText) : null; } catch {
              throw Object.assign(new Error('tag request returned invalid JSON'), { global: true });
            }
            const code = Number(json?.code);
            if (!response.ok || code !== 0) {
              const message = String(json?.message || code || response.status);
              const loginSignal = code === -101 || /login|未登录/i.test(message);
              const riskSignal = [403, 412].includes(Number(response?.status || 0)) ||
                [-352, -509].includes(code) || /risk|频繁|风控|too fast/i.test(message);
              throw Object.assign(new Error(message), {
                global: loginSignal || riskSignal,
                apiCode: code,
                loginSignal,
                riskSignal
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
            completedSinceCheckpoint += 1;
            checkpointDirty = true;
            if (store.queue.length === 0 || completedSinceCheckpoint >= 25 || Date.now() - lastCheckpointAt >= 4000) {
              writeStore();
              completedSinceCheckpoint = 0;
              lastCheckpointAt = Date.now();
              checkpointDirty = false;
            }
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
              const apiCode = Number(error?.apiCode)
              const loginSignal = Boolean(error?.loginSignal) || apiCode === -101 || /login|未登录/i.test(message)
              const riskSignal = Boolean(error?.riskSignal) || [-352, -412, -509].includes(apiCode) ||
                /risk|频繁|风控|too fast|captcha|安全验证/i.test(message)
              store.progress.errorKind = loginSignal ? 'login' : riskSignal ? 'risk-control' : 'unknown'
              if (Number.isFinite(apiCode)) store.progress.errorCode = apiCode
              store.progress.errorMessage = message.slice(0, 160)
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
        } finally {
          try {
            if (checkpointDirty) writeStore();
          } catch (error) {
            try {
              store.progress.status = 'paused';
              store.progress.errorKind = 'unknown';
              store.progress.errorMessage = String(error?.message || error || 'tag worker failed').slice(0, 160);
              localStorage.setItem(key, JSON.stringify(store));
            } catch { /* Preserve the worker release even when storage is unavailable. */ }
          }
          window.__bilimiOldFavoriteTagWorkerRunning = false;
          let handoffStore;
          try { handoffStore = JSON.parse(localStorage.getItem(key) || '{}'); } catch { handoffStore = {}; }
          if (handoffStore.progress?.status === 'running' && Array.isArray(handoffStore.queue) && handoffStore.queue.length > 0) {
            setTimeout(() => {
              if (!window.__bilimiOldFavoriteTagWorkerRunning) window.__bilimiStartOldFavoriteTagWorker?.();
            }, 0);
          }
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
      delete store.progress.errorKind;
      delete store.progress.errorCode;
      delete store.progress.errorMessage;
    }
    if (${JSON.stringify(action)} === 'cancel') {
      store.controlRevision += 1;
      store.queue = [];
      store.progress.pending = 0;
      store.progress.status = store.progress.completed < store.progress.total ? 'partial' : 'complete';
      if (store.progress.status === 'partial') store.progress.terminalReason = 'cancelled';
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
    const progressReadCursorKey = '__bilimiOldFavoriteProgressReadCursor';
    const readySegmentCursorKey = '__bilimiOldFavoriteReadySegmentCursor';
    const sourceUpdateCursorKey = '__bilimiOldFavoriteSourceUpdateCursor';
    const allDiscoveredAids = Array.isArray(store.lastScan?.discoveredAids)
      ? store.lastScan.discoveredAids
      : [];
    const progressCursor = ${JSON.stringify(action)} === 'progress'
      ? Math.max(0, Number(window[progressReadCursorKey] || 0))
      : 0;
    const discoveredAids = ${JSON.stringify(action)} === 'progress'
      ? allDiscoveredAids.slice(progressCursor)
      : allDiscoveredAids;
    if (${JSON.stringify(action)} === 'progress') window[progressReadCursorKey] = allDiscoveredAids.length;
    const allReadySegments = Array.isArray(store.lastScan?.readySegments) ? store.lastScan.readySegments : [];
    const readySegmentCursor = ${JSON.stringify(action)} === 'progress'
      ? Math.max(0, Number(window[readySegmentCursorKey] || 0))
      : 0;
    const readySegments = ${JSON.stringify(action)} === 'progress'
      ? allReadySegments.slice(readySegmentCursor)
      : allReadySegments;
    if (${JSON.stringify(action)} === 'progress') window[readySegmentCursorKey] = allReadySegments.length;
    const allSourceUpdates = Array.isArray(store.lastScan?.sourceUpdates) ? store.lastScan.sourceUpdates : [];
    const sourceUpdateCursor = ${JSON.stringify(action)} === 'progress'
      ? Math.max(0, Number(window[sourceUpdateCursorKey] || 0))
      : 0;
    const sourceUpdates = ${JSON.stringify(action)} === 'progress'
      ? allSourceUpdates.slice(sourceUpdateCursor)
      : allSourceUpdates;
    if (${JSON.stringify(action)} === 'progress') window[sourceUpdateCursorKey] = allSourceUpdates.length;
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
      discoveredAids,
      readySegments,
      sourceUpdates,
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
          window.__bilimiOldFavoriteProgressReadCursor = 0;
          window.__bilimiOldFavoriteReadySegmentCursor = 0;
          window.__bilimiOldFavoriteSourceUpdateCursor = 0;
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
        const normalizedLedgerName = (value) => String(value ?? '')
          .trim()
          .replace(/^bilimi[·\\s\\-路]*/i, '')
          .replace(/·[2-9]\\d*$/, '')
          .trim();
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
        // A user batch scans to exhaustion; performance segmentation happens after discovery.
        const batchLimit = Number.POSITIVE_INFINITY;
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
        const streamingAidOwners = new Map();
        const streamingSegments = [];
        const streamingSourceUpdates = [];
        const streamingSettlements = [];
        let streamingSettlementTail = Promise.resolve();
        let streamingGloballyPaused = false;
        let streamingPauseError = null;
        let streamingStopped = false;
        let streamingOpen = null;
        let inProgressFolderAids = new Set();
        let lastBasicCheckpointAt = -1;
        const persistBasicProgress = (status = 'running', location = {}) => {
          const visibleAids = new Set([...discoveredVideoAids, ...inProgressFolderAids]);
          const now = Date.now();
          if (
            status === 'running' &&
            lastBasicCheckpointAt >= 0 &&
            visibleAids.size % 2000 !== 0 &&
            now - lastBasicCheckpointAt < 4000
          ) return;
          const latest = readTagStore();
          if (Number(latest.controlRevision || 0) !== scanRevision) return;
          const previousTotal = latest.lastScan?.basic?.runId === scanRunId
            ? Number(latest.lastScan?.basic?.total || 0)
            : 0;
          latest.lastScan = {
            ...(latest.lastScan ?? {}),
            sourceFolders: latest.lastScan?.sourceFolders ?? [],
            discoveredAids: Array.from(visibleAids),
            basic: {
              completed: visibleAids.size,
              total: Math.max(visibleAids.size, previousTotal),
              status,
              runId: scanRunId,
              ...location
            }
          };
          writeTagStore(latest);
          lastBasicCheckpointAt = now;
        };
        const persistStreamingSegments = () => {
          const latest = readTagStore();
          if (Number(latest.controlRevision || 0) !== scanRevision) return;
          latest.lastScan = {
            ...(latest.lastScan || {}),
            readySegments: streamingSegments.filter((segment) => segment.status === 'ready'),
            sourceUpdates: streamingSourceUpdates
          };
          writeTagStore(latest);
        };
        const settleStreamingSegment = async (segment) => {
          const controlStopped = () => {
            if (streamingStopped || scanWasCancelled()) return true;
            const latest = readTagStore();
            return Number(latest.controlRevision || 0) !== scanRevision;
          };
          const unresolved = segment.sourceFolders.flatMap((folder) => folder.videos)
            .filter((video) => !Array.isArray(video.tags) || video.tags.length === 0);
          let globallyPaused = false;
          for (const video of unresolved) {
            if (controlStopped()) {
              streamingStopped = true;
              break;
            }
            let settledTags = [];
            for (let attempt = 1; attempt <= 3; attempt += 1) {
              if (controlStopped()) {
                streamingStopped = true;
                break;
              }
              try {
                await paceInitialTagRequest();
                const response = await fetchWithTimeout(buildTagUrl(video.aid));
                if (controlStopped()) {
                  streamingStopped = true;
                  break;
                }
                const json = await ensureApiOk(response, 'video tag list for ' + video.aid);
                const rawTags = Array.isArray(json.data)
                  ? json.data
                  : (Array.isArray(json.data?.tags) ? json.data.tags : []);
                settledTags = readQueuedTagList(rawTags);
                tagStore.cache[String(video.aid)] = { tags: settledTags, updatedAt: Date.now() };
                missingTagAids.delete(video.aid);
                cacheHitAids.add(video.aid);
                break;
              } catch (error) {
                const message = String(error?.message || error || '');
                if (/(-101|-352|-412|-509|risk|too fast|login|returned HTML)/i.test(message)) {
                  const apiCode = Number(error?.apiCode);
                  const loginSignal = Boolean(error?.loginSignal) || apiCode === -101 || /login|未登录/i.test(message);
                  const riskSignal = Boolean(error?.riskSignal) || [-352, -412, -509].includes(apiCode) ||
                    /risk|频繁|风控|too fast|captcha|安全验证/i.test(message);
                  streamingPauseError = {
                    errorKind: loginSignal ? 'login' : riskSignal ? 'risk-control' : 'unknown',
                    ...(Number.isFinite(apiCode) ? { errorCode: apiCode } : {}),
                    errorMessage: message.slice(0, 160)
                  };
                  globallyPaused = true;
                  streamingGloballyPaused = true;
                  break;
                }
                if (attempt < 3) {
                  await wait(Math.min(8000, 750 * (2 ** attempt)));
                  if (controlStopped()) {
                    streamingStopped = true;
                    break;
                  }
                }
              }
            }
            if (streamingStopped) break;
            video.tags = settledTags;
            if (globallyPaused) break;
          }
          segment.status = globallyPaused || streamingStopped ? 'paused' : 'ready';
          persistStreamingSegments();
        };
        const enqueueStreamingSettlement = (segment) => {
          const settlement = streamingSettlementTail.then(() => {
            if (streamingStopped) {
              segment.status = 'paused';
              persistStreamingSegments();
              return;
            }
            return settleStreamingSegment(segment);
          });
          streamingSettlementTail = settlement.catch(() => undefined);
          streamingSettlements.push(settlement);
        };
        const recordStreamingVideos = (folderId, folderTitle, videos) => {
          if (payload.aid) return;
          for (const video of videos) {
            const owner = streamingAidOwners.get(video.aid);
            if (owner) {
              const relationKey = owner.sources.join(':') + ':' + String(folderId);
              if (!owner.sources.includes(String(folderId))) {
                owner.sources.push(String(folderId));
                streamingSourceUpdates.push({
                  aid: video.aid,
                  segmentIndex: owner.segmentIndex,
                  folderId: String(folderId),
                  folderTitle: String(folderTitle || folderId),
                  relationKey
                });
              }
              continue;
            }
            if (!streamingOpen) {
              streamingOpen = {
                index: streamingSegments.length,
                status: 'running',
                aids: [],
                sourceFolders: []
              };
              streamingSegments.push(streamingOpen);
            }
            let sourceFolder = streamingOpen.sourceFolders.find((folder) => folder.id === String(folderId));
            if (!sourceFolder) {
              sourceFolder = { id: String(folderId), title: String(folderTitle || ''), videos: [] };
              streamingOpen.sourceFolders.push(sourceFolder);
            }
            streamingOpen.aids.push(video.aid);
            sourceFolder.videos.push(video);
            streamingAidOwners.set(video.aid, {
              segmentIndex: streamingOpen.index,
              sources: [String(folderId)]
            });
            if (streamingOpen.aids.length === 2_000) {
              streamingOpen.status = 'tagging';
              enqueueStreamingSettlement(streamingOpen);
              streamingOpen = null;
            }
          }
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
              recordStreamingVideos(folderId, folderTitle, businessPageVideos);
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

        if (!payload.aid && streamingOpen && streamingOpen.aids.length > 0) {
          streamingOpen.status = 'tagging';
          if (streamingOpen.aids.length >= 1_000) enqueueStreamingSettlement(streamingOpen);
          streamingOpen = null;
        }
        if (!payload.aid && streamingSettlements.length > 0) await Promise.all(streamingSettlements);

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
          readySegments: streamingSegments.filter((segment) => segment.status === 'ready'),
          pendingSegments: streamingSegments.filter((segment) => segment.status !== 'ready'),
          sourceUpdates: streamingSourceUpdates,
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
          status: queuedAids.length > 0 ? (streamingGloballyPaused ? 'paused' : 'running') : 'complete',
          ...(streamingPauseError || {})
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
            try {
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
                  const apiCode = Number(error?.apiCode)
                  const loginSignal = Boolean(error?.loginSignal) || apiCode === -101 || /login|未登录/i.test(message)
                  const riskSignal = Boolean(error?.riskSignal) || [-352, -412, -509].includes(apiCode) ||
                    /risk|频繁|风控|too fast|captcha|安全验证/i.test(message)
                  latestStore.progress.errorKind = loginSignal ? 'login' : riskSignal ? 'risk-control' : 'unknown'
                  if (Number.isFinite(apiCode)) latestStore.progress.errorCode = apiCode
                  latestStore.progress.errorMessage = message.slice(0, 160)
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
            } finally {
              try { writeTagStore(latestStore); } catch { /* Keep cleanup deterministic when storage fails. */ }
              window.__bilimiOldFavoriteTagWorkerRunning = false;
              const handoffStore = readTagStore();
              if (handoffStore.progress?.status === 'running' && handoffStore.queue.length > 0) {
                setTimeout(() => {
                  if (!window.__bilimiOldFavoriteTagWorkerRunning) window.__bilimiStartOldFavoriteTagWorker?.();
                }, 0);
              }
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
  pacingOptions: FavoriteLedgerExecutionPacingOptions = {},
  expectedAccountMid = ''
): string {
  const payload = scriptPayload({
    items,
    expectedAccountMid: expectedAccountMid.trim(),
    pacing: {
      appendDelayMs: pacingOptions.appendDelayMs ?? { min: 1200, max: 2000 },
      cooldownDelayMs: pacingOptions.cooldownDelayMs ?? { min: 15000, max: 45000 },
      cooldownEvery: pacingOptions.cooldownEvery ?? 0
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
      const isProtectionFailure = (error) => Boolean(
        error?.riskSignal ||
        [403, 412].includes(Number(error?.httpStatus || 0)) ||
        [-352, -509].includes(Number(error?.apiCode || 0)) ||
        /-509|-352|(?:http|status)?\s*412|request too fast|too many|rate|frequency|frequent|captcha|verify|protection|risk|风控|访问受限|安全验证/i.test(
          String(error?.message || error || '')
        )
      );
      const isUnknownWriteResult = (error) =>
        error?.name === 'AbortError' ||
        /abort|interrupted|networkerror|failed to fetch|load failed/i.test(String(error?.message || error || ''));
      const accountMismatchResult = (message = 'The signed-in Bilibili account changed during execution.') => ({
        ok: false,
        paused: true,
        resultUnknown: true,
        steps,
        missingTargets: ['bilibili-account'],
        completedItems,
        message
      });
      const assertExpectedAccount = () => {
        if (!payload.expectedAccountMid) return;
        const { mid } = readCredentials();
        if (!mid || String(mid) !== String(payload.expectedAccountMid)) {
          const error = new Error('bilibili-account-mismatch');
          error.accountMismatch = true;
          throw error;
        }
      };

      try {
        const { csrf } = readCredentials();
        if (!csrf) {
          return { ok: false, steps, missingTargets, message: '未能读取登录凭据，无法归册。' };
        }
        try {
          assertExpectedAccount();
        } catch (error) {
          return accountMismatchResult();
        }

        const filteredItems = payload.items.filter((item) => {
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
        const executableItems = [];
        const normalItemsByAid = new Map();
        for (const item of filteredItems) {
          if (item.reorganizeProtected) {
            executableItems.push(item);
            continue;
          }
          const key = String(item.aid);
          const grouped = normalItemsByAid.get(key);
          if (grouped) {
            grouped.groupedItems.push(item);
          } else {
            const group = { ...item, groupedItems: [item] };
            normalItemsByAid.set(key, group);
            executableItems.push(group);
          }
        }
        const protectionPausedResult = (item, index, message) => {
          appendFailures.push({ aid: item.aid, title: item.title, message });
          steps.push('api:ledger:protection-paused:' + item.aid);
          return {
            ok: false,
            steps,
            missingTargets: ['favorite-ledger-protection'],
            message: protectionMessage,
            paused: true,
            partial: completedItems.length > 0,
            completedItems,
            completedCount: completedItems.length,
            failedCount: appendFailures.length,
            remainingCount: executableItems.length - index - 1
          };
        };

        const appendItemFolders = async (item, addFolderIds) => {
          assertExpectedAccount();
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
        const removeItemFolders = async (item, removeFolderIds) => {
          assertExpectedAccount();
          const body = new URLSearchParams();
          body.set('del_media_ids', removeFolderIds.join(','));
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
          await ensureApiOk(response, 'favorite ledger staging removal');
        };
        const trimFolderTitle = (title, limit) => Array.from(String(title || '').trim()).slice(0, limit).join('');
        const logicalFolderTitle = (title) => trimFolderTitle(String(title || '').trim().replace(/·[2-9]\d*$/, ''), 14);
        const physicalShardNumber = (title) => {
          const match = String(title || '').trim().match(/·([2-9]\d*)$/);
          return match ? Number(match[1]) : 1;
        };
        const physicalShardTitle = (logicalTitle, shardNumber) => {
          const base = trimFolderTitle(logicalTitle, 14);
          if (shardNumber <= 1) return base;
          const suffix = '·' + shardNumber;
          return trimFolderTitle(base, 20 - Array.from(suffix).length) + suffix;
        };
        let remoteFolderSnapshotPromise;
        const readRemoteFolderSnapshot = async () => {
          if (!remoteFolderSnapshotPromise) {
            remoteFolderSnapshotPromise = (async () => {
              assertExpectedAccount();
              const { mid } = readCredentials();
              if (!mid) throw createApiError('favorite folder list requires an account', { kind: 'credentials' });
              const response = await fetch(buildListUrl(mid), { credentials: 'include' });
              const json = await ensureApiOk(response, 'favorite folder list');
              const folders = Array.isArray(json.data?.list) ? json.data.list : [];
              return folders.map((folder) => ({
                id: String(findFolderId(folder) || ''),
                title: String(folder?.title || ''),
                memberAids: null
              })).filter((folder) => folder.id);
            })();
          }
          return remoteFolderSnapshotPromise;
        };
        const readShardMembers = async (shard) => {
          if (Array.isArray(shard.memberAids)) return shard.memberAids;
          assertExpectedAccount();
          const url = new URL('https://api.bilibili.com/x/v3/fav/resource/ids');
          url.searchParams.set('media_id', shard.id);
          const response = await fetch(url.toString(), { credentials: 'include' });
          const json = await ensureApiOk(response, 'favorite shard membership for folder ' + shard.id);
          if (!Array.isArray(json.data)) {
            throw createApiError('favorite shard membership returned invalid id data', { kind: 'schema' });
          }
          shard.memberAids = Array.from(new Set(json.data
            .filter((entry) => Number(entry?.type) === 2)
            .map((entry) => Number(entry?.id ?? entry?.aid))
            .filter((aid) => Number.isFinite(aid) && aid > 0)));
          return shard.memberAids;
        };
        const createPhysicalShard = async (logicalTitle, shardNumber) => {
          assertExpectedAccount();
          const body = new URLSearchParams();
          body.set('csrf', csrf);
          body.set('privacy', '0');
          body.set('title', physicalShardTitle(logicalTitle, shardNumber));
          const response = await fetch('https://api.bilibili.com/x/v3/fav/folder/add', {
            method: 'POST',
            credentials: 'include',
            headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
            body
          });
          const json = await ensureApiOk(response, 'favorite physical shard create');
          const folderId = json.data?.id ?? json.data?.fid;
          if (!folderId) throw createApiError('favorite physical shard create returned no folder id', { kind: 'schema' });
          const shard = { id: String(folderId), title: physicalShardTitle(logicalTitle, shardNumber), memberAids: [] };
          const folders = await readRemoteFolderSnapshot();
          folders.push(shard);
          steps.push('api:ledger:shard-created:' + shard.id);
          return shard;
        };
        const resolvePhysicalTarget = async (item) => {
          if (!/^bilimi·/i.test(String(item.targetDisplayName || '').trim())) {
            return { state: 'ready', folderId: String(item.targetFolderId || '') };
          }
          let folders;
          folders = await readRemoteFolderSnapshot();
          const logicalTitle = logicalFolderTitle(item.targetDisplayName);
          const shards = folders
            .filter((folder) => logicalFolderTitle(folder.title) === logicalTitle)
            .sort((left, right) => physicalShardNumber(left.title) - physicalShardNumber(right.title));
          if (shards.length === 0) {
            return { state: 'ready', folderId: String(item.targetFolderId || '') };
          }
          try {
            await Promise.all(shards.map(readShardMembers));
          } catch (error) {
            return { state: 'membership-incomplete', error };
          }
          const existing = shards.find((shard) => shard.memberAids.includes(Number(item.aid)));
          if (existing) return { state: 'already-member', folderId: existing.id };
          let target = [...shards].reverse().find((shard) => shard.memberAids.length < 1000);
          if (!target) {
            try {
              target = await createPhysicalShard(logicalTitle, Math.max(...shards.map((shard) => physicalShardNumber(shard.title))) + 1);
            } catch (error) {
              if (error?.accountMismatch) throw error;
              return { state: 'create-failed', error };
            }
          }
          target.memberAids.push(Number(item.aid));
          return { state: 'ready', folderId: target.id };
        };
        const resolveAllStagingFolderIds = async (item, suppliedIds) => {
          let folders;
          try {
            folders = await readRemoteFolderSnapshot();
          } catch (error) {
            if (error?.accountMismatch) throw error;
            return { state: 'ready', folderIds: suppliedIds };
          }
          const stagingShards = folders.filter((folder) => logicalFolderTitle(folder.title) === 'bilimi·暂存');
          for (const shard of stagingShards) {
            try {
              const memberAids = await readShardMembers(shard);
              if (memberAids.includes(Number(item.aid))) suppliedIds.push(shard.id);
            } catch (error) {
              if (error?.accountMismatch) throw error;
              return { state: 'membership-incomplete', folderIds: Array.from(new Set(suppliedIds)), error };
            }
          }
          return { state: 'ready', folderIds: Array.from(new Set(suppliedIds)) };
        };
        const physicalTargetPausedResult = (item, index, missingTarget, message) => ({
          ok: false,
          paused: true,
          partial: completedItems.length > 0,
          steps,
          missingTargets: [missingTarget],
          completedItems,
          completedCount: completedItems.length,
          failedCount: 1,
          remainingCount: executableItems.length - index,
          message
        });
        const unknownWritePausedResult = (item, index, message) => ({
          ok: false,
          paused: true,
          resultUnknown: true,
          partial: completedItems.length > 0,
          steps: [...steps, 'api:ledger:result-unknown:' + item.aid],
          missingTargets: ['favorite-ledger-reconcile:' + item.aid],
          completedItems,
          completedCount: completedItems.length,
          failedCount: 0,
          remainingCount: executableItems.length - index,
          message: 'The last favorite request has an unknown result. Reconcile before continuing: ' + message
        });
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

          const cooldownEvery = Math.max(0, Number(payload.pacing.cooldownEvery || 0));
          const shouldCooldown = cooldownEvery > 0 && completedCount % cooldownEvery === 0;
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
            try {
              let resolvedDesiredFolderIds = desiredFolderIds;
              if (desiredFolderIds.length === 1) {
                const resolution = await resolvePhysicalTarget(item);
                if (resolution.state === 'membership-incomplete') {
                  return physicalTargetPausedResult(item, index, 'favorite-ledger-membership-incomplete', 'Formal favorite membership is incomplete; execution is paused.');
                }
                if (resolution.state === 'create-failed') {
                  return physicalTargetPausedResult(item, index, 'favorite-ledger-shard:' + item.targetLedgerId, 'Creating the next favorite shard failed; this target is paused.');
                }
                if (!resolution.folderId) throw new Error(syncRequiredMessage);
                resolvedDesiredFolderIds = [String(resolution.folderId)];
              }
              const addedFolderIds = resolvedDesiredFolderIds.filter((folderId) => !currentFolderIds.includes(folderId));
              if (addedFolderIds.length > 0) {
                await appendItemFolders(item, addedFolderIds);
                steps.push('api:ledger:append:' + item.aid + ':' + addedFolderIds.join(','));
              }
              const removedFolderIds = desiredFolderIds.length === 1
                ? currentFolderIds.filter((folderId) => !resolvedDesiredFolderIds.includes(folderId))
                : [];
              if (removedFolderIds.length > 0) {
                await removeItemFolders(item, removedFolderIds);
                steps.push('api:ledger:remove:' + item.aid + ':' + removedFolderIds.join(','));
              }
              completedItems.push({
                ...item,
                finalFolderIds: desiredFolderIds.length === 1
                  ? resolvedDesiredFolderIds
                  : Array.from(new Set([...currentFolderIds, ...resolvedDesiredFolderIds])),
                addedFolderIds,
                removedFolderIds
              });
            } catch (error) {
              if (error?.accountMismatch) return accountMismatchResult();
              const errorMessage = error instanceof Error ? error.message : String(error || 'unknown error');
              if (isProtectionFailure(error)) {
                return protectionPausedResult(item, index, errorMessage);
              }
              if (isUnknownWriteResult(error)) {
                return unknownWritePausedResult(item, index, errorMessage);
              }
              appendFailures.push({ aid: item.aid, title: item.title, message: errorMessage, partial: false });
              missingTargets.push('favorite-ledger-reconcile:' + item.aid);
              steps.push('api:ledger:reconcile-failed:' + item.aid);
            }
            await paceBeforeNextItem(completedItems.length, index < executableItems.length - 1);
            continue;
          }
          const groupedItems = Array.isArray(item.groupedItems) ? item.groupedItems : [item];
          let stagingFolderIds = Array.from(new Set(
            groupedItems.flatMap((groupedItem) => groupedItem.stagingFolderIds ?? []).map(String).filter(Boolean)
          ));
          const stagingResolution = await resolveAllStagingFolderIds(item, stagingFolderIds);
          if (stagingResolution.state === 'membership-incomplete') {
            return unknownWritePausedResult(item, index, 'Staging favorite membership is incomplete.');
          }
          stagingFolderIds = stagingResolution.folderIds;
          if (stagingFolderIds.length > 0) {
            const successfulItems = [];
            for (const groupedItem of groupedItems) {
              try {
                const resolution = await resolvePhysicalTarget(groupedItem);
                if (resolution.state === 'membership-incomplete') {
                  return physicalTargetPausedResult(item, index, 'favorite-ledger-membership-incomplete', 'Formal favorite membership is incomplete; execution is paused.');
                }
                if (resolution.state === 'create-failed') {
                  return physicalTargetPausedResult(item, index, 'favorite-ledger-shard:' + groupedItem.targetLedgerId, 'Creating the next favorite shard failed; this target is paused.');
                }
                if (resolution.state === 'already-member') {
                  successfulItems.push({ ...groupedItem, targetFolderId: resolution.folderId });
                  steps.push('api:ledger:already-member:' + groupedItem.aid + ':' + resolution.folderId);
                  continue;
                }
                if (!resolution.folderId) {
                  throw new Error(syncRequiredMessage);
                }
                await appendItemFolders(groupedItem, [resolution.folderId]);
                successfulItems.push({ ...groupedItem, targetFolderId: resolution.folderId });
                steps.push('api:ledger:append:' + groupedItem.aid + ':' + resolution.folderId);
              } catch (error) {
                if (error?.accountMismatch) return accountMismatchResult();
                const errorMessage = error instanceof Error ? error.message : String(error || 'unknown error');
                if (isProtectionFailure(error)) {
                  return protectionPausedResult(item, index, errorMessage);
                }
                if (isUnknownWriteResult(error)) {
                  return unknownWritePausedResult(item, index, errorMessage);
                }
                appendFailures.push({ aid: groupedItem.aid, title: groupedItem.title, message: errorMessage, partial: successfulItems.length > 0 });
                missingTargets.push('favorite-ledger-append:' + groupedItem.aid + ':' + groupedItem.targetLedgerId);
                steps.push('api:ledger:append-failed:' + groupedItem.aid + ':' + groupedItem.targetLedgerId);
              }
            }
            if (successfulItems.length > 0) {
              try {
                await removeItemFolders(item, stagingFolderIds);
                steps.push('api:ledger:staging-removed:' + item.aid);
              } catch (error) {
                if (error?.accountMismatch) return accountMismatchResult();
                const errorMessage = error instanceof Error ? error.message : String(error || 'unknown error');
                if (isProtectionFailure(error)) {
                  return protectionPausedResult(item, index, errorMessage);
                }
                if (isUnknownWriteResult(error)) {
                  return unknownWritePausedResult(item, index, errorMessage);
                }
                appendFailures.push({ aid: item.aid, title: item.title, message: errorMessage, partial: true });
                missingTargets.push('favorite-ledger-staging-remove:' + item.aid);
                steps.push('api:ledger:staging-remove-failed:' + item.aid);
              }
              completedItems.push(...successfulItems);
            }
            await paceBeforeNextItem(completedItems.length, index < executableItems.length - 1);
            continue;
          }
          try {
            const resolvedItems = [];
            for (const groupedItem of groupedItems) {
              const resolution = await resolvePhysicalTarget(groupedItem);
              if (resolution.state === 'membership-incomplete') {
                return physicalTargetPausedResult(item, index, 'favorite-ledger-membership-incomplete', 'Formal favorite membership is incomplete; execution is paused.');
              }
              if (resolution.state === 'create-failed') {
                return physicalTargetPausedResult(item, index, 'favorite-ledger-shard:' + groupedItem.targetLedgerId, 'Creating the next favorite shard failed; this target is paused.');
              }
              if (resolution.state === 'already-member') {
                resolvedItems.push({ ...groupedItem, targetFolderId: resolution.folderId, alreadyInTarget: true });
                continue;
              }
              let targetFolderId = resolution.folderId || groupedItem.targetFolderId;
              if (!targetFolderId && groupedItem.selectedCandidateTarget) {
                targetFolderId = await refreshTargetFolderId(groupedItem.targetDisplayName);
                if (targetFolderId) {
                  steps.push('api:ledger:append-refresh:' + groupedItem.aid);
                }
              }
              if (!targetFolderId) {
                missingTargets.push(groupedItem.targetLedgerId);
                syncRequired = true;
                throw new Error(syncRequiredMessage);
              }
              resolvedItems.push({ ...groupedItem, targetFolderId: String(targetFolderId) });
            }
            const addFolderIds = Array.from(new Set(resolvedItems.filter((entry) => !entry.alreadyInTarget).map((entry) => entry.targetFolderId)));
            if (addFolderIds.length > 0) await appendItemFolders(item, addFolderIds);
            completedItems.push(...resolvedItems);
            steps.push('api:ledger:append:' + item.aid);
          } catch (error) {
            if (error?.accountMismatch) return accountMismatchResult();
            const errorMessage = error instanceof Error ? error.message : String(error || 'unknown error');
            if (isProtectionFailure(error)) {
              return protectionPausedResult(item, index, errorMessage);
            }
            if (isUnknownWriteResult(error)) {
              return unknownWritePausedResult(item, index, errorMessage);
            }

            try {
              const refreshedItems = [];
              let changed = false;
              for (const groupedItem of groupedItems) {
                const refreshedFolderId = await refreshTargetFolderId(groupedItem.targetDisplayName);
                if (!refreshedFolderId) {
                  syncRequired = true;
                  throw error;
                }
                changed ||= refreshedFolderId !== String(groupedItem.targetFolderId ?? '');
                refreshedItems.push({ ...groupedItem, targetFolderId: String(refreshedFolderId) });
              }
              if (!changed) {
                throw error;
              }

              steps.push('api:ledger:append-retry:' + item.aid);
              await appendItemFolders(item, Array.from(new Set(refreshedItems.map((entry) => entry.targetFolderId))));
              completedItems.push(...refreshedItems);
              steps.push('api:ledger:append:' + item.aid);
            } catch (retryError) {
              if (retryError?.accountMismatch) return accountMismatchResult();
              const retryMessage = retryError instanceof Error ? retryError.message : String(retryError || '');
              if (isProtectionFailure(retryError)) {
                return protectionPausedResult(item, index, retryMessage);
              }
              if (isUnknownWriteResult(retryError)) {
                return unknownWritePausedResult(item, index, retryMessage);
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
            partial: completedItems.length > 0 || appendFailures.some((failure) => failure.partial),
            steps,
            missingTargets,
            completedItems,
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
