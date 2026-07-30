import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react'

type PostPaintCheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'checked' | 'onChange' | 'type'> & {
  checked: boolean
  onCommit: (checked: boolean) => void
}

/** Paints the native checked state before application-level work begins. */
export function PostPaintCheckbox({ checked, onCommit, ...inputProps }: PostPaintCheckboxProps) {
  const [localChecked, setLocalChecked] = useState(checked)
  const pendingFrame = useRef<number | null>(null)
  const pendingChecked = useRef(checked)

  useEffect(() => setLocalChecked(checked), [checked])
  useEffect(() => () => {
    if (pendingFrame.current !== null) cancelAnimationFrame(pendingFrame.current)
  }, [])

  return <input
    {...inputProps}
    type="checkbox"
    checked={localChecked}
    onChange={(event) => {
      const nextChecked = event.currentTarget.checked
      setLocalChecked(nextChecked)
      pendingChecked.current = nextChecked
      if (pendingFrame.current !== null) cancelAnimationFrame(pendingFrame.current)
      pendingFrame.current = requestAnimationFrame(() => {
        pendingFrame.current = null
        onCommit(pendingChecked.current)
      })
    }}
  />
}
