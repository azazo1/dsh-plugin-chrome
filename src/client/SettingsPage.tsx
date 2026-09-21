/**
 * The plugin's settings page, rendered inside the DSH settings panel as a
 * `settings.section` entry.
 *
 * All values flow through the bound settings scope: the snapshot drives the
 * form, `scope.set` persists field writes, and the Host merges them over the
 * profile config live. Styling uses only DSH theme tokens.
 */
import { createElement, useSyncExternalStore } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { ChromeSettings } from '../shared/settings-contract.ts'
import { SETTINGS_FIELDS, JEV_PROVIDERS } from '../shared/settings-contract.ts'
import type { Translate } from './settings-i18n.ts'

/** Props the client entry injects into the page. */
export interface SettingsPageProps {
  scope: SettingsScope<ChromeSettings>
  t: Translate
}

/** Read one field off the latest scope snapshot. */
function useField(scope: SettingsScope<ChromeSettings>, field: keyof ChromeSettings): unknown {
  return useSyncExternalStore(
    (onChange) => scope.subscribe(onChange),
    () => (scope.getSnapshot().value ?? {})[field],
  )
}

/** One labeled settings row (label + control + description). */
function Row(props: { label: string; description: string; children?: React.ReactNode }) {
  return createElement(
    'div',
    { className: 'dsh-chrome-settings__row' },
    createElement(
      'div',
      { className: 'dsh-chrome-settings__text' },
      createElement('div', { className: 'dsh-chrome-settings__label' }, props.label),
      createElement('div', { className: 'dsh-chrome-settings__desc' }, props.description),
    ),
    createElement('div', { className: 'dsh-chrome-settings__control' }, props.children),
  )
}

/** The settings page. */
export function SettingsPage(props: SettingsPageProps) {
  const { scope, t } = props
  const writable = scope.getSnapshot().writable
  const jevEnabled = useField(scope, 'jevEnabled') as boolean | undefined
  const jevProvider = useField(scope, 'jevProvider') as string | undefined
  const jevModel = useField(scope, 'jevModel') as string | undefined
  const jevEnvFile = useField(scope, 'jevEnvFile') as string | undefined
  const headless = useField(scope, 'headless') as boolean | undefined
  const idleTimeoutMs = useField(scope, 'idleTimeoutMs') as number | undefined
  const maxSnapshotText = useField(scope, 'maxSnapshotText') as number | undefined
  const maxTabs = useField(scope, 'maxTabs') as number | undefined
  const confirmFirstLaunch = useField(scope, 'confirmFirstLaunch') as boolean | undefined

  return createElement(
    'section',
    { className: 'dsh-chrome-settings' },
    createElement('h2', { className: 'dsh-chrome-settings__title' }, t('settings.title')),
    createElement('p', { className: 'dsh-chrome-settings__intro' }, t('settings.intro')),
    createElement(
      'div',
      { className: 'dsh-chrome-settings__card' },
      createElement(Row, {
        label: t('settings.jevEnabled.label'),
        description: t('settings.jevEnabled.desc'),
      }, createElement('input', {
        type: 'checkbox',
        checked: jevEnabled === true,
        disabled: !writable,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
          void scope.set(SETTINGS_FIELDS.jevEnabled, event.currentTarget.checked)
        },
      })),
      createElement(Row, {
        label: t('settings.jevProvider.label'),
        description: t('settings.jevProvider.desc'),
      }, createElement('select', {
        value: jevProvider ?? 'typesafe',
        disabled: !writable,
        onChange: (event: React.ChangeEvent<HTMLSelectElement>) => {
          void scope.set(SETTINGS_FIELDS.jevProvider, event.currentTarget.value)
        },
      }, JEV_PROVIDERS.map((provider) => createElement('option', { key: provider, value: provider }, provider)))),
      createElement(Row, {
        label: t('settings.jevModel.label'),
        description: t('settings.jevModel.desc'),
      }, createElement('input', {
        type: 'text',
        value: jevModel ?? '',
        placeholder: 'jev-latest',
        disabled: !writable,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
          void scope.set(SETTINGS_FIELDS.jevModel, event.currentTarget.value)
        },
      })),
      createElement(Row, {
        label: t('settings.jevEnvFile.label'),
        description: t('settings.jevEnvFile.desc'),
      }, createElement('input', {
        type: 'text',
        value: jevEnvFile ?? '',
        placeholder: '~/.dsh/data/dsh-plugin-chrome/jev-credentials.env',
        disabled: !writable,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
          void scope.set(SETTINGS_FIELDS.jevEnvFile, event.currentTarget.value)
        },
      })),
    ),
    createElement(
      'div',
      { className: 'dsh-chrome-settings__card' },
      createElement(Row, {
        label: t('settings.headless.label'),
        description: t('settings.headless.desc'),
      }, createElement('input', {
        type: 'checkbox',
        checked: headless === true,
        disabled: !writable,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
          void scope.set(SETTINGS_FIELDS.headless, event.currentTarget.checked)
        },
      })),
      createElement(Row, {
        label: t('settings.idleTimeoutMs.label'),
        description: t('settings.idleTimeoutMs.desc'),
      }, createElement('input', {
        type: 'number',
        min: 0,
        value: idleTimeoutMs ?? 600000,
        disabled: !writable,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
          void scope.set(SETTINGS_FIELDS.idleTimeoutMs, Number(event.currentTarget.value))
        },
      })),
      createElement(Row, {
        label: t('settings.maxSnapshotText.label'),
        description: t('settings.maxSnapshotText.desc'),
      }, createElement('input', {
        type: 'number',
        min: 1000,
        value: maxSnapshotText ?? 60000,
        disabled: !writable,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
          void scope.set(SETTINGS_FIELDS.maxSnapshotText, Number(event.currentTarget.value))
        },
      })),
      createElement(Row, {
        label: t('settings.maxTabs.label'),
        description: t('settings.maxTabs.desc'),
      }, createElement('input', {
        type: 'number',
        min: 1,
        value: maxTabs ?? 16,
        disabled: !writable,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
          void scope.set(SETTINGS_FIELDS.maxTabs, Number(event.currentTarget.value))
        },
      })),
      createElement(Row, {
        label: t('settings.confirmFirstLaunch.label'),
        description: t('settings.confirmFirstLaunch.desc'),
      }, createElement('input', {
        type: 'checkbox',
        checked: confirmFirstLaunch !== false,
        disabled: !writable,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
          void scope.set(SETTINGS_FIELDS.confirmFirstLaunch, event.currentTarget.checked)
        },
      })),
    ),
    createElement('p', { className: 'dsh-chrome-settings__hint' }, t('settings.hint')),
  )
}
