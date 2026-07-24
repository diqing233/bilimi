/** Persistent sources that migration schema v1 intentionally carries per UID. */
export const LOCAL_DATA_MIGRATION_ACCOUNT_SOURCES = [
  'repository',
  'settings',
  'archives',
  'transcription',
  'auditEvents',
  'workspaces',
  'remoteOperations'
] as const

/** Device settings that are safe to carry between installations. */
export const LOCAL_DATA_MIGRATION_SHARED_SETTINGS = [
  'theme',
  'language',
  'windowBounds',
  'closeBehavior',
  'favoritesFolderName'
] as const

/** Persistent or runtime sources which must never enter a portable archive. */
export const LOCAL_DATA_MIGRATION_EXCLUDED_SOURCES = [
  'cookies/login sessions',
  'DeepSeek API key',
  'machine encryption keys',
  'proxy/runtime state',
  'browser cache',
  'logs',
  'temporary audio segments',
  'process locks',
  'execution tokens',
  'ephemeral task IDs'
] as const
