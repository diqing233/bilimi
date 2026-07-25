type FavoriteLibraryFooterProps = {
  hasPreviousPage?: boolean
  hasNextPage: boolean
  pageNumber?: number
  pageSize?: 25 | 50 | 100
  onPageSizeChange?: (pageSize: 25 | 50 | 100) => void
  visibleCount?: number
  totalCount?: number
  scopeLabel?: string
  detailLabel?: string
  onPreviousPage?: () => void
  onNextPage: () => void
}

const chinese = (...codePoints: number[]) => String.fromCodePoint(...codePoints)
const currentScope = chinese(0x5f53, 0x524d, 0x8303, 0x56f4)
const noSelectedVideo = chinese(0x6682, 0x672a, 0x9009, 0x62e9, 0x89c6, 0x9891)
const itemUnit = chinese(0x9879)
const pagePrefix = chinese(0x7b2c)
const pageSuffix = chinese(0x9875)
const perPage = chinese(0x6bcf, 0x9875)
const previousPage = chinese(0x4e0a, 0x4e00, 0x9875)
const nextPage = chinese(0x4e0b, 0x4e00, 0x9875)

/** Aligns pagination with the three persistent library columns. */
export function FavoriteLibraryFooter({
  hasPreviousPage = false, hasNextPage, pageNumber = 1, pageSize = 50, visibleCount = 0, totalCount,
  scopeLabel = currentScope, detailLabel = noSelectedVideo, onPreviousPage, onNextPage, onPageSizeChange
}: FavoriteLibraryFooterProps) {
  const firstItem = visibleCount ? (pageNumber - 1) * pageSize + 1 : 0
  const lastItem = visibleCount ? firstItem + visibleCount - 1 : 0
  const range = totalCount === undefined ? `${firstItem}-${lastItem}` : `${firstItem}-${lastItem} / ${totalCount}`

  return <footer className="favorite-library__footer" data-testid="favorite-library-footer" data-footer-split="true">
    <div className="favorite-library__footer-region" data-testid="favorite-library-footer-left">{range}</div>
    <div className="favorite-library__footer-region favorite-library__footer-pagination" data-testid="favorite-library-footer-middle">
      <span>{`${pagePrefix} ${pageNumber} ${pageSuffix}`}</span><label>{perPage}<select aria-label="每页数量" value={pageSize} onChange={(event) => onPageSizeChange?.(Number(event.currentTarget.value) as 25 | 50 | 100)}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label>
      <button type="button" disabled={!hasPreviousPage} onClick={onPreviousPage}>{previousPage}</button>
      <button type="button" disabled={!hasNextPage} onClick={onNextPage}>{nextPage}</button>
    </div>
    <div className="favorite-library__footer-region" data-testid="favorite-library-footer-right">{scopeLabel === currentScope ? detailLabel : scopeLabel}</div>
  </footer>
}
