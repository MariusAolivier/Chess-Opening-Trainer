interface IconProps {
  className?: string
}

export function StreakIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M13.2 2.5c.35 3.3-1.45 4.9-2.9 6.25-1.1 1.02-1.95 1.82-1.95 3.25 0 1.08.65 2.03 1.58 2.52-.08-.32-.12-.65-.12-.98 0-1.65 1.03-3.08 2.6-3.75.15 1.8 1.8 2.8 1.8 4.85 0 .5-.1.98-.28 1.43 1.02-.65 1.67-1.78 1.67-3.03 0-.74-.2-1.47-.57-2.1 2.18 1.62 3.47 4.12 3.47 6.78 0 3.45-2.8 6.25-6.25 6.25S6 21.17 6 17.72c0-2.52 1.26-4.77 3.4-6.07-.07-.36-.1-.73-.1-1.1 0-2.3 1.4-4.16 3.9-8.05Z"
        fill="currentColor"
      />
    </svg>
  )
}

export function SettingsIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"
        fill="currentColor"
      />
      <path
        d="m19.4 13.1 1.1.86-1.7 2.94-1.3-.5a7.2 7.2 0 0 1-1.4.82l-.2 1.38h-3.4l-.2-1.38a7.2 7.2 0 0 1-1.4-.82l-1.3.5-1.7-2.94 1.1-.86a7 7 0 0 1 0-1.64l-1.1-.86 1.7-2.94 1.3.5a7.2 7.2 0 0 1 1.4-.82l.2-1.38h3.4l.2 1.38c.5.22.97.5 1.4.82l1.3-.5 1.7 2.94-1.1.86a7 7 0 0 1 0 1.64Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function KnightIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 21h12M8 18h8l-1-3.3c2.1-1.35 3.2-3.48 2.65-6.2-.3-1.5-1.25-2.8-2.65-3.5l-1.1 2.1-2.6-1.6-2.1 1.1 1.3 2.1c-1.2.7-1.9 1.85-1.9 3.2 0 1.05.38 1.95 1.05 2.65L8 18Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  )
}
