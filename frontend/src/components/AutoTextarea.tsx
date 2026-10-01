import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react'

// Textarea that grows to fit its content, so long entries (e.g. a review's
// lesson) are fully visible without dragging the resize handle. Still
// manually resizable; the min-height from CSS stays the floor.
export default function AutoTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    // scrollHeight excludes borders; add them back for border-box sizing.
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`
  }, [props.value])
  return <textarea ref={ref} {...props} />
}
