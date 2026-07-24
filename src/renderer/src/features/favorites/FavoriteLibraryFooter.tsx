type FavoriteLibraryFooterProps = {
  hasPreviousPage?: boolean
  hasNextPage: boolean
  pageNumber?: number
  pageSize?: 25 | 50 | 100
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
  scopeLabel = currentScope, detailLabel = noSelectedVideo, onPreviousPage, onNextPage
}: FavoriteLibraryFooterProps) {
  const firstItem = visibleCount ? (pageNumber - 1) * pageSize + 1 : 0
  const lastItem = visibleCount ? firstItem + visibleCount - 1 : 0
  const range = totalCount === undefined ? `${firstItem}-${lastItem}` : `${firstItem}-${lastItem} / ${totalCount}`

  return <footer className="favorite-library__footer" data-testid="favorite-library-footer" data-footer-split="true">
    <div className="favorite-library__footer-region" data-testid="favorite-library-footer-left">
      {totalCount === undefined ? scopeLabel : `${scopeLabel} · ${totalCount} ${itemUnit}`}
    </div>
    <div className="favorite-library__footer-region favorite-library__footer-pagination" data-testid="favorite-library-footer-middle">
      <span>{range}</span><span>{`${pagePrefix} ${pageNumber} ${pageSuffix}`}</span><span>{`${perPage} ${pageSize}`}</span>
      {hasPreviousPage ? <button type="button" onClick={onPreviousPage}>{previousPage}</button> : null}
      {hasNextPage ? <button type="button" onClick={onNextPage}>{nextPage}</button> : null}
    </div>
    <div className="favorite-library__footer-region" data-testid="favorite-library-footer-right">{detailLabel}</div>
  </footer>
}
