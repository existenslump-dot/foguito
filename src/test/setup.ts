import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeAll } from 'vitest'

/**
 * Global test setup.
 *
 * - Registers @testing-library/jest-dom matchers (toBeInTheDocument, etc.)
 * - Auto-cleanup DOM between React tests to prevent cross-test leakage.
 * - Stubs a few browser APIs that jsdom doesn't implement but some of our
 *   components touch during mount (matchMedia, IntersectionObserver).
 */

afterEach(() => {
  cleanup()
})

beforeAll(() => {
  // jsdom doesn't implement matchMedia; several of our style hooks check
  // prefers-reduced-motion via it. Default to false (no preference).
  if (typeof window !== 'undefined' && !window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    })
  }

  // jsdom lacks IntersectionObserver — lazy-load components bail silently
  // when it's missing, but the stub keeps them quiet in test output.
  if (typeof window !== 'undefined' && !('IntersectionObserver' in window)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() { return [] }
    }
  }
})
