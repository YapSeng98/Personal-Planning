// Small hand-authored stroke-icon set — replaces emoji in UI chrome (nav,
// buttons, chip glyphs) so those read as one consistent, themeable system
// (currentColor) instead of mismatched platform emoji glyphs. Content that's
// genuinely expressive (mood faces, the AI sparkle) stays emoji on purpose.
export type IconName =
  | 'today' | 'plan' | 'board' | 'goals' | 'reviews' | 'sketches' | 'stats'
  | 'settings' | 'search' | 'close' | 'trash' | 'folder' | 'pencil'
  | 'chevronLeft' | 'chevronRight' | 'plus' | 'check' | 'sparkle' | 'image' | 'move' | 'pin'
  | 'play' | 'pause' | 'stop' | 'timer' | 'down' | 'external' | 'minimise' | 'expand' | 'shrink' | 'reload' | 'copy'
  | 'star' | 'repeat' | 'note' | 'bell' | 'flame' | 'moon' | 'sun' | 'cloudSun' | 'clipboard' | 'paperclip' | 'list' | 'eraser' | 'undo' | 'redo'

const PATHS: Record<IconName, React.ReactNode> = {
  // task / day markers (2026-11-28: they replace the ⭐ 🔁 📝 ⏱ 🔔 🌙 🔥 📋 📎 emoji in the chrome)
  // closed shapes, so a "lit" state can fill them (fill="currentColor" on the svg's class)
  star: <path d="M12 3.6l2.55 5.2 5.7.83-4.12 4.03.97 5.68L12 16.66l-5.1 2.68.97-5.68L3.75 9.63l5.7-.83z" />,
  repeat: (
    <>
      <path d="M16.5 3.5l3 3-3 3" />
      <path d="M4.5 11.5v-1a4 4 0 0 1 4-4h11" />
      <path d="M7.5 20.5l-3-3 3-3" />
      <path d="M19.5 12.5v1a4 4 0 0 1-4 4h-11" />
    </>
  ),
  note: (
    <>
      <path d="M14 3.5H7.3a1.8 1.8 0 0 0-1.8 1.8v13.4a1.8 1.8 0 0 0 1.8 1.8h9.4a1.8 1.8 0 0 0 1.8-1.8V8z" />
      <path d="M14 3.5V8h4.5M9 12.5h6M9 16h4" />
    </>
  ),
  bell: (
    <>
      <path d="M6.2 16.5v-5.3a5.8 5.8 0 0 1 11.6 0v5.3l1.7 1.9h-15z" />
      <path d="M10 21a2.1 2.1 0 0 0 4 0" />
    </>
  ),
  flame: (
    <>
      <path d="M12 21.2c-3.7 0-6.6-2.7-6.6-6.3 0-2.7 1.6-4.5 3.1-6 .3 1.6 1.1 2.7 2.2 3.2-.3-3.4 1-6.5 4.1-9.3.4 3.1 1.7 4.8 2.9 6.4 1 1.4 1.8 3 1.8 5.1 0 3.8-3.2 6.9-7.5 6.9z" />
      <path d="M12 21.2c-1.6 0-2.8-1.2-2.8-2.8 0-1.5 1.1-2.5 2.8-4.2 1.7 1.7 2.8 2.7 2.8 4.2 0 1.6-1.2 2.8-2.8 2.8z" />
    </>
  ),
  moon: <path d="M19.6 14.6A7.8 7.8 0 0 1 9.4 4.4a7.8 7.8 0 1 0 10.2 10.2z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.8v2M12 19.2v2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M2.8 12h2M19.2 12h2M5.5 18.5l1.4-1.4M17.1 6.9l1.4-1.4" />
    </>
  ),
  cloudSun: (
    <>
      <path d="M9 2.8v1.6M3.6 5l1.1 1.1M2 10.4h1.6M14.4 5l-1.1 1.1" />
      <path d="M5.9 12.6a3.4 3.4 0 0 1 6.3-3.4" />
      <path d="M8.2 20.5h9.3a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.5 1.4 2.8 2.8 0 0 0-.2 5.6z" />
    </>
  ),
  clipboard: (
    <>
      <path d="M9 4.6H7.3a1.8 1.8 0 0 0-1.8 1.8v12.8a1.8 1.8 0 0 0 1.8 1.8h9.4a1.8 1.8 0 0 0 1.8-1.8V6.4a1.8 1.8 0 0 0-1.8-1.8H15" />
      <rect x="9" y="3" width="6" height="3.3" rx="1" />
      <path d="M9 11.5h6M9 15h4" />
    </>
  ),
  paperclip: <path d="M19.5 11.6l-7.6 7.6a4.9 4.9 0 0 1-6.9-6.9l8-8a3.3 3.3 0 0 1 4.6 4.6l-8 8a1.6 1.6 0 0 1-2.3-2.3l7.3-7.3" />,
  list: (
    <>
      <path d="M9.5 6.5h10M9.5 12h10M9.5 17.5h10" />
      <path d="M4.9 6.5h.2M4.9 12h.2M4.9 17.5h.2" strokeWidth="2.6" />
    </>
  ),
  undo: (
    <>
      <path d="M9.5 5.5L5 10l4.5 4.5" />
      <path d="M5 10h9a5 5 0 0 1 0 10h-3" />
    </>
  ),
  redo: (
    <>
      <path d="M14.5 5.5L19 10l-4.5 4.5" />
      <path d="M19 10h-9a5 5 0 0 0 0 10h3" />
    </>
  ),
  eraser: (
    <>
      <path d="M9 20.5h10.5" />
      <path d="M9 20.5l-4.3-4.3a1.8 1.8 0 0 1 0-2.5l8.8-8.8a1.8 1.8 0 0 1 2.5 0l3.6 3.6a1.8 1.8 0 0 1 0 2.5L11.4 18.2" />
      <path d="M8.6 9.6l6.8 6.8" />
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2.2" />
      <path d="M15.5 8.5V6.3a1.8 1.8 0 0 0-1.8-1.8H6.3a1.8 1.8 0 0 0-1.8 1.8v7.4a1.8 1.8 0 0 0 1.8 1.8h2.2" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <circle cx="9" cy="9.5" r="1.6" />
      <path d="M4 17.5l5-5 4 4 2.5-2.5 4.5 4.5" />
    </>
  ),
  move: <path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4" />,
  // window chrome (components/AppWindow.tsx)
  external: (
    <>
      <path d="M13.5 4.5h6v6M19.5 4.5l-8 8" />
      <path d="M17.5 13.5v4.2a1.8 1.8 0 0 1-1.8 1.8H6.3a1.8 1.8 0 0 1-1.8-1.8V8.3a1.8 1.8 0 0 1 1.8-1.8h4.2" />
    </>
  ),
  minimise: <path d="M6 17.5h12" />,
  expand: <path d="M14.5 4.5h5v5M9.5 19.5h-5v-5M19.5 4.5l-5.5 5.5M4.5 19.5l5.5-5.5" />,
  shrink: <path d="M14 5v5h5M10 19v-5H5M14 10l5.5-5.5M10 14l-5.5 5.5" />,
  reload: (
    <>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
      <path d="M19.8 4.5v4h-4" />
    </>
  ),
  play: <path d="M8 5.5v13l10.5-6.5z" />,
  pause: <path d="M9 6v12M15 6v12" />,
  // focus mode's minimise: the screen folds down into the bar
  down: <path d="M6 9.5l6 6 6-6" />,
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="2" />,
  timer: (
    <>
      <circle cx="12" cy="13.5" r="7.5" />
      <path d="M12 9.5v4l2.6 1.8M9.5 2.5h5M12 2.5V6" />
    </>
  ),
  // a push pin, tilted as if stuck in (the head is one closed shape, so a
  // pinned state can simply fill it)
  pin: (
    <g transform="rotate(35 12 12)">
      <path d="M9.4 3.2h5.2v5.1l2.5 3.2v1.6H6.9v-1.6l2.5-3.2z" />
      <path d="M12 13.1v7.7" />
    </g>
  ),
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
  chevronRight: <path d="M9.2 5 16 12l-6.8 7" strokeLinecap="round" strokeLinejoin="round" />,
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
