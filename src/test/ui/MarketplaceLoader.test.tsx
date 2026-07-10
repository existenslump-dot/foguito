import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import MarketplaceLoader from '@/components/MarketplaceLoader'

/**
 * Smoke + behavior tests for the shared loader component.
 *
 * Covers the three variants (inline / block / fullscreen), ensures the
 * status role + accessible label always render, and verifies the optional
 * text label shows when passed. Internals (12-dot orbital spinner) covered
 * separately — these tests focus on the variant wrapper behavior.
 */

describe('MarketplaceLoader', () => {
  it('renders a status role by default (inline variant)', () => {
    render(<MarketplaceLoader />)
    const status = screen.getByRole('status')
    expect(status).toBeInTheDocument()
    expect(status).toHaveAttribute('aria-label', 'Cargando')
  })

  it('renders with a custom label (block variant)', () => {
    render(<MarketplaceLoader variant="block" label="Guardando cambios" />)
    expect(screen.getByText('Guardando cambios')).toBeInTheDocument()
  })

  it('respects the ariaLabel override for screen readers', () => {
    render(<MarketplaceLoader ariaLabel="Subiendo archivos" />)
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-label', 'Subiendo archivos')
  })

  it('renders the fullscreen variant with fixed positioning', () => {
    render(<MarketplaceLoader variant="fullscreen" label="Procesando" />)
    const status = screen.getByRole('status')
    expect(status.tagName).toBe('DIV')
    expect(status).toHaveStyle({ position: 'fixed' })
    expect(screen.getByText('Procesando')).toBeInTheDocument()
  })

  it('inline variant omits the label text when label is not provided', () => {
    render(<MarketplaceLoader variant="inline" />)
    expect(screen.queryByText('Guardando', { exact: false })).not.toBeInTheDocument()
  })
})
