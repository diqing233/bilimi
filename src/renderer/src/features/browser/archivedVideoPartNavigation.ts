export type ArchivedVideoPartSelectionResult = {
  status: 'ready' | 'navigating' | 'unavailable'
}

export function hasArchivedVideoPartIdentity(aid: number | undefined, cid: number | undefined): cid is number {
  return Number.isSafeInteger(cid) && (aid === undefined || Number.isSafeInteger(aid))
}

export function buildSelectArchivedVideoPartScript(aid: number | undefined, cid: number): string {
  const targetAid = Number.isSafeInteger(aid) ? aid : null

  return `
    (() => {
      const __bilimiSelectArchivedVideoPart = true;
      void __bilimiSelectArchivedVideoPart;
      const targetCid = ${cid};
      const targetAid = ${targetAid === null ? 'null' : targetAid};
      const state = window.__INITIAL_STATE__ || {};
      const videoData = state.videoData || state.videoInfo || {};
      const currentCid = Number(videoData.cid || state.cid || 0);
      const currentAid = Number(videoData.aid || state.aid || 0);

      if (targetAid !== null && currentAid && currentAid !== targetAid) {
        return { status: 'unavailable' };
      }

      if (currentCid === targetCid) {
        return { status: 'ready' };
      }

      const pages = Array.isArray(videoData.pages)
        ? videoData.pages
        : Array.isArray(state.pages)
          ? state.pages
          : [];
      const targetPageIndex = pages.findIndex((page) => Number(page?.cid) === targetCid);

      if (targetPageIndex < 0) {
        return { status: 'unavailable' };
      }

      const targetUrl = new URL(window.location.href);
      const targetPage = String(targetPageIndex + 1);
      if (targetUrl.searchParams.get('p') === targetPage) {
        return { status: 'unavailable' };
      }

      targetUrl.searchParams.set('p', targetPage);
      window.location.assign(targetUrl.href);
      return { status: 'navigating' };
    })()
  `
}
