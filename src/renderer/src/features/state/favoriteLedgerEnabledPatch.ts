import type { AssistantPreferences, FavoriteLedgerEnabledPatch } from '@shared/types'

export type FavoriteLedgerEnabledIndex = Map<string, { enabled: boolean }>

function ledgerKey(accountMid: string, ledgerId: string) {
  return `${accountMid}\0${ledgerId}`
}

export function createFavoriteLedgerEnabledIndex(
  ...preferenceSets: AssistantPreferences[]
): FavoriteLedgerEnabledIndex {
  const index: FavoriteLedgerEnabledIndex = new Map()
  for (const preferences of preferenceSets) {
    for (const [accountMid, account] of Object.entries(preferences.favoriteAccountPreferences ?? {})) {
      for (const ledger of account.favoriteLedgers) {
        const key = ledgerKey(accountMid, ledger.id)
        const existing = index.get(key)
        if (existing) {
          const descriptor = Object.getOwnPropertyDescriptor(existing, 'enabled')
          const targets = (descriptor?.get as (() => boolean) & { targets?: Array<{ enabled: boolean }> })?.targets
          targets?.push(ledger)
          continue
        }
        const targets = [ledger]
        const getEnabled = (() => targets[0].enabled) as (() => boolean) & { targets?: Array<{ enabled: boolean }> }
        getEnabled.targets = targets
        index.set(key, Object.defineProperty({}, 'enabled', {
          enumerable: true,
          get: getEnabled,
          set: (enabled: boolean) => { for (const target of targets) target.enabled = enabled }
        }) as { enabled: boolean })
      }
    }
  }
  return index
}

export function applyIndexedFavoriteLedgerEnabledPatch(
  index: FavoriteLedgerEnabledIndex,
  patch: FavoriteLedgerEnabledPatch
) {
  const ledger = index.get(ledgerKey(patch.accountMid, patch.ledgerId))
  if (ledger) ledger.enabled = patch.enabled
}
