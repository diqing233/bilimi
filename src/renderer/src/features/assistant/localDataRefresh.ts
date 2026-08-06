export type LocalDataInfo = {
  path: string
  accounts: Array<{ uid: string; nickname?: string; retained: boolean }>
}

export async function readLocalDataInfoWithRetry(
  read: () => Promise<LocalDataInfo>,
  options: { attempts?: number; wait?: (attempt: number) => Promise<void> } = {}
): Promise<LocalDataInfo> {
  const attempts = Math.max(1, options.attempts ?? 3)
  const wait = options.wait ?? ((attempt) => new Promise<void>((resolve) => {
    setTimeout(resolve, attempt * 120)
  }))
  let finalError: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await read()
    } catch (error) {
      finalError = error
      if (attempt < attempts) await wait(attempt)
    }
  }
  throw finalError
}
