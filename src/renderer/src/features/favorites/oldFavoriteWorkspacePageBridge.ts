export type OldFavoriteWorkspacePageTarget = {
  webContentsId: number
  instanceId: string
  navigationEpoch: number
}

export type OldFavoriteWorkspaceInventoryCommand = {
  type: 'inventory'
  accountMid: string
}

export type OldFavoriteWorkspaceManagedMembersCommand = {
  type: 'read-managed-members'
  accountMid: string
  folderIds: string[]
}

export type OldFavoriteWorkspaceSourcePageCommand = {
  type: 'read-source-page'
  accountMid: string
  folderId: string
  page: number
  pageSize: number
}

export type OldFavoriteWorkspacePageCommand =
  | OldFavoriteWorkspaceInventoryCommand
  | OldFavoriteWorkspaceManagedMembersCommand
  | OldFavoriteWorkspaceSourcePageCommand

export type OldFavoriteWorkspaceFolder = {
  id: string
  title: string
  mediaCount: number
}

export type OldFavoriteWorkspaceSourceItem = {
  aid: number
  title: string
  upperName: string
  cover: string
  addedAt: number
  tags: string[]
  category: string
}

type PageBaseResult = {
  status: 'ok' | 'rejected' | 'unknown'
  observedAccountMid: string
  reason?: string
}

export type OldFavoriteWorkspacePageResult =
  | (PageBaseResult & { folders: OldFavoriteWorkspaceFolder[] })
  | (PageBaseResult & { members: Record<string, number[]> })
  | (PageBaseResult & { items: OldFavoriteWorkspaceSourceItem[]; hasMore: boolean })

type PageExecutor = {
  execute: (target: OldFavoriteWorkspacePageTarget, script: string) => Promise<unknown>
}

const resultStatuses = new Set<PageBaseResult['status']>(['ok', 'rejected', 'unknown'])

function normalizeAccountMid(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!/^\d+$/.test(raw)) return ''
  const normalized = raw.replace(/^0+(?=\d)/, '')
  return normalized === '0' ? '' : normalized
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isTarget(value: unknown): value is OldFavoriteWorkspacePageTarget {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const target = value as Record<string, unknown>
  return isPositiveInteger(target.webContentsId) &&
    typeof target.instanceId === 'string' && target.instanceId.trim().length > 0 &&
    typeof target.navigationEpoch === 'number' && Number.isSafeInteger(target.navigationEpoch) && target.navigationEpoch >= 0
}

function isFolderId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 128
}

function isCommand(value: unknown): value is OldFavoriteWorkspacePageCommand {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const command = value as Record<string, unknown>
  if (!normalizeAccountMid(command.accountMid)) return false
  if (command.type === 'inventory') return Object.keys(command).every((key) => key === 'type' || key === 'accountMid')
  if (command.type === 'read-managed-members') {
    return Object.keys(command).every((key) => key === 'type' || key === 'accountMid' || key === 'folderIds') &&
      Array.isArray(command.folderIds) && command.folderIds.length > 0 && command.folderIds.length <= 10 && command.folderIds.every(isFolderId)
  }
  if (command.type === 'read-source-page') {
    return Object.keys(command).every((key) => key === 'type' || key === 'accountMid' || key === 'folderId' || key === 'page' || key === 'pageSize') &&
      isFolderId(command.folderId) && isPositiveInteger(command.page) && command.page <= 100_000 &&
      isPositiveInteger(command.pageSize) && command.pageSize <= 50
  }
  return false
}

function isBaseResult(value: unknown): value is PageBaseResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const result = value as Record<string, unknown>
  return resultStatuses.has(result.status as PageBaseResult['status']) &&
    typeof result.observedAccountMid === 'string' &&
    (result.reason === undefined || typeof result.reason === 'string')
}

function isFolder(value: unknown): value is OldFavoriteWorkspaceFolder {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const folder = value as Record<string, unknown>
  return Object.keys(folder).every((key) => key === 'id' || key === 'title' || key === 'mediaCount') &&
    isFolderId(folder.id) && typeof folder.title === 'string' && folder.title.length <= 512 &&
    typeof folder.mediaCount === 'number' && Number.isSafeInteger(folder.mediaCount) && folder.mediaCount >= 0
}

function isMembers(value: unknown): value is Record<string, number[]> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.entries(value).every(([folderId, aids]) => isFolderId(folderId) && Array.isArray(aids) && aids.every(isPositiveInteger))
}

function isSourceItem(value: unknown): value is OldFavoriteWorkspaceSourceItem {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return Object.keys(item).every((key) => key === 'aid' || key === 'title' || key === 'upperName' || key === 'cover' || key === 'addedAt' || key === 'tags' || key === 'category') &&
    isPositiveInteger(item.aid) && typeof item.title === 'string' && item.title.length <= 1024 &&
    typeof item.upperName === 'string' && item.upperName.length <= 512 &&
    typeof item.cover === 'string' && item.cover.length <= 2048 &&
    typeof item.addedAt === 'number' && Number.isSafeInteger(item.addedAt) && item.addedAt >= 0 &&
    Array.isArray(item.tags) && item.tags.length <= 32 && item.tags.every((tag) => typeof tag === 'string' && tag.length <= 128) &&
    typeof item.category === 'string' && item.category.length <= 128
}

function resultFor(command: OldFavoriteWorkspacePageCommand, value: unknown): OldFavoriteWorkspacePageResult | null {
  if (!isBaseResult(value)) return null
  const result = value as Record<string, unknown>
  if (normalizeAccountMid(result.observedAccountMid) !== normalizeAccountMid(command.accountMid)) {
    return {
      status: 'unknown',
      observedAccountMid: typeof result.observedAccountMid === 'string' ? result.observedAccountMid : '',
      reason: 'account-mismatch'
    }
  }
  const baseKeys = new Set(['status', 'observedAccountMid', 'reason'])
  if (result.status !== 'ok' && Object.keys(result).every((key) => baseKeys.has(key))) {
    return result as OldFavoriteWorkspacePageResult
  }
  const validKeys = (keys: string[]) => Object.keys(result).every((key) => baseKeys.has(key) || keys.includes(key))
  if (command.type === 'inventory' && validKeys(['folders']) && Array.isArray(result.folders) && result.folders.every(isFolder)) {
    return result as OldFavoriteWorkspacePageResult
  }
  if (command.type === 'read-managed-members' && validKeys(['members']) && isMembers(result.members) &&
    Object.keys(result.members).length === new Set(command.folderIds).size &&
    command.folderIds.every((folderId) => Object.hasOwn(result.members, folderId))) {
    return result as OldFavoriteWorkspacePageResult
  }
  if (command.type === 'read-source-page' && validKeys(['items', 'hasMore']) && Array.isArray(result.items) && result.items.length <= command.pageSize && result.items.every(isSourceItem) && typeof result.hasMore === 'boolean') {
    return result as OldFavoriteWorkspacePageResult
  }
  return null
}

function scriptFor(command: OldFavoriteWorkspacePageCommand): string {
  const payload = JSON.stringify(command)
  const marker = command.type === 'inventory'
    ? 'inventory'
    : command.type === 'read-managed-members'
      ? 'managed-members'
      : 'source-page'
  const helpers = `
    const input = ${payload};
    const marker = 'scan-workspace-${marker}';
    void marker;
    const normalizeMid = (value) => {
      const raw = String(value || '').trim();
      if (!/^\\d+$/.test(raw)) return '';
      const normalized = raw.replace(/^0+(?=\\d)/, '');
      return normalized === '0' ? '' : normalized;
    };
    const readCookie = (name) => String(document.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(name + '='))?.slice(name.length + 1) || '';
    const observedAccountMid = normalizeMid(readCookie('DedeUserID'));
    if (!observedAccountMid || observedAccountMid !== normalizeMid(input.accountMid)) return { status: 'unknown', observedAccountMid, reason: 'account-mismatch' };
    const unknown = (reason) => ({ status: 'unknown', observedAccountMid: normalizeMid(readCookie('DedeUserID')), reason });
    const fetchJson = async (url) => {
      if (normalizeMid(readCookie('DedeUserID')) !== observedAccountMid) return { error: 'account-mismatch' };
      let response;
      try { response = await fetch(url, { credentials: 'include' }); } catch { return { error: 'network-failure' }; }
      let json;
      try { json = await response.json(); } catch { return { error: 'invalid-response' }; }
      if (normalizeMid(readCookie('DedeUserID')) !== observedAccountMid) return { error: 'account-mismatch' };
      if (!response.ok || json?.code !== 0) {
        return { error: 'remote-api-' + String(response.status) + '-' + String(json?.code ?? 'no-code') };
      }
      return { json };
    };
  `

  if (command.type === 'inventory') {
    return `(async () => {${helpers}
      const response = await fetchJson('https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=' + encodeURIComponent(observedAccountMid));
      if (response.error) return unknown(response.error);
      const folders = Array.isArray(response.json?.data?.list) ? response.json.data.list.map((folder) => ({
        id: String(folder?.id || '').trim(),
        title: String(folder?.title || ''),
        mediaCount: Number(folder?.media_count)
      })).filter((folder) => folder.id && Number.isSafeInteger(folder.mediaCount) && folder.mediaCount >= 0) : null;
      if (!folders) return unknown('invalid-inventory-response');
      return { status: 'ok', observedAccountMid, folders };
    })()`
  }

  if (command.type === 'read-managed-members') {
    return `(async () => {${helpers}
      const members = {};
      for (const folderId of [...new Set(input.folderIds.map((id) => String(id).trim()))]) {
        const response = await fetchJson('https://api.bilibili.com/x/v3/fav/resource/ids?media_id=' + encodeURIComponent(folderId));
        if (response.error) return unknown(response.error);
        if (!Array.isArray(response.json?.data)) return unknown('invalid-membership-response');
        members[folderId] = [...new Set(response.json.data.map((entry) => Number(entry?.id ?? entry?.aid)).filter((aid) => Number.isSafeInteger(aid) && aid > 0))];
      }
      return { status: 'ok', observedAccountMid, members };
    })()`
  }

  return `(async () => {${helpers}
    const url = new URL('https://api.bilibili.com/x/v3/fav/resource/list');
    url.searchParams.set('media_id', String(input.folderId).trim());
    url.searchParams.set('pn', String(input.page));
    url.searchParams.set('ps', String(input.pageSize));
    url.searchParams.set('order', 'mtime');
    url.searchParams.set('type', '0');
    url.searchParams.set('platform', 'web');
    const response = await fetchJson(url.toString());
    if (response.error) return unknown(response.error);
    if (!Array.isArray(response.json?.data?.medias)) return unknown('invalid-source-page-response');
    const readTags = (value) => (Array.isArray(value) ? value : [])
      .map((tag) => String((tag?.tag_name ?? tag?.name ?? tag?.title ?? tag) || '').trim())
      .filter(Boolean)
      .slice(0, 32);
    const rawItems = response.json.data.medias.map((media) => ({
      aid: Number(media?.id ?? media?.aid),
      title: String(media?.title || ''),
      upperName: String(media?.upper?.name || ''),
      cover: String(media?.cover || ''),
      addedAt: Number(media?.fav_time ?? media?.ctime ?? 0),
      tags: readTags(media?.tags ?? media?.tag),
      category: String(media?.tname ?? media?.category ?? media?.typename ?? media?.type_name ?? '').trim().slice(0, 128)
    })).filter((item) => Number.isSafeInteger(item.aid) && item.aid > 0 && Number.isSafeInteger(item.addedAt) && item.addedAt >= 0).slice(0, input.pageSize);
    for (const item of rawItems) {
      if (item.tags.length) continue;
      const tagUrl = new URL('https://api.bilibili.com/x/tag/archive/tags');
      tagUrl.searchParams.set('aid', String(item.aid));
      const tagResponse = await fetchJson(tagUrl.toString());
      // Missing tags are non-fatal; the rest of the bounded source page remains usable.
      if (!tagResponse.error) item.tags = readTags(tagResponse.json?.data?.tags ?? tagResponse.json?.data);
    }
    const items = rawItems;
    return { status: 'ok', observedAccountMid, items, hasMore: Boolean(response.json?.data?.has_more) };
  })()`
}

export function createOldFavoriteWorkspacePageBridge(options: PageExecutor) {
  return {
    async run(target: OldFavoriteWorkspacePageTarget, command: OldFavoriteWorkspacePageCommand): Promise<OldFavoriteWorkspacePageResult> {
      if (!isTarget(target)) return { status: 'unknown', observedAccountMid: '', reason: 'invalid-page-target' }
      if (!isCommand(command)) return { status: 'unknown', observedAccountMid: '', reason: 'invalid-scan-command' }
      try {
        const result = await options.execute(target, scriptFor(command))
        return resultFor(command, result) ?? { status: 'unknown', observedAccountMid: '', reason: 'invalid-page-result' }
      } catch {
        return { status: 'unknown', observedAccountMid: '', reason: 'page-execution-failed' }
      }
    }
  }
}
