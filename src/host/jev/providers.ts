/**
 * Jev provider endpoints (aligned with jev-browser-use).
 */
import type { JevProvider, JevProviderRoute } from './types.ts'

/** All supported routes, keyed by provider id. */
export const JEV_PROVIDER_ROUTES: Record<JevProvider, JevProviderRoute> = {
  typesafe: {
    endpoint: 'https://api.typesafe.ai/v1/systemone',
    keyName: 'TYPESAFE_API_KEY',
    defaultModel: 'jev-latest',
    modelPattern: /^jev-[a-z0-9.-]{1,80}$/u,
  },
  openrouter: {
    endpoint: 'https://openrouter.ai/api/alpha/decisions',
    keyName: 'OPENROUTER_API_KEY',
    defaultModel: '~typesafe/jev-latest',
    modelPattern: /^(?:~?typesafe\/)?jev-[a-z0-9.-]{1,80}$/u,
  },
}

/** Resolve one provider's route (throws on an unknown provider id). */
export function providerRoute(provider: JevProvider): JevProviderRoute {
  const route = JEV_PROVIDER_ROUTES[provider]
  if (route === undefined) throw new Error(`不支持的 Jev provider: ${String(provider)}`)
  return route
}
