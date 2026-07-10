import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import DiditDecisionPanel from './DiditDecisionPanel'

describe('DiditDecisionPanel', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  it('does not fetch until opened (no interference with the parent)', () => {
    render(<DiditDecisionPanel userId="u1" />)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('on open, loads and shows status + scores + document data', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        session: {
          status: 'approved',
          decision: 'Approved',
          decline_reason: null,
          face_match_score: 97,
          liveness_score: 92,
          id_verification: { first_name: 'Ana', last_name: 'Rivera', document_number: '30111222' },
        },
      }),
    })
    render(<DiditDecisionPanel userId="u1" />)
    fireEvent.click(screen.getByRole('button', { name: /datos didit/i }))

    await waitFor(() => expect(screen.getByText(/Didit: Aprobada/i)).toBeInTheDocument())
    expect(screen.getByText(/Rostro 97%/i)).toBeInTheDocument()
    expect(screen.getByText(/Prueba de vida 92%/i)).toBeInTheDocument()
    expect(screen.getByText(/Ana Rivera/)).toBeInTheDocument()
    expect(screen.getByText(/30111222/)).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/verification-session?userId=u1')
  })

  it('shows "no session" when there is no Didit session', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ session: null }) })
    render(<DiditDecisionPanel userId="u1" />)
    fireEvent.click(screen.getByRole('button', { name: /datos didit/i }))
    await waitFor(() => expect(screen.getByText(/Sin sesión de Didit/i)).toBeInTheDocument())
  })

  it('shows an error if loading fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'Forbidden' }) })
    render(<DiditDecisionPanel userId="u1" />)
    fireEvent.click(screen.getByRole('button', { name: /datos didit/i }))
    await waitFor(() => expect(screen.getByText('Forbidden')).toBeInTheDocument())
  })

  it('toggle closes and reopens without re-fetching (cache)', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ session: null }) })
    render(<DiditDecisionPanel userId="u1" />)
    const btn = screen.getByRole('button', { name: /datos didit/i })
    fireEvent.click(btn)
    await waitFor(() => expect(screen.getByText(/Sin sesión de Didit/i)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /ocultar didit/i }))
    fireEvent.click(screen.getByRole('button', { name: /datos didit/i }))
    expect(fetchMock).toHaveBeenCalledTimes(1) // no re-fetch (loaded cache)
  })
})
