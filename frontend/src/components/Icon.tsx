// Small hand-authored stroke-icon set — replaces emoji in UI chrome (nav,
// buttons, chip glyphs) so those read as one consistent, themeable system
// (currentColor) instead of mismatched platform emoji glyphs. Content that's
// genuinely expressive (mood faces, the AI sparkle) stays emoji on purpose.
export type IconName =
  | 'today' | 'plan' | 'board' | 'goals' | 'reviews' | 'sketches' | 'stats'
  | 'settings' | 'search' | 'close' | 'trash' | 'folder' | 'pencil'
  | 'chevronLeft' | 'plus' | 'check' | 'sparkle'

const PATHS: Record<IconName, React.ReactNode> = {
  today: (
    <>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2.4M12 19.1v2.4M4.6 4.6l1.7 1.7M17.7 17.7l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.6 19.4l1.7-1.7M17.7 6.3l1.7-1.7" />
    </>
  ),
  plan: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path d="M3.5 9.8h17M8 3v3.4M16 3v3.4" />
      <path d="M8 14l1.6 1.6L12.5 12.5" />
    </>
  ),
  board: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
      <path d="M9.2 4.5v15M14.8 4.5v15" />
    </>
  ),
  goals: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <circle cx="12" cy="12" r="4.6" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  reviews: (
    <>
      <path d="M6 3.8h9.2L19 7.6V19a1.3 1.3 0 0 1-1.3 1.3H6A1.3 1.3 0 0 1 4.7 19V5.1A1.3 1.3 0 0 1 6 3.8Z" />
      <path d="M8.4 10.4h7.2M8.4 13.6h7.2M8.4 16.8h4.4" />
    </>
  ),
  sketches: (
    <>
      <path d="M12 3.6c4.7 0 8.4 3.2 8.4 7.1 0 2.6-2.1 4.3-4.5 4.3h-1.6c-.9 0-1.5.9-1 1.7.5.9-.1 1.9-1.1 1.9C7.6 18.6 3.6 15.3 3.6 11c0-4.1 3.9-7.4 8.4-7.4Z" />
      <circle cx="7.9" cy="10.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="11.2" cy="7.6" r="1" fill="currentColor" stroke="none" />
      <circle cx="15.4" cy="8.6" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  stats: (
    <>
      <path d="M4.5 20V10.4M11 20V4M17.5 20v-7.2" strokeLinecap="round" />
      <path d="M3.2 20h17.6" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.6v2.1M12 18.3v2.1M20.4 12h-2.1M5.7 12H3.6M17.7 6.3l-1.5 1.5M7.8 16.2l-1.5 1.5M17.7 17.7l-1.5-1.5M7.8 7.8 6.3 6.3" />
    </>
  ),
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="M19.5 19.5 15.4 15.4" strokeLinecap="round" />
    </>
  ),
  close: <path d="M5.5 5.5l13 13M18.5 5.5l-13 13" strokeLinecap="round" />,
  trash: (
    <>
      <path d="M4.5 7h15M9.5 7V4.9c0-.5.4-.9.9-.9h3.2c.5 0 .9.4.9.9V7" />
      <path d="M6.3 7l.7 12a1.5 1.5 0 0 0 1.5 1.4h6.8a1.5 1.5 0 0 0 1.5-1.4l.7-12" />
      <path d="M10.2 10.8v6M13.8 10.8v6" />
    </>
  ),
  folder: (
    <path d="M3.5 6.3A1.3 1.3 0 0 1 4.8 5h4.4l1.7 2h8.3a1.3 1.3 0 0 1 1.3 1.3v9.4A1.3 1.3 0 0 1 19.2 19H4.8a1.3 1.3 0 0 1-1.3-1.3Z" />
  ),
  pencil: (
    <>
      <path d="M15.6 4.4 19.6 8.4 8.4 19.6 4 20l.4-4.4Z" />
      <path d="M13.6 6.4l4 4" />
    </>
  ),
  chevronLeft: <path d="M14.8 5 8 12l6.8 7" strokeLinecap="round" strokeLinejoin="round" />,
  plus: <path d="M12 4.5v15M4.5 12h15" strokeLinecap="round" />,
  check: <path d="M4.5 12.5l4.8 4.8L19.5 6.5" strokeLinecap="round" strokeLinejoin="round" />,
  sparkle: (
    <path d="M12 3.5l1.4 4.4 4.4 1.4-4.4 1.4-1.4 4.4-1.4-4.4-4.4-1.4 4.4-1.4Z" strokeLinejoin="round" />
  ),
}

export default function Icon({
  name,
  size = 20,
  strokeWidth = 1.8,
  className,
}: {
  name: IconName
  size?: number
  strokeWidth?: number
  className?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  )
}
