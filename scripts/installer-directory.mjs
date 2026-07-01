export const INSTALL_SUBFOLDER_NAME = 'bilimi'

function trimTrailingSeparators(path) {
  return path.replace(/[\\/]+$/u, '')
}

export function normalizeInstallerDirectory(path, subfolder = INSTALL_SUBFOLDER_NAME) {
  const trimmedPath = trimTrailingSeparators(String(path ?? '').trim())

  if (!trimmedPath) {
    return subfolder
  }

  const lastSegment = trimmedPath.split(/[\\/]/u).filter(Boolean).at(-1)

  if (lastSegment?.toLowerCase() === subfolder.toLowerCase()) {
    return trimmedPath
  }

  const separator = trimmedPath.includes('/') && !trimmedPath.includes('\\') ? '/' : '\\'

  return `${trimmedPath}${separator}${subfolder}`
}
