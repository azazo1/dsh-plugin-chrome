/**
 * Shared wire contract between the host and client halves.
 *
 * This module is imported by BOTH build faces, so it must stay free of any
 * Node or browser runtime: pure types and JSON-safe constants only. The
 * tsdown faces each inline their own copy — there is no shared runtime
 * identity, only a shared vocabulary.
 */

/** API prefix served by the host half. */
export const API_PREFIX = '/dsh-chrome/api'

/** WebSocket upgrade path served by the host half (screencast + status). */
export const WS_PATH = '/dsh-chrome/ws'

/** Screenshot storage layout under the plugin data dir. */
export const SCREENSHOTS_DIR = 'screenshots'

/** Data-root layout: <dataRoot>/sessions/<sessionId>/profile + screenshots. */
export const SESSIONS_DIR = 'sessions'

/**
 * Data-root layout: <dataRoot>/extensions/<source hash>/ holds one .crx
 * unpacked once per configuration (shared by every session window).
 */
export const EXTENSIONS_DIR = 'extensions'

/** Structural prefix of a store-minted session id (`session-<n>`). */
const SESSION_ID_PREFIX = 'session-'

/**
 * Compact session label for display text and file names.
 *
 * A bare `slice(0, 8)` of a store-minted id (`session-<n>`) returns the
 * constant `session-`, which identifies nothing. The structural prefix is
 * therefore stripped first; ids that carry no such prefix (caller-supplied
 * ones) are truncated as-is, and the truncation still bounds long ids.
 * @param sessionId - full session id.
 * @returns up to 8 identifying characters.
 */
export function shortSessionId(sessionId: string): string {
  const body = sessionId.startsWith(SESSION_ID_PREFIX) ? sessionId.slice(SESSION_ID_PREFIX.length) : sessionId
  return (body === '' ? sessionId : body).slice(0, 8)
}

/** One page (tab) as reported by status endpoints. */
export interface PageInfo {
  /** Zero-based tab index inside this session's Chrome window. */
  index: number
  url: string
  title: string
  active: boolean
  /** True when this tab is the current control target. */
  selected: boolean
}

/** Live status of one session's Chrome window. */
export interface ChromeStatus {
  sessionId: string
  running: boolean
  pages: PageInfo[]
  startedAt: number | null
  lastUsedAt: number | null
  /** Epoch ms when the idle timer closes the window; null when disabled. */
  idleDeadline: number | null
  /** Most recent screenshot file name (screenshots dir), if any. */
  lastScreenshot: string | null
  /** Whether a screencast stream is currently feeding Web UI viewers. */
  screencastActive: boolean
  error: string | null
}

/** One stored screenshot entry. */
export interface ScreenshotEntry {
  name: string
  createdAt: number
  bytes: number
  width: number
  height: number
  fullPage: boolean
  pageTitle: string
  url: string
}

/** WebSocket frames pushed host → client. */
export type HostWsMessage =
  | { type: 'welcome'; status: ChromeStatus }
  | { type: 'status'; status: ChromeStatus }
  | { type: 'frame'; data: string; seq: number; width: number; height: number }
  | { type: 'event'; detail: ChromeEventDetail }
  | { type: 'pong' }

/**
 * Client → host WebSocket frames.
 *
 * There is no subscribe/unsubscribe message: the host attaches every viewer
 * socket to whatever window already exists when the socket connects, and
 * never launches one on the client's behalf. The client only keeps the
 * connection alive.
 */
export type ClientWsMessage = { type: 'ping' }

/** Fine-grained change notices carried inside the `event` frame. */
export type ChromeEventDetail =
  | { kind: 'opened' }
  | { kind: 'closed' }
  | { kind: 'page-added'; page: PageInfo }
  | { kind: 'page-removed'; index: number }
  | { kind: 'page-selected'; index: number }
  | { kind: 'navigated'; index: number; url: string; title: string }
  | { kind: 'screenshot'; entry: ScreenshotEntry }
  | { kind: 'screencast-changed'; active: boolean }
