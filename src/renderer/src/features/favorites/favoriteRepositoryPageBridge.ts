export type FavoriteRepositoryPageBridgeInput = {
  accountMid: string
  operationKey: string
  aid: number
  folderIds: string[]
}

export type FavoriteRepositoryFolderInventoryInput = { accountMid: string; operationKey: string }
export type FavoriteRepositoryFolderCreateInput = { accountMid: string; operationKey: string; title: string }
export type FavoriteRepositoryFolderDeleteInput = { accountMid: string; operationKey: string; folderId: string }

export type FavoriteRepositoryRemoteFolder = { id: string; title: string; memberCount: number }

export type FavoriteRepositoryPageBridgeResult = {
  status: 'ok' | 'rejected' | 'unknown'
  observedAccountMid: string
  reason?: string
  httpStatus?: number
  contentType?: string
  responseCategory?: 'html' | 'json' | 'text' | 'empty' | 'unknown'
  bilibiliCode?: number
}

export type FavoriteRepositoryPageBridgeReadResult = FavoriteRepositoryPageBridgeResult & {
  members?: Record<string, number[]>
  folders?: FavoriteRepositoryRemoteFolder[]
  folder?: FavoriteRepositoryRemoteFolder
}

type ExecuteJavaScript = (script: string, userGesture?: boolean) => Promise<unknown>

type PageBridgeAction = 'append' | 'remove' | 'unfavorite' | 'read-members' | 'read-folder-inventory' | 'create-folder' | 'delete-folder'

export const FAVORITE_REPOSITORY_REQUEST_TIMEOUT_MS = 15_000

const validStatuses = new Set<FavoriteRepositoryPageBridgeResult['status']>(['ok', 'rejected', 'unknown'])

function isPositiveAid(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isMembers(value: unknown): value is Record<string, number[]> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.entries(value).every(([folderId, aids]) =>
      folderId.trim().length > 0 && Array.isArray(aids) && aids.every(isPositiveAid))
}

function isFolder(value: unknown): value is FavoriteRepositoryRemoteFolder {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const folder = value as Record<string, unknown>
  return typeof folder.id === 'string' && !!folder.id.trim() && typeof folder.title === 'string' && !!folder.title.trim() &&
    Number.isSafeInteger(folder.memberCount) && Number(folder.memberCount) >= 0
}

function isPageResult(value: unknown, action: PageBridgeAction): value is FavoriteRepositoryPageBridgeReadResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const result = value as Record<string, unknown>
  const diagnosticKeys = ['httpStatus', 'contentType', 'responseCategory', 'bilibiliCode']
  const allowedKeys = action === 'read-members'
    ? new Set(['status', 'observedAccountMid', 'reason', 'members', ...diagnosticKeys])
    : action === 'read-folder-inventory'
      ? new Set(['status', 'observedAccountMid', 'reason', 'folders', ...diagnosticKeys])
      : action === 'create-folder'
        ? new Set(['status', 'observedAccountMid', 'reason', 'folder', ...diagnosticKeys])
        : new Set(['status', 'observedAccountMid', 'reason', ...diagnosticKeys])
  if (Object.keys(result).some((key) => !allowedKeys.has(key))) return false
  if (!validStatuses.has(result.status as FavoriteRepositoryPageBridgeResult['status'])) return false
  if (typeof result.observedAccountMid !== 'string') return false
  if (result.reason !== undefined && typeof result.reason !== 'string') return false
  if (result.httpStatus !== undefined && (!Number.isSafeInteger(result.httpStatus) || Number(result.httpStatus) < 0 || Number(result.httpStatus) > 999)) return false
  if (result.contentType !== undefined && (typeof result.contentType !== 'string' || result.contentType.length > 100)) return false
  if (result.responseCategory !== undefined && !['html', 'json', 'text', 'empty', 'unknown'].includes(String(result.responseCategory))) return false
  if (result.bilibiliCode !== undefined && !Number.isSafeInteger(result.bilibiliCode)) return false
  if (action === 'read-members' && result.status === 'ok' && !isMembers(result.members)) return false
  if (action === 'read-folder-inventory' && result.status === 'ok' && (!Array.isArray(result.folders) || !result.folders.every(isFolder))) return false
  if (action === 'create-folder' && result.status === 'ok' && !isFolder(result.folder)) return false
  return true
}

function pageScript(action: PageBridgeAction, input: FavoriteRepositoryPageBridgeInput | FavoriteRepositoryUnfavoriteInput | FavoriteRepositoryFolderInventoryInput | FavoriteRepositoryFolderCreateInput | FavoriteRepositoryFolderDeleteInput): string {
  const payload = JSON.stringify(input)
  const mutationField = action === 'append' ? 'add_media_ids' : 'del_media_ids'
  const mutation = action === 'append' || action === 'remove'

  if (action === 'read-folder-inventory') {
    return `
      (async () => {
        const input = ${payload};
        const readCookie = (name) => String(document.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(name + '='))?.slice(name.length + 1) || '';
        const normalizeMid = (value) => { const raw = String(value || '').trim(); return /^\\d+$/.test(raw) && raw !== '0' ? raw.replace(/^0+(?=\\d)/, '') : ''; };
        const observedAccountMid = normalizeMid(readCookie('DedeUserID'));
        if (!observedAccountMid || observedAccountMid !== normalizeMid(input.accountMid) || !String(input.operationKey || '').trim()) return { status: 'unknown', observedAccountMid, reason: 'account-mismatch' };
        let response; try { response = await fetch('https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=' + encodeURIComponent(observedAccountMid) + '&type=2', { credentials: 'include' }); } catch { return { status: 'unknown', observedAccountMid, reason: 'network-failure' }; }
        let json; try { json = await response.json(); } catch { return { status: 'unknown', observedAccountMid, reason: 'invalid-response' }; }
        if (!response.ok || json?.code !== 0 || !Array.isArray(json?.data?.list)) return { status: 'unknown', observedAccountMid, reason: 'remote-ambiguous' };
        const folders = json.data.list.map((folder) => ({ id: String(folder?.id ?? folder?.fid ?? ''), title: String(folder?.title ?? '').trim(), memberCount: Number(folder?.media_count ?? folder?.mediaCount ?? 0) })).filter((folder) => folder.id && folder.title && Number.isSafeInteger(folder.memberCount) && folder.memberCount >= 0);
        return normalizeMid(readCookie('DedeUserID')) === observedAccountMid ? { status: 'ok', observedAccountMid, folders } : { status: 'unknown', observedAccountMid: normalizeMid(readCookie('DedeUserID')), reason: 'account-mismatch' };
      })()
    `
  }

  if (action === 'create-folder') {
    return `
      (async () => {
        const input = ${payload};
        const readCookie = (name) => String(document.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(name + '='))?.slice(name.length + 1) || '';
        const normalizeMid = (value) => { const raw = String(value || '').trim(); return /^\\d+$/.test(raw) && raw !== '0' ? raw.replace(/^0+(?=\\d)/, '') : ''; };
        const observedAccountMid = normalizeMid(readCookie('DedeUserID'));
        const title = String(input.title || '').trim();
        if (!observedAccountMid || observedAccountMid !== normalizeMid(input.accountMid) || !String(input.operationKey || '').trim()) return { status: 'unknown', observedAccountMid, reason: 'account-mismatch' };
        if (!title || Array.from(title).length > 20) return { status: 'rejected', observedAccountMid, reason: 'invalid-folder-title' };
        const csrf = readCookie('bili_jct'); if (!csrf) return { status: 'rejected', observedAccountMid, reason: 'csrf-missing' };
        const body = new URLSearchParams(); body.set('csrf', csrf); body.set('privacy', '0'); body.set('title', title);
        let response; try { response = await fetch('https://api.bilibili.com/x/v3/fav/folder/add', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body }); } catch { return { status: 'unknown', observedAccountMid, reason: 'network-failure' }; }
        let json; try { json = await response.json(); } catch { return { status: 'unknown', observedAccountMid, reason: 'invalid-response' }; }
        const id = String(json?.data?.id ?? json?.data?.fid ?? '');
        if (response.ok && json?.code === 0 && id && normalizeMid(readCookie('DedeUserID')) === observedAccountMid) return { status: 'ok', observedAccountMid, folder: { id, title, memberCount: 0 } };
        return { status: 'unknown', observedAccountMid, reason: 'remote-ambiguous' };
      })()
    `
  }

  if (action === 'delete-folder') {
    return `
      (async () => {
        const input = ${payload};
        const readCookie = (name) => String(document.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(name + '='))?.slice(name.length + 1) || '';
        const normalizeMid = (value) => { const raw = String(value || '').trim(); return /^\\d+$/.test(raw) && raw !== '0' ? raw.replace(/^0+(?=\\d)/, '') : ''; };
        const observedAccountMid = normalizeMid(readCookie('DedeUserID'));
        if (!observedAccountMid || observedAccountMid !== normalizeMid(input.accountMid) || !String(input.operationKey || '').trim() || !String(input.folderId || '').trim()) return { status: 'unknown', observedAccountMid, reason: 'account-mismatch' };
        const csrf = readCookie('bili_jct'); if (!csrf) return { status: 'rejected', observedAccountMid, reason: 'csrf-missing' };
        const body = new URLSearchParams(); body.set('csrf', csrf); body.set('media_ids', String(input.folderId).trim());
        let response; try { response = await fetch('https://api.bilibili.com/x/v3/fav/folder/del', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body }); } catch { return { status: 'unknown', observedAccountMid, reason: 'network-failure' }; }
        const httpStatus = Number(response?.status || 0);
        const contentType = String(response?.headers?.get?.('content-type') || '').split(';', 1)[0].trim().slice(0, 100);
        const responseCategory = !contentType ? 'unknown' : contentType.includes('json') ? 'json' : contentType.includes('html') ? 'html' : contentType.startsWith('text/') ? 'text' : 'unknown';
        let json; try { json = await response.json(); } catch { return { status: 'unknown', observedAccountMid, reason: 'invalid-response', httpStatus, ...(contentType ? { contentType } : {}), responseCategory }; }
        if (response.ok && json?.code === 0 && normalizeMid(readCookie('DedeUserID')) === observedAccountMid) return { status: 'ok', observedAccountMid };
        return { status: 'unknown', observedAccountMid, reason: 'remote-ambiguous', httpStatus, ...(contentType ? { contentType } : {}), responseCategory, ...(Number.isSafeInteger(json?.code) ? { bilibiliCode: json.code } : {}) };
      })()
    `
  }

  if (action === 'unfavorite') {
    return `
      (async () => {
        const input = ${payload};
        const readCookie = (name) => String(document.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(name + '='))?.slice(name.length + 1) || '';
        const normalizeMid = (value) => { const raw = String(value || '').trim(); return /^\\d+$/.test(raw) && raw !== '0' ? raw.replace(/^0+(?=\\d)/, '') : ''; };
        const observedAccountMid = normalizeMid(readCookie('DedeUserID'));
        const reject = (reason) => ({ status: 'rejected', observedAccountMid, reason });
        if (!observedAccountMid || observedAccountMid !== normalizeMid(input.accountMid) || !String(input.operationKey || '').trim() || !Number.isSafeInteger(input.aid) || input.aid <= 0) return reject('invalid-operation');
        const csrf = readCookie('bili_jct'); if (!csrf) return reject('csrf-missing');
        const body = new URLSearchParams(); body.set('aid', String(input.aid)); body.set('type', '2'); body.set('csrf', csrf);
        let response; try {
          response = await fetch('https://api.bilibili.com/x/web-interface/archive/fav', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body });
        } catch { return { status: 'unknown', observedAccountMid, reason: 'network-failure' }; }
        let json; try { json = await response.json(); } catch { return { status: 'unknown', observedAccountMid, reason: 'invalid-response' }; }
        if (response.ok && json?.code === 0 && normalizeMid(readCookie('DedeUserID')) === observedAccountMid) return { status: 'ok', observedAccountMid };
        if (response.ok && json?.code !== 0) return reject('known-unapplied-remote-rejection');
        return { status: 'unknown', observedAccountMid, reason: 'remote-ambiguous' };
      })()
    `
  }

  if (!mutation) {
    return `
      (async () => {
        const input = ${payload};
        const readCookie = (name) => String(document.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(name + '='))?.slice(name.length + 1) || '';
        const normalizeMid = (value) => {
          const raw = String(value || '').trim();
          if (!/^\\d+$/.test(raw)) return '';
          const normalized = raw.replace(/^0+(?=\\d)/, '');
          return normalized === '0' ? '' : normalized;
        };
        const observedAccountMid = normalizeMid(readCookie('DedeUserID'));
        const reject = (reason) => ({ status: 'rejected', observedAccountMid, reason });
        const fetchWithTimeout = async (url, options) => {
          const controller = new AbortController();
          let timedOut = false;
          const timer = setTimeout(() => { timedOut = true; controller.abort(); }, ${FAVORITE_REPOSITORY_REQUEST_TIMEOUT_MS});
          try { return await fetch(url, { ...options, signal: controller.signal }); }
          catch (error) { if (timedOut) throw new Error('remote-timeout'); throw error; }
          finally { clearTimeout(timer); }
        };
        if (!observedAccountMid || observedAccountMid !== normalizeMid(input.accountMid)) return { status: 'unknown', observedAccountMid, reason: 'account-mismatch' };
        if (!String(input.operationKey || '').trim() || !Number.isSafeInteger(input.aid) || input.aid <= 0 || !Array.isArray(input.folderIds) || input.folderIds.length === 0 || input.folderIds.some((id) => !String(id || '').trim())) return reject('invalid-operation');
        const members = {};
        const folderIds = [...new Set(input.folderIds.map((id) => String(id).trim()))];
        const readMembershipFromFolderList = async () => {
          let fallbackResponse;
          try {
            fallbackResponse = await fetchWithTimeout('https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=' + encodeURIComponent(observedAccountMid) + '&type=2&rid=' + encodeURIComponent(String(input.aid)), { credentials: 'include' });
          } catch (error) {
            return { status: 'unknown', observedAccountMid, reason: error?.message === 'remote-timeout' ? 'remote-timeout' : 'network-failure' };
          }
          let fallbackJson;
          try { fallbackJson = await fallbackResponse.json(); }
          catch { return { status: 'unknown', observedAccountMid, reason: 'invalid-response' }; }
          if (!fallbackResponse.ok || fallbackJson?.code !== 0 || !Array.isArray(fallbackJson?.data?.list)) return { status: 'unknown', observedAccountMid, reason: 'remote-ambiguous' };
          const foldersById = new Map(fallbackJson.data.list.map((folder) => [String(folder?.id ?? folder?.fid ?? '').trim(), folder]));
          if (folderIds.some((folderId) => !foldersById.has(folderId))) return { status: 'unknown', observedAccountMid, reason: 'reconciliation-membership-incomplete' };
          for (const folderId of folderIds) members[folderId] = Number(foldersById.get(folderId)?.fav_state ?? 0) === 1 ? [input.aid] : [];
          return normalizeMid(readCookie('DedeUserID')) === observedAccountMid
            ? { status: 'ok', observedAccountMid, members }
            : { status: 'unknown', observedAccountMid: normalizeMid(readCookie('DedeUserID')), reason: 'account-mismatch' };
        };
        for (const folderId of folderIds) {
          let response;
          try {
            response = await fetchWithTimeout('https://api.bilibili.com/x/v3/fav/resource/ids?media_id=' + encodeURIComponent(folderId), { credentials: 'include' });
          } catch (error) {
            return { status: 'unknown', observedAccountMid, reason: error?.message === 'remote-timeout' ? 'remote-timeout' : 'network-failure' };
          }
          let json;
          try {
            json = await response.json();
          } catch {
            return readMembershipFromFolderList();
          }
          if (!response.ok || json?.code !== 0) {
            return { status: 'unknown', observedAccountMid, reason: 'remote-ambiguous' };
          }
          if (!Array.isArray(json?.data)) return { status: 'unknown', observedAccountMid, reason: 'invalid-membership-response' };
          const aids = [];
          for (const entry of json.data) {
            const aid = Number(entry?.id ?? entry?.aid);
            if (Number(entry?.type ?? 2) === 2 && Number.isSafeInteger(aid) && aid > 0) aids.push(aid);
          }
          members[folderId] = [...new Set(aids)];
        }
        if (normalizeMid(readCookie('DedeUserID')) !== observedAccountMid) {
          return { status: 'unknown', observedAccountMid: normalizeMid(readCookie('DedeUserID')), reason: 'account-mismatch' };
        }
        return { status: 'ok', observedAccountMid, members };
      })()
    `
  }

  return `
    (async () => {
      const input = ${payload};
      const readCookie = (name) => String(document.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(name + '='))?.slice(name.length + 1) || '';
      const normalizeMid = (value) => {
        const raw = String(value || '').trim();
        if (!/^\\d+$/.test(raw)) return '';
        const normalized = raw.replace(/^0+(?=\\d)/, '');
        return normalized === '0' ? '' : normalized;
      };
      const observedAccountMid = normalizeMid(readCookie('DedeUserID'));
      const reject = (reason) => ({ status: 'rejected', observedAccountMid, reason });
      const fetchWithTimeout = async (url, options) => {
        const controller = new AbortController();
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; controller.abort(); }, ${FAVORITE_REPOSITORY_REQUEST_TIMEOUT_MS});
        try { return await fetch(url, { ...options, signal: controller.signal }); }
        catch (error) { if (timedOut) throw new Error('remote-timeout'); throw error; }
        finally { clearTimeout(timer); }
      };
      if (!observedAccountMid || observedAccountMid !== normalizeMid(input.accountMid)) return { status: 'unknown', observedAccountMid, reason: 'account-mismatch' };
      if (!String(input.operationKey || '').trim() || !Number.isSafeInteger(input.aid) || input.aid <= 0 || !Array.isArray(input.folderIds) || input.folderIds.length === 0 || input.folderIds.some((id) => !String(id || '').trim())) return reject('invalid-operation');
      const csrf = readCookie('bili_jct');
      if (!csrf) return reject('csrf-missing');
      const body = new URLSearchParams();
      body.set('${mutationField}', [...new Set(input.folderIds.map((id) => String(id).trim()))].join(','));
      body.set('csrf', csrf);
      body.set('rid', String(input.aid));
      body.set('type', '2');
      body.set('platform', 'web');
      let response;
      try {
        response = await fetchWithTimeout('https://api.bilibili.com/x/v3/fav/resource/deal', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body
        });
      } catch (error) {
        return { status: 'unknown', observedAccountMid, reason: error?.message === 'remote-timeout' ? 'remote-timeout' : 'network-failure' };
      }
      let json;
      try {
        json = await response.json();
      } catch {
        const contentType = String(response.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
        const responseCategory = contentType.includes('html') ? 'html' : contentType.includes('json') ? 'json' : contentType.startsWith('text/') ? 'text' : contentType ? 'unknown' : 'empty';
        return { status: 'unknown', observedAccountMid, reason: 'invalid-response', httpStatus: Number(response.status) || 0, contentType, responseCategory };
      }
      if (response.ok && json?.code === 0) {
        const completedAccountMid = normalizeMid(readCookie('DedeUserID'));
        if (completedAccountMid !== observedAccountMid) return { status: 'unknown', observedAccountMid: completedAccountMid, reason: 'account-mismatch' };
        return { status: 'ok', observedAccountMid };
      }
      return { status: 'unknown', observedAccountMid, reason: 'remote-ambiguous', httpStatus: Number(response.status) || 0, contentType: String(response.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase(), responseCategory: 'json', ...(Number.isSafeInteger(json?.code) ? { bilibiliCode: json.code } : {}) };
    })()
  `
}

export function createFavoriteRepositoryPageBridge(options: { executeJavaScript: ExecuteJavaScript; timeoutMs?: number }) {
  const run = async (action: PageBridgeAction, input: FavoriteRepositoryPageBridgeInput | FavoriteRepositoryUnfavoriteInput | FavoriteRepositoryFolderInventoryInput | FavoriteRepositoryFolderCreateInput | FavoriteRepositoryFolderDeleteInput): Promise<FavoriteRepositoryPageBridgeReadResult> => {
    try {
      const execution = options.executeJavaScript(pageScript(action, input), true)
      const result = await new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('page-execution-timeout')), options.timeoutMs ?? FAVORITE_REPOSITORY_REQUEST_TIMEOUT_MS)
        execution.then((value) => { clearTimeout(timer); resolve(value) }, (error) => { clearTimeout(timer); reject(error) })
      })
      if (!isPageResult(result, action)) {
        return { status: 'unknown', observedAccountMid: '', reason: 'invalid-page-result' }
      }
      return result
    } catch (error) {
      return {
        status: 'unknown', observedAccountMid: '',
        reason: error instanceof Error && error.message === 'page-execution-timeout' ? 'page-execution-timeout' : 'page-execution-failed'
      }
    }
  }

  return {
    append: (input: FavoriteRepositoryPageBridgeInput) => run('append', input),
    remove: (input: FavoriteRepositoryPageBridgeInput) => run('remove', input),
    unfavorite: (input: FavoriteRepositoryUnfavoriteInput) => run('unfavorite', input),
    readMembers: (input: FavoriteRepositoryPageBridgeInput) => run('read-members', input),
    readFolderInventory: (input: FavoriteRepositoryFolderInventoryInput) => run('read-folder-inventory', input),
    createFolder: (input: FavoriteRepositoryFolderCreateInput) => run('create-folder', input)
    ,deleteFolder: (input: FavoriteRepositoryFolderDeleteInput) => run('delete-folder', input)
  }
}

/** Global Bilibili unfavorite deliberately accepts no physical folder ids. */
export type FavoriteRepositoryUnfavoriteInput = { accountMid: string; operationKey: string; aid: number }
