/**
 * Viewer policy regression: opening the Chrome tab must never launch Chrome.
 *
 * The panel opens a live-view WebSocket as soon as it mounts, and the host
 * used to answer that connection with `getOrLaunch` — so merely switching to
 * the Chrome tab started a browser nobody asked for. These tests drive the
 * real HTTP/WS surface through a fake browser (no real Chrome is spawned) and
 * pin both halves of the contract:
 *
 *   - a viewer connection attaches to an existing window and launches nothing;
 *   - an explicit open (the panel's Open button / chrome_open) still launches,
 *     and the already-connected viewer starts streaming from that window.
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Browser } from 'puppeteer-core'
import { WebSocket } from 'ws'
import type { HostWsMessage } from '../src/shared/contract.ts'
import { API_PREFIX, WS_PATH } from '../src/shared/contract.ts'
import { installApi } from '../src/host/api.ts'
import { resolveConfig } from '../src/host/config.ts'
import { ChromeManager } from '../src/host/manager.ts'

/** Minimal puppeteer Browser stand-in (no pages, no real window). */
function fakeBrowser(): Browser {
  return {
    connected: true,
    on: (): void => {},
    pages: async (): Promise<never[]> => [],
    target: () => ({
      createCDPSession: async () => ({ send: async (): Promise<unknown> => ({}), detach: async (): Promise<void> => {} }),
    }),
    close: async (): Promise<void> => {},
  } as unknown as Browser
}

/** Await the next WebSocket message (fails loudly instead of hanging). */
function nextMessage(socket: WebSocket, timeoutMs = 4000): Promise<HostWsMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('等待 WebSocket 消息超时')), timeoutMs)
    socket.once('message', (raw) => {
      clearTimeout(timer)
      resolve(JSON.parse(String(raw)) as HostWsMessage)
    })
  })
}

describe('viewer connection policy', () => {
  let dataRoot: string
  let server: Server
  let manager: ChromeManager
  let dispose: () => void
  let port = 0
  /** Session ids the manager was asked to launch (the assertion surface). */
  let launched: string[]
  const sockets: WebSocket[] = []

  beforeEach(async () => {
    dataRoot = mkdtempSync(join(tmpdir(), 'dsh-chrome-api-'))
    launched = []
    manager = new ChromeManager(resolveConfig({ idleTimeoutMs: 0 }), dataRoot, async (sessionId) => {
      launched.push(sessionId)
      return { browser: fakeBrowser(), adopted: false }
    })

    // Stand in for the host web server: one prefix route plus the upgrade hook.
    let prefixHandler: ((req: unknown, res: unknown) => unknown) | undefined
    let upgradeHandler: ((req: unknown, socket: unknown, head: unknown) => void) | undefined
    server = createServer((req, res) => {
      void prefixHandler?.(req, res)
    })
    server.on('upgrade', (req, socket, head) => {
      upgradeHandler?.(req, socket, head)
    })
    const webCtx = {
      webServer: {
        register: (route: { handler: typeof prefixHandler }) => {
          prefixHandler = route.handler
          return () => { prefixHandler = undefined }
        },
        registerUpgrade: (route: { handler: typeof upgradeHandler }) => {
          upgradeHandler = route.handler
          return () => { upgradeHandler = undefined }
        },
      },
    } as unknown as Context

    dispose = installApi(webCtx, manager)
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
    port = (server.address() as AddressInfo).port
  })

  afterEach(async () => {
    for (const socket of sockets) socket.close()
    sockets.length = 0
    dispose()
    await manager.closeAll()
    manager.dispose()
    await new Promise<void>((resolve) => { server.close(() => resolve()) })
    rmSync(dataRoot, { recursive: true, force: true })
  })

  /** Connect one live-view socket and return its welcome frame. */
  async function connectViewer(sessionId: string): Promise<{ socket: WebSocket; welcome: HostWsMessage }> {
    const socket = new WebSocket(`ws://127.0.0.1:${String(port)}${WS_PATH}?sessionId=${sessionId}`)
    sockets.push(socket)
    const welcome = await nextMessage(socket)
    return { socket, welcome }
  }

  it('does not launch Chrome when a viewer connects', async () => {
    const { welcome } = await connectViewer('session-viewer')

    expect(launched).toEqual([])
    expect(manager.get('session-viewer')).toBeUndefined()
    // The panel still gets a usable snapshot to render "window closed".
    expect(welcome.type).toBe('welcome')
    if (welcome.type !== 'welcome') throw new Error('unreachable')
    expect(welcome.status.running).toBe(false)
    expect(welcome.status.error).toBeNull()
  })

  it('reports the idle status over HTTP without launching either', async () => {
    const res = await fetch(`http://127.0.0.1:${String(port)}${API_PREFIX}/status?sessionId=session-idle`)
    const status = (await res.json()) as { running: boolean; pages: unknown[] }

    expect(res.status).toBe(200)
    expect(launched).toEqual([])
    expect(status.running).toBe(false)
    expect(status.pages).toEqual([])
  })

  it('launches on an explicit open and streams to the waiting viewer', async () => {
    const { socket } = await connectViewer('session-open')
    expect(launched).toEqual([])

    const res = await fetch(`http://127.0.0.1:${String(port)}${API_PREFIX}/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${String(port)}` },
      body: JSON.stringify({ sessionId: 'session-open' }),
    })

    expect(res.status).toBe(200)
    expect(launched).toEqual(['session-open'])
    // The viewer that was waiting before the window existed is now attached.
    expect(manager.get('session-open')?.hasScreencastWatchers()).toBe(true)
    expect(socket.readyState).toBe(WebSocket.OPEN)
  })

  it('detaches the viewer when its socket closes', async () => {
    await fetch(`http://127.0.0.1:${String(port)}${API_PREFIX}/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${String(port)}` },
      body: JSON.stringify({ sessionId: 'session-detach' }),
    })
    const { socket } = await connectViewer('session-detach')
    expect(manager.get('session-detach')?.hasScreencastWatchers()).toBe(true)

    socket.close()
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(manager.get('session-detach')?.hasScreencastWatchers()).toBe(false)
  })
})
