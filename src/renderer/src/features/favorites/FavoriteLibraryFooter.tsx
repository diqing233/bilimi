type FavoriteLibraryFooterProps = {
  hasPreviousPage?: boolean
  hasNextPage: boolean
  onPreviousPage?: () => void
  onNextPage: () => void
}

/** Aligns pagination with the three persistent library columns. */
export function FavoriteLibraryFooter({ hasPreviousPage = false, hasNextPage, onPreviousPage, onNextPage }: FavoriteLibraryFooterProps) {
  return <footer className="favorite-library__footer" data-testid="favorite-library-footer" data-footer-split="true">
    <div className="favorite-library__footer-region" data-testid="favorite-library-footer-left" />
    <div className="favorite-library__footer-region favorite-library__footer-pagination" data-testid="favorite-library-footer-middle">
      {hasPreviousPage ? <button type="button" onClick={onPreviousPage}>上一页</button> : null}
      {hasNextPage ? <button type="button" onClick={onNextPage}>下一页</button> : null}
    </div>
    <div className="favorite-library__footer-region" data-testid="favorite-library-footer-right" />
  </footer>
}
