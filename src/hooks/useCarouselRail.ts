'use client'

/**
 * Horizontal carousel rail: mouse grab-to-scroll + optional infinite loop.
 *
 * Two problems this solves for an `overflow-x` rail of cards:
 *
 * 1. Grab-to-scroll — a plain desktop mouse can't pan a native scroll
 *    container (only a trackpad / shift+wheel can). We wire pointer listeners
 *    so a mouse (or pen) drags it like a touch swipe, and swallow the click
 *    that would otherwise fire on a child link when the drag ends. Touch is
 *    left to the browser's native momentum scroll.
 *
 * 2. Infinite loop (opt-in via `infinite`) — the rail wraps: scroll off the
 *    end and the start comes back around, forever. The component must render
 *    THREE identical copies of the items when `onLoopChange` reports true;
 *    the hook keeps the scroll inside the middle copy by shifting it one copy
 *    width whenever it drifts toward an edge — content is identical across
 *    the jump, so the seam is never seen. Looping only turns on when a single
 *    copy actually overflows the viewport.
 *
 * ⚠️ Sizing invariant: the DOM's copy count lags the hook's `loop` state by
 * one render — the component mirrors `loop` into its own state via
 * `onLoopChange` and re-renders the copies on the NEXT commit. Every
 * measurement here must therefore derive the copy count from the DOM itself
 * (`children.length / itemCount`), NEVER from `loop`. Dividing scrollWidth by
 * the `loop`-implied count makes the measurement flip-flop forever (loop on →
 * sees 1 copy ÷ 3 → too small → loop off → sees 3 copies ÷ 1 → too big → on →
 * …), and each cycle re-parks scrollLeft, clobbering any user drag within
 * milliseconds — the rail feels completely frozen to the mouse.
 *
 * Usage:
 *   const [loop, setLoop] = useState(false)
 *   const railRef = useCarouselRail<HTMLDivElement>({ infinite: true, itemCount: items.length, onLoopChange: setLoop })
 *   const cards = loop ? [...items, ...items, ...items] : items
 *   <div ref={railRef} className="rail">
 *     {cards.map((it, i) => <Card key={`${it.id}-${i}`} … />)}
 *   </div>
 */
import { useCallback, useEffect, useState } from 'react'

const DRAG_THRESHOLD_PX = 6 // press must travel past this before it counts as a drag
const OVERFLOW_SLACK_PX = 24 // one copy must beat the viewport by this much to loop

type Options = {
  infinite?: boolean
  itemCount?: number
  /** Called when the hook toggles looping — mirror it into component state to
   *  render one copy (false) or three (true). */
  onLoopChange?: (loop: boolean) => void
}

/** Copies of the item list currently in the DOM (1 normally, 3 when the
 *  loop's triplicated render has committed). */
function copiesInDom(node: HTMLElement, itemCount: number): number {
  if (itemCount <= 0) return 1
  return Math.max(1, Math.round(node.children.length / itemCount))
}

export function useCarouselRail<T extends HTMLElement>(options: Options = {}) {
  const { infinite = false, itemCount = 0, onLoopChange } = options
  const [node, setNode] = useState<T | null>(null)
  const [loop, setLoop] = useState(false)

  // Mirror the loop decision out to the component so it can render the right
  // number of copies.
  useEffect(() => { onLoopChange?.(loop) }, [loop, onLoopChange])

  // Decide whether looping is warranted: does ONE copy overflow the viewport?
  // Copy count comes from the DOM (see invariant above), so the answer is the
  // same no matter which commit of the loop↔mirror handshake we run in.
  useEffect(() => {
    if (!infinite || !node) {
      if (loop) setLoop(false)
      return
    }
    const oneCopy = node.scrollWidth / copiesInDom(node, itemCount)
    const shouldLoop = oneCopy > node.clientWidth + OVERFLOW_SLACK_PX
    if (shouldLoop !== loop) setLoop(shouldLoop)
  }, [infinite, node, itemCount, loop])

  // Drag + wrap wiring.
  useEffect(() => {
    if (!node) return

    const state = { active: false, dragged: false, startX: 0, startScrollLeft: 0, pointerId: -1 }

    // Keep the scroll inside the middle copy so there's always a copy to
    // reveal on either side. Shift by exactly one copy width (content is
    // identical across the jump → invisible seam) and move the drag's
    // reference point with it so an in-flight drag doesn't lurch. Only acts
    // when the triplicated render is actually in the DOM — during the
    // one-render mirror lag it's a no-op instead of parking on bad math.
    const normalize = () => {
      if (!loop) return
      if (copiesInDom(node, itemCount) !== 3) return
      const c = node.scrollWidth / 3
      if (c <= 0) return
      if (node.scrollLeft < c * 0.5) {
        node.scrollLeft += c
        state.startScrollLeft += c
      } else if (node.scrollLeft >= c * 1.5) {
        node.scrollLeft -= c
        state.startScrollLeft -= c
      }
    }

    // Park into the middle copy as soon as the triplicated render commits.
    // The 3-copy commit itself doesn't re-run this effect (the mirror state
    // lives in the component), so watch the child list instead.
    normalize()
    const mo = new MutationObserver(normalize)
    mo.observe(node, { childList: true })

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return // native scroll owns touch
      if (e.button !== 0) return // primary button only
      state.active = true
      state.dragged = false
      state.startX = e.clientX
      state.startScrollLeft = node.scrollLeft
      state.pointerId = e.pointerId
    }

    const onPointerMove = (e: PointerEvent) => {
      if (!state.active) return
      const dx = e.clientX - state.startX
      if (!state.dragged && Math.abs(dx) > DRAG_THRESHOLD_PX) {
        state.dragged = true
        try { node.setPointerCapture(state.pointerId) } catch { /* unsupported */ }
      }
      if (state.dragged) {
        node.scrollLeft = state.startScrollLeft - dx
        normalize()
        e.preventDefault()
      }
    }

    const endDrag = () => {
      if (!state.active) return
      if (state.pointerId !== -1) {
        try { node.releasePointerCapture(state.pointerId) } catch { /* unsupported */ }
      }
      state.active = false
      state.pointerId = -1
    }

    // Native scroll (wheel / trackpad / touch momentum) — wrap once it settles
    // near an edge. Skipped mid-drag; the drag path normalizes itself.
    const onScroll = () => { if (!state.active) normalize() }

    // Capture phase: swallow the click that follows a drag so a child link
    // doesn't navigate.
    const onClickCapture = (e: MouseEvent) => {
      if (state.dragged) {
        e.preventDefault()
        e.stopPropagation()
        state.dragged = false
      }
    }

    // Kill the browser's native image/link drag ghost. Unconditional backstop
    // (Chrome fires pointercancel before dragstart, so an `active`-gated guard
    // would miss); the real prevention is draggable={false} on the cards.
    const onDragStart = (e: DragEvent) => e.preventDefault()

    node.addEventListener('pointerdown', onPointerDown)
    node.addEventListener('pointermove', onPointerMove)
    node.addEventListener('pointerup', endDrag)
    node.addEventListener('pointercancel', endDrag)
    node.addEventListener('scroll', onScroll, { passive: true })
    node.addEventListener('click', onClickCapture, true) // capture
    node.addEventListener('dragstart', onDragStart)

    return () => {
      mo.disconnect()
      node.removeEventListener('pointerdown', onPointerDown)
      node.removeEventListener('pointermove', onPointerMove)
      node.removeEventListener('pointerup', endDrag)
      node.removeEventListener('pointercancel', endDrag)
      node.removeEventListener('scroll', onScroll)
      node.removeEventListener('click', onClickCapture, true)
      node.removeEventListener('dragstart', onDragStart)
    }
  }, [node, loop, itemCount])

  // Stable callback ref so the effects only re-run when the node identity
  // actually changes, not on every render.
  return useCallback((next: T | null) => setNode(next), [])
}
