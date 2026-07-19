export type FavoriteRepositoryPageBridgeInput = {
  accountMid: string
  operationKey: string
  aid: number
  folderIds: string[]
}

export type FavoriteRepositoryPageBridgeResult = {
  status: 'ok' | 'rejected' | 'unknown'
  observedAccountMid: string
  reason?: string
}

export type FavoriteRepositoryPageBridgeReadResult = FavoriteRepositoryPageBridgeResult & {
  members?: Record<string, number[]>
}

type ExecuteJavaScript = (script: string, userGesture?: boolean) => Promise<unknown>

type PageBridgeAction = 'append' | 'remove' | 'read-members'

const validStatuses = new Set<FavoriteRepositoryPageBridgeResult['status']>(['ok', 'rejected', 'unknown'])

function isPositiveAid(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isMembers(value: unknown): value is Record<string, number[]> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.entries(value).every(([folderId, aids]) =>
      folderId.trim().length > 0 && Array.isArray(aids) && aids.every(isPositiveAid))
}

function isPageResult(value: unknown, action: PageBridgeAction): value is FavoriteRepositoryPageBridgeReadResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const result = value as Record<string, unknown>
  const allowedKeys = action === 'read-members'
    ? new Set(['status', 'observedAccountMid', 'reason', 'members'])
    : new Set(['status', 'observedAccountMid', 'reason'])
  if (Object.keys(result).some((key) => !allowedKeys.has(key))) return false
  if (!validStatuses.has(result.status as FavoriteRepositoryPageBridgeResult['status'])) return false
  if (typeof result.observedAccountMid !== 'string') return false
  if (result.reason !== undefined && typeof result.reason !== 'string') return false
  if (action === 'read-members' && result.status === 'ok' && !isMembers(result.members)) return false
  return true
}

function pageScript(action: PageBridgeAction, input: FavoriteRepositoryPageBridgeInput): string {
  const payload = JSON.stringify(input)
  const mutationField = action === 'append' ? 'add_media_ids' : 'del_media_ids'
  const mutation = action === 'append' || action === 'remove'

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
        if (!observedAccountMid || observedAccountMid !== normalizeMid(input.accountMid)) return { status: 'unknown', observedAccountMid, reason: 'account-mismatch' };
        if (!String(input.operationKey || '').trim() || !Number.isSafeInteger(input.aid) || input.aid <= 0 || !Array.isArray(input.folderIds) || input.folderIds.length === 0 || input.folderIds.some((id) => !String(id || '').trim())) return reject('invalid-operation');
        const members = {};
        for (const folderId of [...new Set(input.folderIds.map((id) => String(id).trim()))]) {
          let response;
          try {
            response = await fetch('https://api.bilibili.com/x/v3/fav/resource/ids?media_id=' + encodeURIComponent(folderId), { credentials: 'include' });
          } catch {
            return { status: 'unknown', observedAccountMid, reason: 'network-failure' };
          }
          let json;
          try {
            json = await response.json();
          } catch {
            return { status: response.status >= 500 ? 'unknown' : 'rejected', observedAccountMid, reason: 'invalid-response' };
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
        response = await fetch('https://api.bilibili.com/x/v3/fav/resource/deal', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body
        });
      } catch {
        return { status: 'unknown', observedAccountMid, reason: 'network-failure' };
      }
      let json;
      try {
        json = await response.json();
      } catch {
        return { status: response.status >= 500 ? 'unknown' : 'rejected', observedAccountMid, reason: 'invalid-response' };
      }
      if (response.ok && json?.code === 0) {
        const completedAccountMid = normalizeMid(readCookie('DedeUserID'));
        if (completedAccountMid !== observedAccountMid) return { status: 'unknown', observedAccountMid: completedAccountMid, reason: 'account-mismatch' };
        return { status: 'ok', observedAccountMid };
      }
      return { status: 'unknown', observedAccountMid, reason: 'remote-ambiguous' };
    })()
  `
}

export function createFavoriteRepositoryPageBridge(options: { executeJavaScript: ExecuteJavaScript }) {
  const run = async (action: PageBridgeAction, input: FavoriteRepositoryPageBridgeInput): Promise<FavoriteRepositoryPageBridgeReadResult> => {
    try {
      const result = await options.executeJavaScript(pageScript(action, input), true)
      if (!isPageResult(result, action)) {
        return { status: 'unknown', observedAccountMid: '', reason: 'invalid-page-result' }
      }
      return result
    } catch {
      return { status: 'unknown', observedAccountMid: '', reason: 'page-execution-failed' }
    }
  }

  return {
    append: (input: FavoriteRepositoryPageBridgeInput) => run('append', input),
    remove: (input: FavoriteRepositoryPageBridgeInput) => run('remove', input),
    readMembers: (input: FavoriteRepositoryPageBridgeInput) => run('read-members', input)
  }
}
