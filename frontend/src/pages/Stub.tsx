// Placeholder pages for routes that arrive later in Phase 1.
// Kept honest: they say what's coming instead of pretending to work.

export function makeStub(title: string, blurb: string) {
  return function Stub() {
    return (
      <div>
        <div className="greet">
          <h1>{title}</h1>
          <div className="sub">{blurb}</div>
        </div>
        <div className="stack">
          <div className="card empty">This screen is next on the Phase 1 build list.</div>
        </div>
      </div>
    )
  }
}

export const Reviews = makeStub('Reviews', 'Daily, weekly, monthly, yearly — pre-filled, you reflect.')
