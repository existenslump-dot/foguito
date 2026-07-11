import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AdminPerformerReview from './AdminPerformerReview'

describe('AdminPerformerReview', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  it('does not fetch until opened', () => {
    render(<AdminPerformerReview performerId="p1" />)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('on open, loads the decrypted record + doc link', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        performer: {
          id: 'p1', added_by: 'c1', legal_name: 'Ada Lovelace', doc_url: 'https://signed/doc',
          custodian: 'creadora', didit_session_id: null, is_self: false, is_complete: false,
          dob_verified: false, created_at: 'x',
        },
      }),
    })
    render(<AdminPerformerReview performerId="p1" />)
    fireEvent.click(screen.getByRole('button', { name: /revisar 2257/i }))
    await waitFor(() => expect(screen.getByText(/Ada Lovelace/)).toBeInTheDocument())
    expect(screen.getByRole('link', { name: /ver documento/i })).toHaveAttribute('href', 'https://signed/doc')
    expect(screen.getByRole('button', { name: /certificar 2257/i })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/performers/p1')
  })

  it('certify POSTs to the complete endpoint and notifies', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        performer: {
          id: 'p1', added_by: 'c1', legal_name: 'Ada', doc_url: null, custodian: null,
          didit_session_id: null, is_self: false, is_complete: false, dob_verified: false, created_at: 'x',
        },
      }),
    })
    const notify = vi.fn()
    const onCompleted = vi.fn()
    render(<AdminPerformerReview performerId="p1" notify={notify} onCompleted={onCompleted} />)
    fireEvent.click(screen.getByRole('button', { name: /revisar 2257/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /certificar 2257/i })).toBeInTheDocument())

    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
    fireEvent.click(screen.getByRole('button', { name: /certificar 2257/i }))

    await waitFor(() => expect(screen.getByText(/2257 completo/i)).toBeInTheDocument())
    expect(fetchMock).toHaveBeenLastCalledWith('/api/admin/performers/p1/complete', { method: 'POST' })
    expect(notify).toHaveBeenCalledWith('Registro 2257 certificado', 'success')
    expect(onCompleted).toHaveBeenCalled()
  })

  it('shows an error when loading fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'Forbidden' }) })
    render(<AdminPerformerReview performerId="p1" />)
    fireEvent.click(screen.getByRole('button', { name: /revisar 2257/i }))
    await waitFor(() => expect(screen.getByText('Forbidden')).toBeInTheDocument())
  })
})
