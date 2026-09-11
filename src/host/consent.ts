/**
 * Session-scoped launch consent.
 *
 * Starting a visible Chrome window is the one thing this plugin does that the
 * user should agree to explicitly: it spawns a real browser process on their
 * desktop. The FIRST launch of a session is therefore put to the user through
 * the DSH approval channel (the Web GUI renders it as an approval prompt);
 * once granted, every later chrome_* call of that session runs without asking
 * again.
 *
 * Consent is deliberately memory-only and keyed by session id: it never
 * outlives the host process and never leaks from one session to another.
 *
 * The prompt's reason is never plugin boilerplate: it is the model's own
 * `justification` argument (declared by `chrome_open`), and a pending launch
 * that carries none is denied rather than asked, so the user never faces an
 * unexplained browser launch.
 */

/** Tools that never launch a window, so they never need launch consent. */
const NON_LAUNCHING_TOOLS: ReadonlySet<string> = new Set(['chrome_status', 'chrome_close'])

/** In-memory record of the sessions whose user already allowed a launch. */
export class LaunchConsent {
  private readonly granted = new Set<string>()

  /** Whether this session's user already allowed launching a window. */
  isGranted(sessionId: string): boolean {
    return this.granted.has(sessionId)
  }

  /** Remember the user's grant for one session. */
  grant(sessionId: string): void {
    this.granted.add(sessionId)
  }
}

/**
 * Read the model's one-sentence reason out of a pending call's arguments.
 *
 * Only `chrome_open` advertises the field, but the implicit parameter object
 * stays open (validation checks advertised keys only), so this reader judges
 * the value instead of trusting the tool name.
 * @param args - the pending call's parsed arguments, however malformed.
 * @returns the trimmed reason, or undefined when the call carries none.
 */
export function justificationOf(args: unknown): string | undefined {
  if (typeof args !== 'object' || args === null) return undefined
  const value = (args as { justification?: unknown }).justification
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** What the gate needs to know about one pending tool call. */
export interface LaunchConsentInput {
  /** Tool name of the pending call. */
  toolName: string
  /** Whether the session already has a live Chrome window. */
  hasWindow: boolean
  /** Whether this session's user already granted a launch. */
  granted: boolean
  /** Whether the `confirmFirstLaunch` config is on. */
  enabled: boolean
}

/**
 * Whether a pending call must ask the user before it may launch a window.
 *
 * Only calls that would actually start a browser ask: an already open window is
 * reused silently, and the two lifecycle tools that never launch anything
 * (`chrome_status` / `chrome_close`) stay quiet too. Any other chrome_* tool
 * can launch implicitly, so it goes through the same question as chrome_open.
 */
export function needsLaunchConsent(input: LaunchConsentInput): boolean {
  if (!input.enabled || input.granted || input.hasWindow) return false
  if (!input.toolName.startsWith('chrome_')) return false
  return !NON_LAUNCHING_TOOLS.has(input.toolName)
}
