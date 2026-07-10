import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, fireEvent, act } from '@testing-library/react'
import { useCarouselRail } from './useCarouselRail'

/**
 * Drag harness: a scrollable rail wired to the hook (no infinite loop), with
 * one child button whose click is spied on. Mirrors how PostDetailView wires
 * the recommendations rail.
 */
function Rail({ onCardClick }: { onCardClick?: () => void }) {
  const railRef = useCarouselRail<HTMLDivElement>()
  return (
    <div data-testid="rail" ref={railRef} style={{ overflowX: 'auto' }}>
      <button type="button" data-testid="card" onClick={() => onCardClick?.()}>
        card
      </button>
    </div>
  )
}

function mockScrollLeft(el: HTMLElement, initial = 0) {
  let scroll = initial
  Object.defineProperty(el, 'scrollLeft', {
    configurable: true,
    get: () => scroll,
    set: (v: number) => { scroll = v },
  })
}

function getRail(container: HTMLElement) {
  const rail = container.querySelector('[data-testid="rail"]') as HTMLDivElement
  mockScrollLeft(rail)
  return rail
}

describe('useCarouselRail — drag', () => {
  it('pans scrollLeft when a mouse drags past the threshold', () => {
    const { container } = render(<Rail />)
    const rail = getRail(container)
    rail.scrollLeft = 0

    fireEvent.pointerDown(rail, { pointerType: 'mouse', button: 0, clientX: 200, pointerId: 1 })
    fireEvent.pointerMove(rail, { pointerType: 'mouse', clientX: 140, pointerId: 1 }) // dragged left 60px
    // scrollLeft = startScrollLeft - dx = 0 - (-60) = 60
    expect(rail.scrollLeft).toBe(60)

    fireEvent.pointerUp(rail, { pointerType: 'mouse', clientX: 140, pointerId: 1 })
  })

  it('suppresses the child card click after a real drag', () => {
    const onCardClick = vi.fn()
    const { container } = render(<Rail onCardClick={onCardClick} />)
    const rail = getRail(container)
    const card = container.querySelector('[data-testid="card"]') as HTMLButtonElement

    fireEvent.pointerDown(rail, { pointerType: 'mouse', button: 0, clientX: 200, pointerId: 1 })
    fireEvent.pointerMove(rail, { pointerType: 'mouse', clientX: 120, pointerId: 1 }) // 80px drag
    fireEvent.pointerUp(rail, { pointerType: 'mouse', clientX: 120, pointerId: 1 })
    fireEvent.click(card)

    expect(onCardClick).not.toHaveBeenCalled()
  })

  it('lets a plain click (no drag) through to the card', () => {
    const onCardClick = vi.fn()
    const { container } = render(<Rail onCardClick={onCardClick} />)
    const rail = getRail(container)
    const card = container.querySelector('[data-testid="card"]') as HTMLButtonElement

    fireEvent.pointerDown(rail, { pointerType: 'mouse', button: 0, clientX: 200, pointerId: 1 })
    fireEvent.pointerUp(rail, { pointerType: 'mouse', clientX: 200, pointerId: 1 })
    fireEvent.click(card)

    expect(onCardClick).toHaveBeenCalledTimes(1)
  })

  it('treats a sub-threshold jitter as a click, not a drag', () => {
    const onCardClick = vi.fn()
    const { container } = render(<Rail onCardClick={onCardClick} />)
    const rail = getRail(container)
    const card = container.querySelector('[data-testid="card"]') as HTMLButtonElement
    rail.scrollLeft = 0

    fireEvent.pointerDown(rail, { pointerType: 'mouse', button: 0, clientX: 200, pointerId: 1 })
    fireEvent.pointerMove(rail, { pointerType: 'mouse', clientX: 197, pointerId: 1 }) // 3px < 6px threshold
    fireEvent.pointerUp(rail, { pointerType: 'mouse', clientX: 197, pointerId: 1 })
    fireEvent.click(card)

    expect(rail.scrollLeft).toBe(0) // never moved
    expect(onCardClick).toHaveBeenCalledTimes(1)
  })

  it('ignores touch pointers so native scroll keeps ownership', () => {
    const { container } = render(<Rail />)
    const rail = getRail(container)
    rail.scrollLeft = 0

    fireEvent.pointerDown(rail, { pointerType: 'touch', clientX: 200, pointerId: 2 })
    fireEvent.pointerMove(rail, { pointerType: 'touch', clientX: 100, pointerId: 2 })

    expect(rail.scrollLeft).toBe(0) // hook never touched it
  })

  it('ignores non-primary mouse buttons', () => {
    const { container } = render(<Rail />)
    const rail = getRail(container)
    rail.scrollLeft = 0

    fireEvent.pointerDown(rail, { pointerType: 'mouse', button: 2, clientX: 200, pointerId: 1 }) // right-click
    fireEvent.pointerMove(rail, { pointerType: 'mouse', clientX: 100, pointerId: 1 })

    expect(rail.scrollLeft).toBe(0)
  })

  it('prevents native drag-and-drop starting from a card (the killed-gesture bug)', () => {
    // A native DnD on a card fires pointercancel and aborts the grab-scroll.
    // The rail unconditionally cancels dragstart so DnD never begins.
    const { container } = render(<Rail />)
    const card = container.querySelector('[data-testid="card"]') as HTMLButtonElement
    const ev = new Event('dragstart', { bubbles: true, cancelable: true })
    card.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
  })
})

/**
 * Infinite-loop harness. Mirrors PostDetailView exactly: items arrive async
 * (rerender from [] to a list), and the copy count follows the mirrored
 * `loop` state one render behind the hook — the lag behind the loop
 * flip-flop regression covered below.
 */
function LoopRail({ items }: { items: number[] }) {
  const [loop, setLoop] = useState(false)
  const railRef = useCarouselRail<HTMLDivElement>({ infinite: true, itemCount: items.length, onLoopChange: setLoop })
  const cards = loop ? [...items, ...items, ...items] : items
  return (
    <div data-testid="rail" ref={railRef} style={{ overflowX: 'auto' }}>
      {cards.map((n, i) => (
        <span key={`${n}-${i}`} data-testid="card">{n}</span>
      ))}
    </div>
  )
}

describe('useCarouselRail — infinite loop', () => {
  // jsdom does no layout, so geometry is mocked — crucially, scrollWidth
  // FOLLOWS the rendered DOM (children × card width) instead of being a
  // constant. The flip-flop regression (loop state and DOM copy count one
  // render out of phase → measurement flip-flops forever, re-parking
  // scrollLeft and clobbering every drag) only reproduces when the mock
  // tracks the DOM like a real browser does.
  async function setupLooping(cardWidth = 250) {
    const { container, rerender } = render(<LoopRail items={[]} />)
    const rail = container.querySelector('[data-testid="rail"]') as HTMLDivElement
    mockScrollLeft(rail)
    Object.defineProperty(rail, 'scrollWidth', { configurable: true, get: () => rail.children.length * cardWidth })
    Object.defineProperty(rail, 'clientWidth', { configurable: true, get: () => 300 })
    // Items arrive (like the async recommendations fetch). One copy = 750px
    // in a 300px viewport → loop should engage and stay engaged.
    rerender(<LoopRail items={[0, 1, 2]} />)
    // Flush the mirror render + MutationObserver parking.
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    return { container, rail, rerender }
  }

  it('enables looping (triples the cards) and parks in the middle copy — stable, no flip-flop', async () => {
    const { container, rail } = await setupLooping()
    // 3 base cards × 3 copies = 9 rendered.
    expect(container.querySelectorAll('[data-testid="card"]').length).toBe(9)
    // Parked inside the middle copy (one copy = 3 × 250 = 750).
    expect(rail.scrollLeft).toBe(750)
    // Regression: a second flush must not flip the loop off and back on
    // (DOM-lag measurement) — count and scroll stay put.
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    expect(container.querySelectorAll('[data-testid="card"]').length).toBe(9)
    expect(rail.scrollLeft).toBe(750)
  })

  it('a mouse drag on the looping rail moves it and is not clobbered afterwards', async () => {
    const { rail } = await setupLooping()
    fireEvent.pointerDown(rail, { pointerType: 'mouse', button: 0, clientX: 400, pointerId: 1 })
    fireEvent.pointerMove(rail, { pointerType: 'mouse', clientX: 300, pointerId: 1 }) // drag left 100px
    fireEvent.pointerUp(rail, { pointerType: 'mouse', clientX: 300, pointerId: 1 })
    expect(rail.scrollLeft).toBe(850) // 750 + 100
    // The flip-flop bug wiped every drag back to the park position moments later.
    await act(async () => { await new Promise(r => setTimeout(r, 30)) })
    expect(rail.scrollLeft).toBe(850)
  })

  it('wraps back by one copy when scrolled past the end', async () => {
    const { rail } = await setupLooping()
    rail.scrollLeft = 1200 // past 1.5 × 750 = 1125
    fireEvent.scroll(rail)
    expect(rail.scrollLeft).toBe(450) // 1200 - 750
  })

  it('wraps forward by one copy when scrolled before the start', async () => {
    const { rail } = await setupLooping()
    rail.scrollLeft = 300 // below 0.5 × 750 = 375
    fireEvent.scroll(rail)
    expect(rail.scrollLeft).toBe(1050) // 300 + 750
  })

  it('does not enable looping when a single copy fits the viewport', async () => {
    // 80px cards → one copy = 240px < 300px viewport + slack.
    const { container } = await setupLooping(80)
    expect(container.querySelectorAll('[data-testid="card"]').length).toBe(3)
  })
})
