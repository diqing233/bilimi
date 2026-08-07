export type CurrentAccountLocalDataClearDependencies = {
  stopTranscription(): Promise<void>
  stopScan(): Promise<void>
  stopDeepSeek(): Promise<void>
  runRemoteMaintenance(operation: () => Promise<void>): Promise<void>
  flushRepository(): Promise<void>
  clearLoginSession(): Promise<void>
  clearRuntimeAccount(accountMid: string): void | Promise<void>
  refreshGuestPages(): Promise<void>
  notifyLocalDataReset(): void
  notifyAccountChanged(): void
  resumeServices(): void
}

export async function clearCurrentAccountLocalData(
  accountMid: string,
  clearLocalData: () => Promise<void>,
  dependencies: CurrentAccountLocalDataClearDependencies
) {
  let signedOut = false
  let cleared = false
  try {
    await dependencies.stopTranscription()
    await dependencies.stopScan()
    await dependencies.stopDeepSeek()
    await dependencies.runRemoteMaintenance(async () => {
      await dependencies.flushRepository()
      await dependencies.clearLoginSession()
      signedOut = true
      await clearLocalData()
      cleared = true
      await dependencies.clearRuntimeAccount(accountMid)
    })
  } finally {
    if (signedOut) {
      await Promise.resolve(dependencies.refreshGuestPages()).catch(() => undefined)
      if (cleared) dependencies.notifyLocalDataReset()
      dependencies.notifyAccountChanged()
    }
    dependencies.resumeServices()
  }
}
