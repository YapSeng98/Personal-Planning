/** The slowly turning colour edge on Today's header and the command bar: a
    conic gradient turned with a transform inside a ring-shaped mask, so the
    turning runs on the graphics chip. (Turning the gradient's angle — an
    animated CSS custom property — restyled and repainted the whole card 60
    times a second, even with the app sitting idle.) */
export default function GlowEdge({ className = '' }: { className?: string }) {
  return <span className={`glow-edge ${className}`} aria-hidden><span /></span>
}
