/**
 * Plugin configuration (schemastery schema — validated by the cordis Loader).
 *
 * Every deployment-varying choice is a config field, so a profile patch can
 * tune it without editing source.
 *
 * Two fields are `volatile`: the extension sources and the extra Chrome
 * flags. Volatile fields do not remount the plugin when they change, so the
 * Web GUI can edit them live — handing them to the plugin's own config card —
 * while a remount would dispose the manager and close every open window.
 * They are read at each launch, so an edit applies to the next window.
 */
import z from '@deepseek-ai/schemastery'
import type { Volatile } from '@deepseek-ai/cordis'

/**
 * A live (volatile) config value. Structurally the only member cordis's
 * `Volatile<T>` guarantees, so a Loader-provided ref and a fixed value are
 * interchangeable for consumers.
 */
export interface Live<T> {
  get(): T
}

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
   * its isolated browser profile and screenshots, plus a shared
   * <dataRoot>/extensions/ cache for sources unpacked from .crx files.
   * Defaults to <DSH_HOME>/data/dsh-plugin-chrome.
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
  /**
   * Extra Chrome command-line flags, one flag per entry (a whole flag, not a
   * value shell could split: `--lang=zh-CN`). Flags that would fight the
   * plugin's own invariants (profile isolation, headless choice, the CDP
   * endpoint, extension loading) are rejected at launch.
   */
  extraArgs?: Volatile<string[]>
  /**
   * Extensions to load into every session window: `.crx` files and/or
   * unpacked extension directories (absolute paths, or `~`-prefixed ones).
   * A `.crx` is unpacked into the shared <dataRoot>/extensions/ cache with
   * the CRX public key written into `manifest.key`, so the extension keeps
   * its original ID; a directory source is used in place.
   */
  extensions?: Volatile<string[]>
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
  /**
   * Ask the user to approve each session's FIRST browser launch through the
   * DSH approval channel; later calls in that session run without asking.
   * Deployments that compose no approval service (plain CLI / headless) have
   * nobody to ask, so the gate stands down there instead of failing the call.
   */
  confirmFirstLaunch?: boolean
}

/** Single source of truth for defaults (schema + resolver). */
const DEFAULTS = {
  executablePath: '',
  headless: false,
  dataRoot: '',
  idleTimeoutMs: 600000,
  windowWidth: 1280,
  windowHeight: 900,
  extraArgs: [] as string[],
  extensions: [] as string[],
  screencastFrameSkip: 4,
  screencastQuality: 70,
  maxSnapshotText: 60000,
  maxTabs: 16,
  confirmFirstLaunch: true,
}

/**
 * Loader-validated config schema; defaults come from {@link DEFAULTS}.
 *
 * Deliberately not annotated as `z<Config>`: the schema describes plain
 * values while the fields the Loader hands the plugin are volatile refs, and
 * schemastery's facade type has no room for that difference on arrays (the
 * per-field volatility is checked at the use sites instead).
 */
export const Config = z.object({
  executablePath: z.string().default(DEFAULTS.executablePath),
  headless: z.boolean().default(DEFAULTS.headless),
  dataRoot: z.string().default(DEFAULTS.dataRoot),
  idleTimeoutMs: z.number().min(0).default(DEFAULTS.idleTimeoutMs),
  windowWidth: z.number().min(0).default(DEFAULTS.windowWidth),
  windowHeight: z.number().min(0).default(DEFAULTS.windowHeight),
  extraArgs: z.array(z.string()).default(DEFAULTS.extraArgs).volatile(),
  extensions: z.array(z.string()).default(DEFAULTS.extensions).volatile(),
  screencastFrameSkip: z.number().min(1).default(DEFAULTS.screencastFrameSkip),
  screencastQuality: z.number().min(1).max(100).default(DEFAULTS.screencastQuality),
  maxSnapshotText: z.number().min(1000).default(DEFAULTS.maxSnapshotText),
  maxTabs: z.number().min(1).default(DEFAULTS.maxTabs),
  confirmFirstLaunch: z.boolean().default(DEFAULTS.confirmFirstLaunch),
})

/**
 * Raw config as it arrives at the plugin: the Loader hands volatile fields
 * over as refs, while tests and programmatic callers pass plain values.
 */
export type RawConfig = Omit<Partial<Config>, 'extraArgs' | 'extensions'> & {
  extraArgs?: Volatile<string[]> | string[]
  extensions?: Volatile<string[]> | string[]
}

/** Shared empty value for both list fields (never mutated in place). */
const NO_STRINGS: readonly string[] = Object.freeze([])

/**
 * Normalize one list field into a live value.
 *
 * A Loader-mounted plugin receives volatile fields as refs, while tests and
 * programmatic construction hand in plain arrays; both are accepted so
 * {@link resolveConfig} stays usable without a Loader.
 * @param value - volatile ref, plain array, or nothing.
 * @returns a live reader of the list.
 */
function liveStrings(value: Volatile<string[]> | string[] | undefined): Live<string[]> {
  if (value === undefined) return { get: () => [...NO_STRINGS] }
  if (Array.isArray(value)) {
    const fixed = [...value]
    return { get: () => [...fixed] }
  }
  return { get: () => [...value.get()] }
}

/** Resolved shape after the Loader applies schema defaults. */
export type ResolvedConfig = {
  [K in Exclude<keyof Config, 'extraArgs' | 'extensions'>]-?: NonNullable<Config[K]>
} & {
  extraArgs: Live<string[]>
  extensions: Live<string[]>
}

/** Resolve a (possibly partial) raw config into a complete value. */
export function resolveConfig(raw: RawConfig = {}): ResolvedConfig {
  return {
    executablePath: raw.executablePath ?? DEFAULTS.executablePath,
    headless: raw.headless ?? DEFAULTS.headless,
    dataRoot: raw.dataRoot ?? DEFAULTS.dataRoot,
    idleTimeoutMs: raw.idleTimeoutMs ?? DEFAULTS.idleTimeoutMs,
    windowWidth: raw.windowWidth ?? DEFAULTS.windowWidth,
    windowHeight: raw.windowHeight ?? DEFAULTS.windowHeight,
    extraArgs: liveStrings(raw.extraArgs),
    extensions: liveStrings(raw.extensions),
    screencastFrameSkip: raw.screencastFrameSkip ?? DEFAULTS.screencastFrameSkip,
    screencastQuality: raw.screencastQuality ?? DEFAULTS.screencastQuality,
    maxSnapshotText: raw.maxSnapshotText ?? DEFAULTS.maxSnapshotText,
    maxTabs: raw.maxTabs ?? DEFAULTS.maxTabs,
    confirmFirstLaunch: raw.confirmFirstLaunch ?? DEFAULTS.confirmFirstLaunch,
  }
}
