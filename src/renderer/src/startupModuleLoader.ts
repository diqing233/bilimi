export type StartupModuleLoader<TModule> = () => Promise<TModule>

const STARTUP_MODULE_RETRY_DELAY_MS = 150

function isDynamicModuleFetchFailure(error: unknown) {
  return error instanceof TypeError && /failed to fetch dynamically imported module/i.test(error.message)
}

export async function loadStartupModuleWithRetry<TModule>(
  loadModule: StartupModuleLoader<TModule>,
  retryModule: StartupModuleLoader<TModule> = loadModule
) {
  try {
    return await loadModule()
  } catch (error) {
    if (!isDynamicModuleFetchFailure(error)) throw error
    await new Promise<void>((resolve) => window.setTimeout(resolve, STARTUP_MODULE_RETRY_DELAY_MS))
    return retryModule()
  }
}
