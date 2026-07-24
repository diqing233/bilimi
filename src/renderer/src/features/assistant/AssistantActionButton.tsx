import type { ButtonHTMLAttributes } from 'react'

type AssistantActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: string
  iconAlt?: string
  badge: string
  label: string
  description: string
  iconMark?: string
}

export function AssistantActionButton({
  icon,
  iconAlt,
  iconMark,
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
        {iconMark ? <span className="assistant-action-button__mark" data-testid="favorite-library-entry-mark" aria-hidden="true">{iconMark}</span> : <img className="assistant-action-button__pet" src={icon} alt={iconAlt} />}
        <strong>{badge}</strong>
      </span>
      <span className="assistant-action-button__label">{label}</span>
      <small className="assistant-action-button__description">{description}</small>
      {children}
    </button>
  )
}
