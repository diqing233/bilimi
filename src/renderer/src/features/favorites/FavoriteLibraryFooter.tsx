type FavoriteLibraryFooterProps = {
  hasNextPage: boolean
  onNextPage: () => void
}

/** Aligns pagination with the three persistent library columns. */
export function FavoriteLibraryFooter({ hasNextPage, onNextPage }: FavoriteLibraryFooterProps) {
  return <footer className="favorite-library__footer" data-testid="favorite-library-footer" data-footer-split="true">
    <div className="favorite-library__footer-region" data-testid="favorite-library-footer-left" />
    <div className="favorite-library__footer-region favorite-library__footer-pagination" data-testid="favorite-library-footer-middle">
      {hasNextPage ? <button type="button" onClick={onNextPage}>下一页</button> : null}
    </div>
    <div className="favorite-library__footer-region" data-testid="favorite-library-footer-right" />
  </footer>
}
