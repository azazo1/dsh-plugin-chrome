/**
 * Plugin configuration (schemastery schema — validated by the cordis Loader).
 *
 * Every deployment-varying choice is a config field, so a profile patch can
 * tune it without editing source.
 */
import z from 'schemastery'

/** User-facing config shape. */
export interface Config {
  /**
   * Absolute path to the Chrome/Edge executable. Empty means auto-detect:
   * Chrome first, then Edge, then Chromium (per platform conventions).
   */
  executablePath?: string
  /**
   * Run the window headless. Default false — the whole point of the plugin
   * is a VISIBLE browser window the user can watch and take over.
   */
  headless?: boolean
  /**
   * Data root. Each session gets <dataRoot>/sessions/<sessionId>/ holding
   * its isolated browser profile and screenshots. Defaults to
   * <DSH_HOME>/data/dsh-plugin-chrome.
   */
  dataRoot?: string
  /**
   * Idle timeout in milliseconds. A Chrome window with no tool or UI
   * activity for this long closes automatically. 0 disables the timer.
   */
  idleTimeoutMs?: number
  /** Initial window width/height in pixels; 0 = Chrome default. */
  windowWidth?: number
  windowHeight?: number
  /** Extra Chrome command-line flags (joined with a space). */
  extraArgs?: string
  /**
   * Screencast frame skip: one frame is kept every N source frames.
   * Higher = less bandwidth, lower = smoother live preview.
   */
  screencastFrameSkip?: number
  /** Screencast JPEG quality, 1-100. */
  screencastQuality?: number
  /** Maximum characters of one snapshot result sent to the model. */
  maxSnapshotText?: number
  /** Maximum tabs a session window may open. */
  maxTabs?: number
  /** Whether the host also records page screenshots after every action. */
  autoScreenshot?: boolean
}

/** Loader-validated config schema; defaults live here. */
export const Config: z<Config> = z.object({
  executablePath: z.string().default(''),
  headless: z.boolean().default(false),
  dataRoot: z.string().default(''),
  idleTimeoutMs: z.number().min(0).default(600000),
  windowWidth: z.number().min(0).default(1280),
  windowHeight: z.number().min(0).default(900),
  extraArgs: z.string().default(''),
  screencastFrameSkip: z.number().min(1).default(4),
  screencastQuality: z.number().min(1).max(100).default(70),
  maxSnapshotText: z.number().min(1000).default(60000),
  maxTabs: z.number().min(1).default(16),
  autoScreenshot: z.boolean().default(false),
})

/** Resolved shape after the Loader applies schema defaults. */
export type ResolvedConfig = {
  [K in keyof Config]-?: NonNullable<Config[K]>
}

/** Resolve a (possibly partial) raw config into a complete value. */
export function resolveConfig(raw: Partial<Config> = {}): ResolvedConfig {
  return {
    executablePath: raw.executablePath ?? '',
    headless: raw.headless ?? false,
    dataRoot: raw.dataRoot ?? '',
    idleTimeoutMs: raw.idleTimeoutMs ?? 600000,
    windowWidth: raw.windowWidth ?? 1280,
    windowHeight: raw.windowHeight ?? 900,
    extraArgs: raw.extraArgs ?? '',
    screencastFrameSkip: raw.screencastFrameSkip ?? 4,
    screencastQuality: raw.screencastQuality ?? 70,
    maxSnapshotText: raw.maxSnapshotText ?? 60000,
    maxTabs: raw.maxTabs ?? 16,
    autoScreenshot: raw.autoScreenshot ?? false,
  }
}
