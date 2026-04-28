import type { FavoriteLedger } from '@shared/types'

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
    const ensureApiOk = async (response) => {
      const json = await response.json();
      if (!response.ok || !json || json.code !== 0) {
        throw new Error(json?.message || response.statusText || 'Bilibili API request failed');
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
      const json = await ensureApiOk(response);
      const folders = Array.isArray(json.data?.list) ? json.data.list : [];
      const nextLedgers = payload.ledgers.map((ledger) => {
        const folder = folders.find((candidate) => candidate?.title === ledger.displayName);
        const folderId = findFolderId(folder);
        return folderId ? { ...ledger, bilibiliFolderId: String(folderId) } : ledger;
      });

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
      const listJson = await ensureApiOk(listResponse);
      const folders = Array.isArray(listJson.data?.list) ? listJson.data.list : [];
      const nextLedgers = payload.ledgers.map((ledger) => {
        const folder = folders.find((candidate) => candidate?.title === ledger.displayName);
        const folderId = findFolderId(folder);
        return folderId ? { ...ledger, bilibiliFolderId: String(folderId) } : ledger;
      });

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
        const json = await ensureApiOk(response);
        const folderId = json.data?.id ?? json.data?.fid;
        if (folderId) {
          nextLedgers[index] = { ...ledger, bilibiliFolderId: String(folderId) };
        }
        steps.push('api:ledger:create:' + ledger.id);
      }

      return {
        ok: true,
        ledgers: nextLedgers,
        steps,
        missingTargets: nextLedgers.filter((ledger) => ledger.enabled && !ledger.bilibiliFolderId).map((ledger) => ledger.id),
        message: '册目已备齐。'
      };
    })();
  `
}

export function buildExecuteFavoriteLedgerPlanScript(items: FavoriteLedgerPreviewItem[]): string {
  const payload = scriptPayload({ items })

  return `
    (async () => {
      const payload = ${payload};
      ${sharedScriptHelpers()}
      const { csrf } = readCredentials();
      if (!csrf) {
        return { ok: false, steps: [], missingTargets: [], message: '未能读取登录凭据，无法归册。' };
      }

      const steps = [];
      const missingTargets = [];
      const executableItems = payload.items.filter((item) => {
        if (item.selected === false || item.alreadyInTarget === true) {
          return false;
        }
        if (!item.targetFolderId) {
          missingTargets.push(item.targetLedgerId);
          return false;
        }
        return true;
      });

      for (const item of executableItems) {
        const body = new URLSearchParams();
        body.set('add_media_ids', String(item.targetFolderId));
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
        await ensureApiOk(response);
        steps.push('api:ledger:append:' + item.aid);
      }

      return {
        ok: missingTargets.length === 0,
        steps,
        missingTargets,
        message: missingTargets.length === 0 ? '旧藏已归册。' : '部分条目缺少目标册目。'
      };
    })();
  `
}
