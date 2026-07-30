import type { ComponentProps } from 'react'
import { PostPaintCheckbox } from '../../components/PostPaintCheckbox'

type SettingsPreferenceCheckboxProps = ComponentProps<typeof PostPaintCheckbox>

export function SettingsPreferenceCheckbox({ checked, onCommit, ...inputProps }: SettingsPreferenceCheckboxProps) {
  return <PostPaintCheckbox {...inputProps} checked={checked} onCommit={onCommit} />
}
