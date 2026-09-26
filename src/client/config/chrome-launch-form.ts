/**
 * Staged form behind the plugin's configuration card.
 *
 * The Host side declares `extensions` and `extraArgs` as volatile string
 * lists, so editing them never remounts the plugin (a remount would dispose
 * the manager and close every open window). This controller reads those
 * values through the shared entry form, stages a local draft for the card's
 * list editors, and writes both fields back in one revision-fenced mutation.
 */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsFormScope, SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives'

/** The two config fields this card edits. */
export interface ChromeLaunchSettings {
  /** Extension sources: `.crx` files or unpacked directories. */
  extensions?: string[]
  /** Extra Chrome flags, one whole flag per entry. */
  extraArgs?: string[]
}

/** Key of one editable list field. */
export type ChromeLaunchField = 'extensions' | 'extraArgs'

/** Everything the card renders. */
export interface ChromeLaunchCardState extends SettingsFormShell {
  /** Staged extension sources. */
  extensions: string[]
  /** Staged extra Chrome flags. */
  extraArgs: string[]
  /** Row-level shape check for {@link extensions} (same length). */
  extensionsInvalid: boolean[]
  /** Row-level shape check for {@link extraArgs} (same length). */
  extraArgsInvalid: boolean[]
}

/** Business face the card's slot registration injects. */
export interface ChromeLaunchCardFace {
  hooks: {
    /** Card snapshot, bound as the component's `useChromeLaunch` selector hook. */
    chromeLaunch: SnapshotStore<ChromeLaunchCardState>
  }
  /** Append an empty row to one list. */
  addRow: (field: ChromeLaunchField) => void
  /** Replace one row's text. */
  editRow: (field: ChromeLaunchField, index: number, value: string) => void
  /** Drop one row. */
  removeRow: (field: ChromeLaunchField, index: number) => void
  /** Write every staged row to the Host entry. */
  save: () => void
  /** Drop the draft and follow the Host value again. */
  discard: () => void
}

/** One staged draft: both lists together so a save writes them atomically. */
interface Draft {
  extensions: string[]
  extraArgs: string[]
}

/** Whether one extension row is a usable source (mirrors the host-side rule). */
function extensionRowValid(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed === '') return true // an empty row is dropped on save
  return trimmed.startsWith('~') || trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(trimmed)
}

/** Whether one argument row is a usable flag (mirrors the host-side rule). */
function argRowValid(value: string): boolean {
  const trimmed = value.trim()
  return trimmed === '' || trimmed.startsWith('-')
}

/** Copy a Host list value, tolerating anything the wire hands over. */
function rowsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.map(row => (typeof row === 'string' ? row : String(row))) : []
}

/** The Host's current lists. */
function hostLists(value: ChromeLaunchSettings | undefined): Draft {
  return { extensions: rowsOf(value?.extensions), extraArgs: rowsOf(value?.extraArgs) }
}

/** Whether two row lists are equal as staged. */
function sameRows(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((row, index) => row === right[index])
}

/** Drop blank rows and trim the rest, as the Host stores them. */
function cleanRows(rows: readonly string[]): string[] {
  return rows.map(row => row.trim()).filter(row => row !== '')
}

/**
 * Stage the two launch-config lists over one shared entry form.
 *
 * Drafts follow the Host value until the user edits a row; a save clears the
 * draft so the card tracks the Host again, and a refused save keeps it so the
 * edit is not lost.
 */
export class ChromeLaunchCardController {
  private readonly store: SnapshotStore<ChromeLaunchCardState>
  private readonly unsubscribe: () => void
  /** ``null`` while the card follows the Host value. */
  private draft: Draft | null = null
  private saving = false
  private failed = false

  /** @param scope - shared configuration form of this plugin's profile entry. */
  constructor(private readonly scope: SettingsFormScope<ChromeLaunchSettings>) {
    this.store = createSnapshotStore(this.project())
    this.unsubscribe = this.scope.subscribe(() => { this.publish() })
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card snapshot hook plus its edit actions.
   */
  inject(): ChromeLaunchCardFace {
    return {
      hooks: { chromeLaunch: this.store },
      addRow: (field) => { this.edit(field, rows => [...rows, '']) },
      editRow: (field, index, value) => { this.edit(field, rows => rows.map((row, at) => (at === index ? value : row))) },
      removeRow: (field, index) => { this.edit(field, rows => rows.filter((_, at) => at !== index)) },
      save: () => { void this.save() },
      discard: () => {
        this.failed = false
        this.draft = null
        this.publish()
      },
    }
  }

  /** Release the form subscription (card unmount). */
  dispose(): void {
    this.unsubscribe()
  }

  /** Apply one edit to a staged row list. */
  private edit(field: ChromeLaunchField, change: (rows: string[]) => string[]): void {
    const current = this.draft ?? hostLists(this.scope.getSnapshot().value)
    this.failed = false
    this.draft = { ...current, [field]: change([...current[field]]) }
    this.publish()
  }

  /** Write both lists as one fenced mutation. */
  private async save(): Promise<void> {
    const state = this.project()
    if (!state.dirty || state.invalid || this.saving) return
    this.saving = true
    this.store.set(this.project())
    let accepted = false
    try {
      accepted = await this.scope.mutate([
        { op: 'set', path: ['extensions'], value: cleanRows(state.extensions) },
        { op: 'set', path: ['extraArgs'], value: cleanRows(state.extraArgs) },
      ], this.scope.getSnapshot().revision)
    } finally {
      this.saving = false
      this.failed = !accepted
      if (accepted) this.draft = null
      this.store.set(this.project())
    }
  }

  /** Recompute and publish the card snapshot. */
  private publish(): void {
    const state = this.project()
    // A draft that matches the Host value carries no edit: drop it so later
    // Host-side changes (another page, a profile patch) stay visible here.
    if (!state.dirty) this.draft = null
    this.store.set(state)
  }

  /** Project the current draft and Host value into the rendered state. */
  private project(): ChromeLaunchCardState {
    const snapshot = this.scope.getSnapshot()
    const host = hostLists(snapshot.value)
    const rows = this.draft ?? host
    const extensionsInvalid = rows.extensions.map(row => !extensionRowValid(row))
    const extraArgsInvalid = rows.extraArgs.map(row => !argRowValid(row))
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: !sameRows(rows.extensions, host.extensions) || !sameRows(rows.extraArgs, host.extraArgs),
      invalid: extensionsInvalid.includes(true) || extraArgsInvalid.includes(true),
      saving: this.saving,
      failed: this.failed,
      extensions: rows.extensions,
      extraArgs: rows.extraArgs,
      extensionsInvalid,
      extraArgsInvalid,
    }
  }
}
