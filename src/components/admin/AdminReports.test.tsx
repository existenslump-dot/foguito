import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AdminReports from './AdminReports'

vi.mock('@/lib/admin/actions', () => ({
  dismissReport:        vi.fn(),
  deletePostFromReport: vi.fn(),
  actionReport:         vi.fn(),
}))
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }))
vi.mock('@/lib/audit-client', () => ({
  recordAuditClient: vi.fn().mockResolvedValue(undefined),
}))

import { dismissReport, deletePostFromReport } from '@/lib/admin/actions'

const REPORT_A = {
  id: 'rp1',
  post_id: 'p1',
  category: 'estafa',
  description: 'Sospechoso de fraude',
  created_at: '2026-04-18T12:00:00Z',
  posts: { title: 'Anuncio Fraude', image_urls: ['https://x/img.jpg'], city: 'argentina', countries: { slug: 'argentina' } },
}
const REPORT_INAPROPIADO = {
  id: 'rp2',
  post_id: 'p2',
  category: 'contenido_inapropiado',
  description: '',
  created_at: '2026-04-18T10:00:00Z',
  posts: { title: 'Caso serio', image_urls: [], city: 'argentina', countries: { slug: 'argentina' } },
}

describe('AdminReports', () => {
  const onRemoveReport = vi.fn()
  const onRemovePost   = vi.fn()
  const notify         = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    ;(dismissReport as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({ ok: true, data: undefined })
    ;(deletePostFromReport as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({ ok: true, data: undefined })
  })

  it('renders empty state when no reports', () => {
    render(<AdminReports reports={[]} onRemoveReport={onRemoveReport} onRemovePost={onRemovePost} notify={notify} />)
    expect(screen.getByText(/Sin reportes para este filtro/i)).toBeInTheDocument()
  })

  it('renders report rows with title + category label', () => {
    render(<AdminReports reports={[REPORT_A, REPORT_INAPROPIADO]} onRemoveReport={onRemoveReport} onRemovePost={onRemovePost} notify={notify} />)
    expect(screen.getByText('Anuncio Fraude')).toBeInTheDocument()
    expect(screen.getByText('Estafa')).toBeInTheDocument()
    expect(screen.getByText('Caso serio')).toBeInTheDocument()
    expect(screen.getByText('Inapropiado')).toBeInTheDocument()
  })

  it('Descartar (PR-F renombrado de Desestimar) → calls dismissReport + onRemoveReport (no post removal)', async () => {
    render(<AdminReports reports={[REPORT_A]} onRemoveReport={onRemoveReport} onRemovePost={onRemovePost} notify={notify} />)
    fireEvent.click(screen.getByRole('button', { name: /descartar/i }))
    await waitFor(() => {
      expect(dismissReport).toHaveBeenCalledWith({}, 'rp1', undefined)
      expect(onRemoveReport).toHaveBeenCalledWith('rp1')
      expect(onRemovePost).not.toHaveBeenCalled()
    })
  })

  it('Descartar con adminId prop → calls dismissReport con options { adminId }', async () => {
    render(<AdminReports reports={[REPORT_A]} adminId="admin-1" onRemoveReport={onRemoveReport} onRemovePost={onRemovePost} notify={notify} />)
    fireEvent.click(screen.getByRole('button', { name: /descartar/i }))
    await waitFor(() => {
      expect(dismissReport).toHaveBeenCalledWith({}, 'rp1', { adminId: 'admin-1' })
    })
  })

  it('Eliminar post → calls deletePostFromReport + both callbacks + notify success', async () => {
    render(<AdminReports reports={[REPORT_A]} onRemoveReport={onRemoveReport} onRemovePost={onRemovePost} notify={notify} />)
    fireEvent.click(screen.getByRole('button', { name: /eliminar post/i }))
    await waitFor(() => {
      expect(deletePostFromReport).toHaveBeenCalledWith({}, 'rp1', 'p1', undefined)
      expect(onRemoveReport).toHaveBeenCalledWith('rp1')
      expect(onRemovePost).toHaveBeenCalledWith('p1')
      expect(notify).toHaveBeenCalledWith('Publicación eliminada', 'success')
    })
  })

  it('dismiss failure → notify error, no callbacks', async () => {
    ;(dismissReport as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      ok: false, error: 'Forbidden',
    })
    render(<AdminReports reports={[REPORT_A]} onRemoveReport={onRemoveReport} onRemovePost={onRemovePost} notify={notify} />)
    fireEvent.click(screen.getByRole('button', { name: /descartar/i }))
    await waitFor(() => {
      expect(notify).toHaveBeenCalledWith('Forbidden', 'error')
      expect(onRemoveReport).not.toHaveBeenCalled()
    })
  })

  it('renders "Ver post" link with correct /{city}/post/{id} href', () => {
    render(<AdminReports reports={[REPORT_A]} onRemoveReport={onRemoveReport} onRemovePost={onRemovePost} notify={notify} />)
    const link = screen.getByRole('link', { name: /ver post/i })
    expect(link).toHaveAttribute('href', '/argentina/post/p1')
  })
})
