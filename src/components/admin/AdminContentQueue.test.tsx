import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import AdminContentQueue from './AdminContentQueue'

type Row = {
  id: string
  creator_id: string
  title: string | null
  media_type: 'image' | 'video' | 'audio' | null
  visibility: 'free_preview' | 'tier' | 'ppv'
  required_tier: string | null
  ppv_price_credits: number | null
  status: string
  csam_status: string
  created_at: string
}

const row = (over: Partial<Row> = {}): Row => ({
  id: 'c1', creator_id: 'u1', title: 'Post', media_type: 'image', visibility: 'tier',
  required_tier: 'gold', ppv_price_credits: null, status: 'uploaded', csam_status: 'pending',
  created_at: 'x', ...over,
})

function mockFetchOnce(content: Row[]) {
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ content }) }),
  ) as unknown as typeof fetch
}

describe('AdminContentQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the empty state once the (empty) queue loads', async () => {
    mockFetchOnce([])
    render(<AdminContentQueue />)
    expect(await screen.findByText(/no hay contenido pendiente/i)).toBeInTheDocument()
    expect(global.fetch).toHaveBeenCalledWith('/api/admin/content')
  })

  it('renders one row per pending piece with a count badge + moderation buttons', async () => {
    mockFetchOnce([row({ id: 'c1' }), row({ id: 'c2', status: 'in_review', csam_status: 'pass' })])
    render(<AdminContentQueue />)

    await waitFor(() => expect(screen.getByText('2')).toBeInTheDocument())
    expect(screen.getAllByRole('button', { name: /publicar/i })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: /rechazar/i })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: /ver media/i })).toHaveLength(2)
    // CSAM status surfaced so the admin sees why publish may be blocked
    expect(screen.getByText(/csam: pending/i)).toBeInTheDocument()
  })
})
