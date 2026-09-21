/**
 * Jev decision client: strict Choice-schema validation and credential
 * hygiene, exercised against an injected fetch (no network).
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decide, parseEnvFile, readCredential } from '../src/host/jev/decide.ts'
import { JEV_PROVIDER_ROUTES } from '../src/host/jev/providers.ts'

/** Write a throwaway dotenv file and return its path. */
function tempEnvFile(key: string, value = 'test-key-123'): string {
  const dir = mkdtempSync(join(tmpdir(), 'jev-test-'))
  const path = join(dir, 'credentials.env')
  writeFileSync(path, `${key}=${value}\n`)
  return path
}

const CREDENTIALS = { envFile: '', provider: 'typesafe' as const, model: '' }

/** A decision response body with a valid probability distribution. */
function validBody(choice = 'a0', confidence = 0.9, model = 'jev-latest'): string {
  return JSON.stringify({
    model,
    answers: { next: { type: 'choice', choice, confidence, probabilities: { a0: 0.7, DONE: 0.2, BLOCKED: 0.05, WAIT: 0.05 } } },
  })
}

/** Build a fetch mock returning one fixed response. */
function fetchOf(status: number, body: string, calls: string[][] = []): typeof fetch {
  return (async (_url: unknown, init?: { body?: string }) => {
    calls.push([String(_url), init?.body ?? ''])
    return new Response(body, { status })
  }) as unknown as typeof fetch
}

describe('parseEnvFile', () => {
  it('reads KEY=VALUE lines and strips quotes/comments', () => {
    const env = parseEnvFile('# comment\nA=1\nB = "two words"\nC=\'three\'\nbroken line\n')
    expect(env).toEqual({ A: '1', B: 'two words', C: 'three' })
  })
})

describe('readCredential', () => {
  it('rejects a missing envFile with a configuration error', () => {
    expect(() => readCredential('', 'typesafe')).toThrow(/jevEnvFile/u)
  })

  it('rejects a missing key variable', () => {
    const path = tempEnvFile('OTHER_KEY', 'x')
    expect(() => readCredential(path, 'typesafe')).toThrow(/TYPESAFE_API_KEY/u)
  })

  it('accepts the lowercase variable name on openrouter', () => {
    const path = tempEnvFile('openrouter_api_key', 'lower-works')
    expect(readCredential(path, 'openrouter')).toBe('lower-works')
  })
})

describe('decide', () => {
  const input = {
    goal: 'Open settings',
    state: 'Browser tab: Test URL: "https://example.com/".\n1 button Settings',
    actions: [{ op: 'click' as const, index: 1, description: 'Click Settings' }],
    history: [],
  }

  it('sends criteria and returns the resolved action', async () => {
    const calls: string[][] = []
    const fetchImpl = fetchOf(200, validBody(), calls)
    const decision = await decide({
      ...input,
      credentials: { ...CREDENTIALS, envFile: tempEnvFile('TYPESAFE_API_KEY') },
      timeoutMs: 1000,
      fetchImpl,
    })
    expect(decision.choice).toBe('a0')
    expect(decision.action?.description).toBe('Click Settings')
    expect(decision.model).toBe('jev-latest')
    const body = JSON.parse(calls[0][1]) as { questions: { next: { criteria: Record<string, string> } } }
    expect(Object.keys(body.questions.next.criteria).sort()).toEqual(['DONE', 'BLOCKED', 'WAIT', 'a0'].sort())
  })

  it('never leaks the credential into the request body', async () => {
    const calls: string[][] = []
    const fetchImpl = fetchOf(200, validBody(), calls)
    await expect(decide({
      ...input,
      credentials: { ...CREDENTIALS, envFile: tempEnvFile('TYPESAFE_API_KEY', 'super-secret-value') },
      timeoutMs: 1000,
      fetchImpl,
    })).resolves.toBeTruthy()
    expect(calls[0][1]).not.toContain('super-secret-value')
  })

  it('rejects a probability sum off by more than 0.02', async () => {
    const body = JSON.stringify({
      model: 'jev-latest',
      answers: { next: { type: 'choice', choice: 'a0', confidence: 0.9, probabilities: { a0: 0.9, DONE: 0.2, BLOCKED: 0.05, WAIT: 0.05 } } },
    })
    await expect(decide({
      ...input,
      credentials: { ...CREDENTIALS, envFile: tempEnvFile('TYPESAFE_API_KEY') },
      timeoutMs: 1000,
      fetchImpl: fetchOf(200, body),
    })).rejects.toThrow(/Choice schema/u)
  })

  it('rejects a non-argmax choice', async () => {
    const body = JSON.stringify({
      model: 'jev-latest',
      answers: { next: { type: 'choice', choice: 'DONE', confidence: 0.9, probabilities: { a0: 0.9, DONE: 0.05, BLOCKED: 0.03, WAIT: 0.02 } } },
    })
    await expect(decide({
      ...input,
      credentials: { ...CREDENTIALS, envFile: tempEnvFile('TYPESAFE_API_KEY') },
      timeoutMs: 1000,
      fetchImpl: fetchOf(200, body),
    })).rejects.toThrow(/Choice schema/u)
  })

  it('rejects a model outside the provider pattern', async () => {
    await expect(decide({
      ...input,
      credentials: { ...CREDENTIALS, envFile: tempEnvFile('TYPESAFE_API_KEY'), model: 'gpt-4o' },
      timeoutMs: 1000,
      fetchImpl: fetchOf(200, validBody('a0', 0.9, 'gpt-4o')),
    })).rejects.toThrow(/模型名/u)
  })

  it('maps an HTTP error to a readable transport error', async () => {
    await expect(decide({
      ...input,
      credentials: { ...CREDENTIALS, envFile: tempEnvFile('TYPESAFE_API_KEY') },
      timeoutMs: 1000,
      fetchImpl: fetchOf(401, '{"error":"bad key"}'),
    })).rejects.toThrow(/401/u)
  })

  it('resolves the openrouter endpoint and default model', async () => {
    const calls: string[][] = []
    const fetchImpl = fetchOf(200, validBody('a0', 0.9, '~typesafe/jev-latest'), calls)
    const decision = await decide({
      ...input,
      credentials: { envFile: tempEnvFile('OPENROUTER_API_KEY'), provider: 'openrouter', model: '' },
      timeoutMs: 1000,
      fetchImpl,
    })
    expect(calls[0][0]).toBe(JEV_PROVIDER_ROUTES.openrouter.endpoint)
    expect(decision.model).toBe('~typesafe/jev-latest')
  })
})
