import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import AdminPerformers, { type PerformerSummary } from './AdminPerformers'

const row = (over: Partial<PerformerSummary> = {}): PerformerSummary => ({
  id: 'p1', added_by: 'c1', custodian: null, is_self: false, is_complete: false,
  dob_verified: false, created_at: 'x', ...over,
})

describe('AdminPerformers', () => {
  beforeEach(() => {
    global.fetch = vi.fn() as unknown as typeof fetch
  })

  it('shows the empty state with no records', () => {
    render(<AdminPerformers performers={[]} />)
    expect(screen.getByText(/no hay registros 2257 pendientes/i)).toBeInTheDocument()
  })

  it('renders one review row per pending record + the count badge', () => {
    render(<AdminPerformers performers={[row({ id: 'p1' }), row({ id: 'p2', is_self: true })]} />)
    expect(screen.getByText('2')).toBeInTheDocument()
    // one toggle per row, none fetch until opened
    expect(screen.getAllByRole('button', { name: /revisar 2257/i })).toHaveLength(2)
    expect(screen.getByText(/self · pendiente/i)).toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
