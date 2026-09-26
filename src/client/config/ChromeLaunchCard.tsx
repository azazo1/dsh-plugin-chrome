/**
 * The plugin's configuration card on the Plugins page.
 *
 * The bundle's page renders `plugins.bundle.config` for the package name, and
 * this card fills it with the two launch-config lists: the extension sources
 * and the extra Chrome flags. Values come from the controller's store hook and
 * writes go through its actions, so the component never subscribes to anything
 * itself.
 */
import type { ReactNode } from 'react'
import { Button, Input, SettingsForm, type SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChromeLaunchCardFace, ChromeLaunchField } from './chrome-launch-form.ts'

/** Full composed props of the card entry. */
export type ChromeLaunchCardProps = PropsRuntime<'plugins.bundle.config'>
  & PropsLocale<'plugin-chrome'>
  & InjectFace<ChromeLaunchCardFace>

/** One editable string list. */
function RowList(props: {
  t: ChromeLaunchCardProps['t']
  title: string
  hint: string
  placeholder: string
  rows: readonly string[]
  invalidRows: readonly boolean[]
  disabled: boolean
  onEdit: (index: number, value: string) => void
  onRemove: (index: number) => void
  onAdd: () => void
}): ReactNode {
  return (
    <section className="dsh-chrome-config__group">
      <h4 className="dsh-chrome-config__label">{props.title}</h4>
      <p className="dsh-chrome-config__hint">{props.hint}</p>
      <ul className="dsh-chrome-config__rows">
        {props.rows.map((row, index) => (
          <li className="dsh-chrome-config__row" key={index}>
            <Input
              value={row}
              placeholder={props.placeholder}
              disabled={props.disabled}
              aria-label={`${props.title} ${index + 1}`}
              aria-invalid={props.invalidRows[index] === true}
              onChange={(event) => { props.onEdit(index, event.target.value) }}
            />
            {props.invalidRows[index] === true
              ? <span className="dsh-chrome-config__invalid" role="status">{props.t('config.invalidRow')}</span>
              : null}
            <Button
              variant="ghost"
              size="sm"
              disabled={props.disabled}
              onClick={() => { props.onRemove(index) }}
            >
              {props.t('config.remove')}
            </Button>
          </li>
        ))}
      </ul>
      <Button variant="outline" size="sm" disabled={props.disabled} onClick={props.onAdd}>
        {props.t('config.add')}
      </Button>
    </section>
  )
}

/**
 * Render the launch-configuration card.
 * @param props - composed slot props: owner view, locale seat, and the controller's face.
 * @returns the card body, or null for the summary view this slot never uses.
 */
export function ChromeLaunchCard(props: ChromeLaunchCardProps): ReactNode {
  if (props.view !== 'page') return null
  const t = props.t
  const state = props.useChromeLaunch(snapshot => snapshot)
  const labels: SettingsFormLabels = {
    unavailable: t('config.unavailable'),
    readOnly: t('config.readOnly'),
    saveFailed: t('config.saveFailed'),
    save: t('config.save'),
    saving: t('config.saving'),
  }
  const lists: { field: ChromeLaunchField; title: string; hint: string; placeholder: string }[] = [
    {
      field: 'extensions',
      title: t('config.extensions'),
      hint: t('config.extensionsHint'),
      placeholder: t('config.extensionsPlaceholder'),
    },
    {
      field: 'extraArgs',
      title: t('config.extraArgs'),
      hint: t('config.extraArgsHint'),
      placeholder: t('config.extraArgsPlaceholder'),
    },
  ]
  return (
    <SettingsForm labels={labels} state={state} onSave={props.save} onDiscard={props.discard}>
      {lists.map(list => (
        <RowList
          key={list.field}
          t={t}
          title={list.title}
          hint={list.hint}
          placeholder={list.placeholder}
          rows={list.field === 'extensions' ? state.extensions : state.extraArgs}
          invalidRows={list.field === 'extensions' ? state.extensionsInvalid : state.extraArgsInvalid}
          disabled={!state.writable}
          onEdit={(index, value) => { props.editRow(list.field, index, value) }}
          onRemove={(index) => { props.removeRow(list.field, index) }}
          onAdd={() => { props.addRow(list.field) }}
        />
      ))}
      <p className="dsh-chrome-config__note">{t('config.appliesNextLaunch')}</p>
    </SettingsForm>
  )
}
