type FavoriteLibraryFooterProps = {
  hasPreviousPage?: boolean
  hasNextPage: boolean
  pageNumber?: number
  pageSize?: 25 | 50 | 100
  onPageSizeChange?: (pageSize: 25 | 50 | 100) => void
  visibleCount?: number
  totalCount?: number
  onPreviousPage?: () => void
  onNextPage: () => void
  onFirstPage?: () => void
  onLastPage?: () => void
}

const chinese = (...codePoints: number[]) => String.fromCodePoint(...codePoints)
const itemUnit = chinese(0x4e2a)
const pagePrefix = chinese(0x7b2c)
const pageSuffix = chinese(0x9875)
const perPage = chinese(0x6bcf, 0x9875)
const firstPage = chinese(0x9996, 0x9875)
const previousPage = chinese(0x4e0a, 0x4e00, 0x9875)
const nextPage = chinese(0x4e0b, 0x4e00, 0x9875)
const lastPage = chinese(0x672b, 0x9875)

/** Renders pagination solely below the center results column. */
export function FavoriteLibraryFooter({
  hasPreviousPage = false, hasNextPage, pageNumber = 1, pageSize = 50, visibleCount = 0, totalCount,
  onPreviousPage, onNextPage, onFirstPage, onLastPage, onPageSizeChange
}: FavoriteLibraryFooterProps) {
  const firstItem = visibleCount ? (pageNumber - 1) * pageSize + 1 : 0
  const lastItem = visibleCount ? firstItem + visibleCount - 1 : 0
  const range = totalCount === undefined ? `${firstItem}-${lastItem}` : `${firstItem}-${lastItem} / ${totalCount}`

  return <footer className="favorite-library__footer" data-testid="favorite-library-footer" data-footer-split="middle-only">
    <div className="favorite-library__footer-region favorite-library__footer-pagination" data-testid="favorite-library-footer-middle">
      <span>{totalCount === undefined ? range : `总计 ${totalCount} ${itemUnit}`}</span>
      <label>{perPage}<select aria-label="每页数量" value={pageSize} onChange={(event) => onPageSizeChange?.(Number(event.currentTarget.value) as 25 | 50 | 100)}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label>
      <span className="favorite-library__page-controls"><button type="button" disabled={!hasPreviousPage} onClick={onFirstPage}>{firstPage}</button>
      <button type="button" disabled={!hasPreviousPage} onClick={onPreviousPage}>{previousPage}</button>
      <span>{`${pagePrefix} ${pageNumber} ${pageSuffix}`}</span>{hasNextPage ? <span aria-hidden="true">...</span> : null}
      <button type="button" disabled={!hasNextPage} onClick={onNextPage}>{nextPage}</button>
      <button type="button" disabled={!hasNextPage} onClick={onLastPage}>{lastPage}</button></span>
    </div>
  </footer>
}
