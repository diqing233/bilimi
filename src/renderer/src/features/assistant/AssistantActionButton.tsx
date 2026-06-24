import type { ButtonHTMLAttributes } from 'react'

type AssistantActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: string
  iconAlt: string
  badge: string
  label: string
  description: string
}

export function AssistantActionButton({
  icon,
  iconAlt,
  badge,
  label,
  description,
  className,
  children,
  ...buttonProps
}: AssistantActionButtonProps): React.JSX.Element {
  const classes = ['assistant-action-button', className].filter(Boolean).join(' ')

  return (
    <button {...buttonProps} className={classes}>
      <span className="assistant-action-button__icon">
        <img className="assistant-action-button__pet" src={icon} alt={iconAlt} />
        <strong>{badge}</strong>
      </span>
      <span className="assistant-action-button__label">{label}</span>
      <small className="assistant-action-button__description">{description}</small>
      {children}
    </button>
  )
}
