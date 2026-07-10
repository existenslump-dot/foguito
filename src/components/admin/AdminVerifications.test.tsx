import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AdminVerifications from './AdminVerifications'

// recordAuditClient is fire-and-forget in the component — mock it so it
// doesn't fire network during the test.
vi.mock('@/lib/audit-client', () => ({ recordAuditClient: vi.fn() }))

const VERIF = {
  id: 'u1',
  full_name: 'Ana Rivera',
  email: 'ana@x.com',
  identity_doc_url: 'docs/u1-id.jpg',
  identity_selfie_url: 'docs/u1-selfie.jpg',
  identity_video_url: null,
  verification_status: 'pending',
  created_at: '2026-04-18T10:00:00Z',
}

describe('AdminVerifications', () => {
  const onRefetch    = vi.fn()
  const openDocument = vi.fn()
  const notify       = vi.fn()
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    // approve/reject pegan a POST /api/admin/verification (endpoint service-role).
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) })
    global.fetch = fetchMock as unknown as typeof fetch
  })

  it('renders empty state', () => {
    render(<AdminVerifications verifications={[]} onRefetch={onRefetch} openDocument={openDocument} notify={notify} />)
    expect(screen.getByText(/No hay verificaciones pendientes/i)).toBeInTheDocument()
  })

  it('renders full_name + email + only the document buttons that have URLs', () => {
    render(<AdminVerifications verifications={[VERIF]} onRefetch={onRefetch} openDocument={openDocument} notify={notify} />)
    expect(screen.getByText('Ana Rivera')).toBeInTheDocument()
    expect(screen.getByText('ana@x.com')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ver documento/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ver selfie/i })).toBeInTheDocument()
    // No identity_video_url → no "Ver Video" button
    expect(screen.queryByRole('button', { name: /ver video/i })).not.toBeInTheDocument()
  })

  it('click "Ver Documento" → calls openDocument with path', () => {
    render(<AdminVerifications verifications={[VERIF]} onRefetch={onRefetch} openDocument={openDocument} notify={notify} />)
    fireEvent.click(screen.getByRole('button', { name: /ver documento/i }))
    expect(openDocument).toHaveBeenCalledWith('docs/u1-id.jpg')
  })

  it('click Aprobar → POST /api/admin/verification + onRefetch + notify success', async () => {
    render(<AdminVerifications verifications={[VERIF]} onRefetch={onRefetch} openDocument={openDocument} notify={notify} />)
    fireEvent.click(screen.getByRole('button', { name: /aprobar/i }))
    await waitFor(() => {
      expect(onRefetch).toHaveBeenCalled()
      expect(notify).toHaveBeenCalledWith('Verificación aprobada', 'success')
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/verification', expect.objectContaining({ method: 'POST' }))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ profileId: 'u1', action: 'approve' })
  })

  it('Rechazar → opens reason textarea → submit without reason shows error', async () => {
    render(<AdminVerifications verifications={[VERIF]} onRefetch={onRefetch} openDocument={openDocument} notify={notify} />)
    fireEvent.click(screen.getByRole('button', { name: /^rechazar$/i }))
    // Now "Confirmar Rechazo" button is visible
    fireEvent.click(screen.getByRole('button', { name: /confirmar rechazo/i }))
    await waitFor(() => {
      expect(notify).toHaveBeenCalledWith('Escribe un motivo de rechazo', 'error')
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('Rechazar with reason → POST /api/admin/verification + onRefetch + notify success', async () => {
    render(<AdminVerifications verifications={[VERIF]} onRefetch={onRefetch} openDocument={openDocument} notify={notify} />)
    fireEvent.click(screen.getByRole('button', { name: /^rechazar$/i }))
    const textarea = screen.getByPlaceholderText(/Motivo del rechazo/i)
    fireEvent.change(textarea, { target: { value: 'Documento borroso' } })
    fireEvent.click(screen.getByRole('button', { name: /confirmar rechazo/i }))
    await waitFor(() => {
      expect(onRefetch).toHaveBeenCalled()
      expect(notify).toHaveBeenCalledWith('Verificación rechazada', 'success')
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/verification', expect.objectContaining({ method: 'POST' }))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      profileId: 'u1', action: 'reject', reason: 'Documento borroso',
    })
  })

  it('approve failure → notify error, no refetch', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'DB error' }) })
    render(<AdminVerifications verifications={[VERIF]} onRefetch={onRefetch} openDocument={openDocument} notify={notify} />)
    fireEvent.click(screen.getByRole('button', { name: /aprobar/i }))
    await waitFor(() => {
      expect(notify).toHaveBeenCalledWith('DB error', 'error')
    })
    expect(onRefetch).not.toHaveBeenCalled()
  })
})
