/**
 * Shared settings contract between the host and client halves: the
 * settings namespace, its field names, defaults, and the wire shape.
 *
 * The settings namespace carries the user-facing knobs (Jev delegation and
 * window behavior); the profile's cordis.patch.yml plugin `config` stays the
 * deployment-level layer and acts as the fallback when a settings field was
 * never written. Pure types and JSON-safe constants only — imported by both
 * build faces.
 */

/** Settings namespace registered on the host's `settings` service. */
export const SETTINGS_NAMESPACE = 'dsh-plugin-chrome'

/** Settings field names (single source of truth for host and client). */
export const SETTINGS_FIELDS = {
  jevEnabled: 'jevEnabled',
  jevProvider: 'jevProvider',
  jevModel: 'jevModel',
  jevEnvFile: 'jevEnvFile',
  headless: 'headless',
  idleTimeoutMs: 'idleTimeoutMs',
  maxSnapshotText: 'maxSnapshotText',
  maxTabs: 'maxTabs',
  confirmFirstLaunch: 'confirmFirstLaunch',
} as const

/** One settings field's name. */
export type SettingsField = (typeof SETTINGS_FIELDS)[keyof typeof SETTINGS_FIELDS]

/** Jev providers the settings page offers. */
export const JEV_PROVIDERS = ['typesafe', 'openrouter'] as const

/** The persisted settings section (all fields optional — absent = inherit). */
export interface ChromeSettings {
  /** Enable the chrome_jev_run / chrome_jev_wait tools. */
  jevEnabled?: boolean
  /** Jev decision provider. */
  jevProvider?: 'typesafe' | 'openrouter'
  /** Jev model id; '' = provider default (jev-latest). */
  jevModel?: string
  /** Absolute path of the dotenv file holding the provider API key. */
  jevEnvFile?: string
  /** Run the window headless (takes effect on the next launch). */
  headless?: boolean
  /** Idle auto-close in ms; 0 disables. */
  idleTimeoutMs?: number
  /** Max characters of one snapshot result. */
  maxSnapshotText?: number
  /** Max tabs per session window. */
  maxTabs?: number
  /** Ask once before a session's first browser launch. */
  confirmFirstLaunch?: boolean
}

/** Decode an unknown wire section into {@link ChromeSettings}. */
export function decodeChromeSettings(section: unknown): ChromeSettings {
  if (typeof section !== 'object' || section === null) return {}
  const raw = section as Record<string, unknown>
  const decoded: ChromeSettings = {}
  if (typeof raw.jevEnabled === 'boolean') decoded.jevEnabled = raw.jevEnabled
  if (raw.jevProvider === 'typesafe' || raw.jevProvider === 'openrouter') decoded.jevProvider = raw.jevProvider
  if (typeof raw.jevModel === 'string') decoded.jevModel = raw.jevModel
  if (typeof raw.jevEnvFile === 'string') decoded.jevEnvFile = raw.jevEnvFile
  if (typeof raw.headless === 'boolean') decoded.headless = raw.headless
  if (typeof raw.idleTimeoutMs === 'number' && Number.isFinite(raw.idleTimeoutMs)) decoded.idleTimeoutMs = raw.idleTimeoutMs
  if (typeof raw.maxSnapshotText === 'number' && Number.isFinite(raw.maxSnapshotText)) decoded.maxSnapshotText = raw.maxSnapshotText
  if (typeof raw.maxTabs === 'number' && Number.isFinite(raw.maxTabs)) decoded.maxTabs = raw.maxTabs
  if (typeof raw.confirmFirstLaunch === 'boolean') decoded.confirmFirstLaunch = raw.confirmFirstLaunch
  return decoded
}
