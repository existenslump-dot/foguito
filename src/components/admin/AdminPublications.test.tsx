import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AdminPublications from './AdminPublications'

vi.mock('@/lib/admin/actions', () => ({
  rejectPost:              vi.fn(),
  deletePost:              vi.fn(),
  togglePostHidden:        vi.fn(),
  togglePostVerified:      vi.fn(),
  verifyPostWithId:        vi.fn(),
  rejectPostIdDocument:    vi.fn(),
}))
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: { access_token: 'tk' } } })),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })) })) })),
      update: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) })),
    })),
    storage: { from: vi.fn(() => ({ createSignedUrl: vi.fn(() => Promise.resolve({ data: null, error: null })) })) },
  },
}))

import { rejectPost, deletePost, togglePostHidden } from '@/lib/admin/actions'

const POST_PENDING = {
  id: 'p1', title: 'Stella', status: 'pending', tier: 'basic',
  category: 'mujer', user_id: 'u1', image_urls: ['https://x/img.jpg'],
  is_approved: false, is_hidden: false, identity_verified: false,
  created_at: '2026-04-18T10:00:00Z',
}
const POST_PUBLISHED = {
  ...POST_PENDING, id: 'p2', title: 'Luna', status: 'published', is_approved: true,
}
const POST_REVISION = {
  ...POST_PENDING, id: 'p3', title: 'Aurora', status: 'revision', parent_post_id: 'p-orig',
}

const PROFILE_MAP = { u1: { credits: 100, email: 'test@example.com' } }

describe('AdminPublications', () => {
  const onRefetch = vi.fn()
  const notify    = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    ;(rejectPost       as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({ ok: true, data: undefined })
    ;(deletePost       as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({ ok: true, data: undefined })
    ;(togglePostHidden as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({ ok: true, data: undefined })
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    } as Response)) as unknown as typeof fetch
  })

  it('renders empty state', () => {
    render(<AdminPublications posts={[]} profileMap={{}} onRefetch={onRefetch} notify={notify} />)
    expect(screen.getByText(/bóveda de contenido está vacía/i)).toBeInTheDocument()
  })

  it('renders pending + published + revision posts', () => {
    render(<AdminPublications posts={[POST_PENDING, POST_PUBLISHED, POST_REVISION]} profileMap={PROFILE_MAP} onRefetch={onRefetch} notify={notify} />)
    expect(screen.getByText('Stella')).toBeInTheDocument()
    expect(screen.getByText('Luna')).toBeInTheDocument()
    expect(screen.getByText('Aurora')).toBeInTheDocument()
  })

  it('two-click approve → fetch /api/admin/approve-post + notify + onRefetch', async () => {
    render(<AdminPublications posts={[POST_PENDING]} profileMap={PROFILE_MAP} onRefetch={onRefetch} notify={notify} />)
    fireEvent.click(screen.getByRole('button', { name: /^aprobar$/i }))
    fireEvent.click(screen.getByRole('button', { name: /^confirmar$/i }))
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/admin/approve-post',
        expect.objectContaining({ method: 'POST' }),
      )
      expect(notify).toHaveBeenCalledWith('Publicación aprobada', 'success')
      expect(onRefetch).toHaveBeenCalled()
    })
  })

  it('approve API failure → notify error, no refetch', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: false,
      json: () => Promise.resolve({ error: 'Insufficient credits' }),
    } as Response)) as unknown as typeof fetch
    render(<AdminPublications posts={[POST_PENDING]} profileMap={PROFILE_MAP} onRefetch={onRefetch} notify={notify} />)
    fireEvent.click(screen.getByRole('button', { name: /^aprobar$/i }))
    fireEvent.click(screen.getByRole('button', { name: /^confirmar$/i }))
    await waitFor(() => {
      expect(notify).toHaveBeenCalledWith('Error: Insufficient credits', 'error')
      expect(onRefetch).not.toHaveBeenCalled()
    })
  })

  it('reject flow — textarea + Confirmar submits rejectPost with reason', async () => {
    render(<AdminPublications posts={[POST_PENDING]} profileMap={PROFILE_MAP} onRefetch={onRefetch} notify={notify} />)
    fireEvent.click(screen.getByRole('button', { name: /^rechazar$/i }))
    const textarea = screen.getByPlaceholderText(/razón para que el usuario pueda corregirlo/i)
    fireEvent.change(textarea, { target: { value: 'Fotos incompletas' } })
    fireEvent.click(screen.getByRole('button', { name: /^confirmar$/i }))
    await waitFor(() => {
      expect(rejectPost).toHaveBeenCalledWith(expect.anything(), 'p1', 'Fotos incompletas')
      expect(notify).toHaveBeenCalledWith('Anuncio rechazado', 'success')
      expect(onRefetch).toHaveBeenCalled()
    })
  })

  it('reject without reason → notify "Escribe un motivo", no call', async () => {
    render(<AdminPublications posts={[POST_PENDING]} profileMap={PROFILE_MAP} onRefetch={onRefetch} notify={notify} />)
    fireEvent.click(screen.getByRole('button', { name: /^rechazar$/i }))
    fireEvent.click(screen.getByRole('button', { name: /^confirmar$/i }))
    await waitFor(() => {
      expect(notify).toHaveBeenCalledWith('Escribe un motivo', 'error')
      expect(rejectPost).not.toHaveBeenCalled()
    })
  })

  it('delete — overflow menu → "Eliminar publicación" item opens modal, "Eliminar" confirms', async () => {
    render(<AdminPublications posts={[POST_PUBLISHED]} profileMap={PROFILE_MAP} onRefetch={onRefetch} notify={notify} />)
    fireEvent.click(screen.getByRole('button', { name: /más acciones/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /eliminar publicación/i }))
    const modalEliminar = screen.getByRole('button', { name: /^eliminar$/i })
    fireEvent.click(modalEliminar)
    await waitFor(() => {
      expect(deletePost).toHaveBeenCalled()
      expect(onRefetch).toHaveBeenCalled()
    })
  })

  it('toggle hidden on a published post → overflow menu → togglePostHidden(true) + refetch', async () => {
    render(<AdminPublications posts={[POST_PUBLISHED]} profileMap={PROFILE_MAP} onRefetch={onRefetch} notify={notify} />)
    fireEvent.click(screen.getByRole('button', { name: /más acciones/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /ocultar del catálogo/i }))
    await waitFor(() => {
      expect(togglePostHidden).toHaveBeenCalledWith(expect.anything(), 'p2', true)
      expect(onRefetch).toHaveBeenCalled()
    })
  })
})
