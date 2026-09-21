/**
 * Jev delegation vocabulary, shared by the state, decision, action, engine,
 * and tool layers.
 *
 * The protocol mirrors jev-browser-use (MIT) so a deployment already
 * configured for it keeps working: provider endpoints, the state line
 * format, the control/policy shape, and every run() contract bound are
 * aligned with the upstream bridge.
 */

/** Supported Jev decision providers. */
export type JevProvider = 'typesafe' | 'openrouter'

/** Jev provider route: endpoint, credential variable, default model. */
export interface JevProviderRoute {
  endpoint: string
  /** Credential variable name in the env file (uppercase). */
  keyName: string
  defaultModel: string
  /** Model identifiers this route accepts. */
  modelPattern: RegExp
}

/** Credential + provider selection, resolved from config (never the key itself). */
export interface JevCredentials {
  /** Absolute path of the dotenv file holding the provider API key. */
  envFile: string
  provider: JevProvider
  /** '' selects the provider's default model. */
  model: string
}

/** One numbered control in the model-facing state text. */
export interface JevStateEntry {
  index: number
  role: string
  /** Trimmed accessible name ('' when the node only carries a value). */
  name: string
  /** Accessible value text ('' when none). */
  value: string
  /** Present when the AX node links back to a DOM node (clickable/scrollable). */
  backendNodeId?: number
}

/** A captured page state: text for Jev, entries for action resolution. */
export interface JevPageState {
  /** Header + numbered state lines, exactly what Jev reads. */
  text: string
  entries: JevStateEntry[]
}

/** A click on a named control (name matching supports the `, Value:` suffix). */
export interface JevClickControl {
  op: 'click'
  name: string
  aliases?: string[]
  description?: string
}

/** A bounded scroll of the page, a named container, or a viewport point. */
export interface JevScrollControl {
  op: 'scroll'
  direction: 'up' | 'down'
  /** Pages (1-5). */
  amount?: number
  /** Name of an observable container to scroll (exactly one must match). */
  targetName?: string
  targetAliases?: string[]
  /** Viewport point supplied once by the main model; mutually exclusive with targetName. */
  point?: [number, number]
  description?: string
}

/** A whitelisted safe key press. */
export interface JevPressControl {
  op: 'press'
  key: string
  description?: string
}

/** Reload the current page. */
export interface JevReloadControl {
  op: 'reload'
  description?: string
}

/** Any explicit control the caller hands to the loop. */
export type JevControl = JevClickControl | JevScrollControl | JevPressControl | JevReloadControl

/** Name pattern: a plain string or a `"/pattern/flags"` literal (JSON has no RegExp). */
export type JevNamePattern = string

/** Opt-in discovery of currently observed low-risk mechanical actions. */
export interface JevPolicy {
  /** Discover unique-named clickable controls. */
  click?: boolean
  scrollDirections?: Array<'up' | 'down'>
  /** Pages per discovered scroll (1-5, default 1). */
  scrollAmount?: number
  scrollTargetName?: JevNamePattern
  scrollTargetAliases?: JevNamePattern[]
  /** Viewport point for discovered scrolls; mutually exclusive with scrollTargetName. */
  scrollPoint?: [number, number]
  keys?: string[]
  reload?: boolean
  /** Never discovered (string or /pattern/ literal). */
  denyNames?: JevNamePattern[]
  /** Discovered but reported back as require-codex actions. */
  requireCodexNames?: JevNamePattern[]
  /** When non-empty, only matching controls are discovered. */
  allowNames?: JevNamePattern[]
}

/** One candidate action prepared for the decision call. */
export interface JevAction {
  op: 'click' | 'scroll' | 'press' | 'reload'
  /** Human-readable sentence shown to Jev as the criterion. */
  description: string
  /** Click: resolved state index. */
  index?: number
  /** Scroll: state index or [x, y] point; undefined = the page. */
  target?: number | [number, number]
  /** Scroll: page count. */
  amount?: number
  /** Press: the key. */
  key?: string
  direction?: 'up' | 'down'
  /** Original explicit control, when the candidate came from `controls`. */
  control?: JevControl
  /** Discovered-but-consequential action the main model must do itself. */
  requireCodex?: true
}

/** One recorded decision/action step (a row of the loop history). */
export interface JevHistoryEntry {
  provider: string
  choice: string
  confidence: number | null
  model: string | null
  apiMs: number | null
  /** Description of the chosen action (or the terminal choice). */
  action: string
  executed: boolean
  reason?: string
  /** Set when an action ran but the state text did not change. */
  noEffect?: boolean
  /** Set when a scroll ran but only a screenshot can confirm its effect. */
  effectNeedsVisualVerification?: boolean
}

/** Terminal statuses of one bounded run. */
export type JevRunStatus =
  | 'needs_verification'
  | 'low_confidence'
  | 'blocked'
  | 'no_progress'
  | 'loading_timeout'
  | 'decision_error'
  | 'action_error'
  | 'budget'
  | 'step_limit'

/** Jev decision answer, validated against the strict choice schema. */
export interface JevDecision {
  provider: JevProvider
  choice: string
  confidence: number
  model: string
  apiMs: number
  /** The resolved action when the choice is a candidate index (a0, a1, ...). */
  action: JevAction | null
}

/** Outcome of one bounded run (handoff is the upstream cross-runtime name). */
export interface JevRunResult {
  status: JevRunStatus
  handoff: string | null
  history: JevHistoryEntry[]
  state: string
  elapsedMs: number
  steps: number
  /** Total time spent inside decision API calls. */
  apiMs: number
  error?: string
}

/** Aggregate metrics remembered across runs of one session store entry. */
export interface JevSessionMetrics {
  runs: number
  decisions: number
  executedActions: number
  failedDecisions: number
  apiMs: number
  elapsedMs: number
}
