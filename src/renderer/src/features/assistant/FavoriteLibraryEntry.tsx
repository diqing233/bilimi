type FavoriteLibraryEntryProps = {
  disabled?: boolean
}

export function FavoriteLibraryEntry({ disabled = false }: FavoriteLibraryEntryProps) {
  return <section className="favorite-ledger-panel__workspace" aria-label="收藏库">
    <div className="favorite-ledger-panel__editor-title">
      <div><h3>收藏库</h3><p>浏览已保存的收藏与整理结果。</p></div>
      <button type="button" aria-label="收藏库" disabled={disabled}
        onClick={() => void window.bilimiDesktop?.openFavoriteLibrary?.()}>收藏库</button>
    </div>
  </section>
}
