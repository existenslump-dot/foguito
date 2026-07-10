'use client'
import { supabase } from '@/lib/supabase/client'
import { getAccessToken, signOut, supabaseFetch, getUserId, parseSession, readAuthCookieRaw } from '@/lib/supabase/direct'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { validateImageFile, IMAGE_ACCEPT_ATTR } from '@/lib/upload-validation'
import { CLOUDINARY_UPLOAD_PRESET, cloudinaryUploadUrl } from '@/lib/cloudinary.client'

export default function ProfilePage() {
  const [saving, setSaving]   = useState(false)
  const [email, setEmail]     = useState('')
  const [profile, setProfile] = useState({ full_name: '', phone: '', avatar_url: '', birthdate: '' })
  const [reviewsVerifiedOnly, setReviewsVerifiedOnly] = useState(false)
  const [togglingVerifiedOnly, setTogglingVerifiedOnly] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [statusMsg, setStatusMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showSignoutAllModal, setShowSignoutAllModal] = useState(false)
  const [signingOutAll, setSigningOutAll] = useState(false)
  const router = useRouter()

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // Cookie-based auth read avoids the SDK's auth.getUser hang risk.
      // Email comes from the JWT envelope rather than a network round-trip.
      const userId = getUserId()
      if (!userId) { router.push('/ingresar'); return }
      if (cancelled) return
      const session = parseSession(readAuthCookieRaw()) as unknown as { user?: { email?: string } } | null
      setEmail(session?.user?.email ?? '')

      type ProfileRow = {
        full_name: string | null
        phone: string | null
        avatar_url: string | null
        birthdate: string | null
        reviews_verified_only: boolean | null
      }
      const { data: rows, error } = await supabaseFetch<ProfileRow[]>(
        `profiles?select=full_name,phone,avatar_url,birthdate,reviews_verified_only&id=eq.${encodeURIComponent(userId)}&limit=1`,
      )
      if (cancelled || error || !rows?.[0]) return
      const row = rows[0]
      setReviewsVerifiedOnly(row.reviews_verified_only ?? false)
      setProfile({
        full_name: row.full_name || '',
        phone: row.phone || '',
        avatar_url: row.avatar_url || '',
        // `birthdate` is stored as DATE ('YYYY-MM-DD') server-side so we
        // pass the string straight to the <input type="date"> value
        // without an intermediate Date() parse (which would shift the day
        // across timezones on locales west of UTC).
        birthdate: row.birthdate || '',
      })
    })()
    return () => { cancelled = true }
  }, [router])

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()

    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: profile.full_name || null,
        phone: profile.phone || null,
        avatar_url: profile.avatar_url || null,
        birthdate: profile.birthdate || null,
      })
      .eq('id', user?.id)

    if (error) {
      console.error('Profile update error:', error)
      setStatusMsg({ text: error.message || 'Error al actualizar', type: 'error' })
    } else {
      setStatusMsg({ text: 'Datos guardados correctamente', type: 'success' })
    }
    setSaving(false)
    setTimeout(() => setStatusMsg(null), 4000)
  }

  const handleToggleVerifiedOnly = async (newValue: boolean) => {
    setTogglingVerifiedOnly(true)
    const previousValue = reviewsVerifiedOnly
    setReviewsVerifiedOnly(newValue) // optimistic
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setReviewsVerifiedOnly(previousValue); setTogglingVerifiedOnly(false); return }
    const { error } = await supabase
      .from('profiles')
      .update({ reviews_verified_only: newValue })
      .eq('id', user.id)
    if (error) {
      console.error('Verified-only toggle error:', error)
      setReviewsVerifiedOnly(previousValue) // rollback
      setStatusMsg({ text: 'No se pudo actualizar el filtro', type: 'error' })
      setTimeout(() => setStatusMsg(null), 4000)
    }
    setTogglingVerifiedOnly(false)
  }

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    // SVG/oversize gate — `accept="image/*"` matches SVG and browsers
    // happily upload it; the validator denies SVG by both MIME and
    // extension so a stripped Content-Type can't sneak it through.
    const r = validateImageFile(file)
    if (!r.ok) { setStatusMsg({ text: r.reason, type: 'error' }); return }
    setUploadingAvatar(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET)
      formData.append('folder', 'avatars')
      const res = await fetch(cloudinaryUploadUrl('image'), { method: 'POST', body: formData })
      const data = await res.json()
      if (data.secure_url) {
        setProfile(p => ({ ...p, avatar_url: data.secure_url }))
      }
    } catch { /* ignore */ }
    setUploadingAvatar(false)
  }

  const handleSignoutAll = async () => {
    setSigningOutAll(true)
    try {
      const res = await fetch('/api/auth/signout-all', { method: 'POST' })
      if (res.ok) {
        router.push('/ingresar')
      } else {
        const data = await res.json()
        setStatusMsg({ text: data.error || 'Error al cerrar sesiones', type: 'error' })
        setTimeout(() => setStatusMsg(null), 4000)
      }
    } catch {
      setStatusMsg({ text: 'Error al cerrar sesiones', type: 'error' })
      setTimeout(() => setStatusMsg(null), 4000)
    }
    setSigningOutAll(false)
    setShowSignoutAllModal(false)
  }

  const handleDeleteAccount = async () => {
    setDeleting(true)
    try {
      // Direct access-token read + direct signOut bypass the @supabase/ssr SDK
      // lock — a stuck navigator.locks auth-token mutex would leave the account
      // deleted server-side but the session still live client-side.
      const token = getAccessToken()
      const res = await fetch('/api/account/delete', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token ?? ''}` },
      })
      if (res.ok) {
        await signOut()
        router.push('/')
      } else {
        const data = await res.json()
        setStatusMsg({ text: data.error || 'Error al eliminar cuenta', type: 'error' })
        setTimeout(() => setStatusMsg(null), 4000)
      }
    } catch {
      setStatusMsg({ text: 'Error al eliminar cuenta', type: 'error' })
      setTimeout(() => setStatusMsg(null), 4000)
    }
    setDeleting(false)
    setShowDeleteModal(false)
  }

  return (
    <>
      <style>{`
        .mc-page { min-height:100vh; background:var(--v-bg-base); color:var(--v-text-primary); padding:40px 20px 64px; }
        .mc-wrap { max-width:520px; margin:0 auto; }

        .mc-hero { text-align:center; margin-bottom:26px; }
        .mc-hero-ic {
          width:60px; height:60px; margin:0 auto 14px; border-radius:50%;
          background:linear-gradient(135deg, rgba(37, 99, 235,0.18), rgba(37, 99, 235,0.04));
          border:1px solid rgba(37, 99, 235,0.22); color:var(--v-accent);
          display:flex; align-items:center; justify-content:center;
        }
        .mc-hero-ic svg { width:26px; height:26px; }
        .mc-hero h1 {
          font-family:'Cormorant Garamond','Playfair Display',serif;
          font-weight:500; font-size:30px; color:var(--v-text-primary);
          line-height:1.1; margin:0;
        }
        .mc-hero p {
          font-family:'Switzer','Inter',Arial,sans-serif;
          font-size:12px; color:var(--v-text-tertiary); margin:6px 0 0;
        }

        .mc-card {
          background:var(--v-bg-card); border:1px solid rgba(37, 99, 235,0.14);
          border-radius:16px; padding:24px;
          display:flex; flex-direction:column; gap:20px;
        }

        .mc-avatar-row {
          display:flex; align-items:center; gap:16px;
          padding-bottom:20px; border-bottom:1px solid rgba(37, 99, 235,0.08);
        }
        .mc-avatar {
          width:64px; height:64px; border-radius:50%; overflow:hidden; flex-shrink:0;
          background:var(--v-bg-base); border:1px solid rgba(37, 99, 235,0.2);
          display:flex; align-items:center; justify-content:center;
        }
        .mc-avatar-initial { font-family:'Cormorant Garamond',serif; font-size:26px; color:rgba(37, 99, 235,0.5); }
        .mc-avatar-ttl { font-family:'Cormorant Garamond',serif; font-size:16px; color:var(--v-text-primary); }
        .mc-avatar-btn {
          display:inline-block; margin-top:6px; padding:6px 14px; border-radius:999px;
          border:1px solid rgba(37, 99, 235,0.3); cursor:pointer;
          font-family:'Montserrat',sans-serif; font-size:9px; font-weight:500;
          letter-spacing:.16em; text-transform:uppercase; color:var(--v-accent);
          transition:border-color .3s ease, background .3s ease;
        }
        .mc-avatar-btn:hover { border-color:rgba(37, 99, 235,0.55); background:rgba(37, 99, 235,0.06); }

        .mc-field { display:flex; flex-direction:column; }
        .mc-label {
          display:flex; align-items:center; gap:6px;
          font-family:'Montserrat',sans-serif; font-size:9px; font-weight:500;
          letter-spacing:.2em; text-transform:uppercase; color:var(--v-accent); margin-bottom:8px;
        }
        .mc-label svg { width:11px; height:11px; opacity:.75; }
        .mc-input {
          width:100%; box-sizing:border-box;
          background:var(--v-bg-base); border:1px solid rgba(37, 99, 235,0.14);
          padding:13px 15px; border-radius:10px; outline:none;
          font-family:'Switzer','Inter',Arial,sans-serif; font-size:13.5px;
          color:var(--v-text-primary); transition:border-color .3s ease;
        }
        .mc-input::placeholder { color:var(--v-text-tertiary); }
        .mc-input:focus { border-color:rgba(37, 99, 235,0.45); }
        .mc-input.readonly { color:var(--v-text-tertiary); cursor:not-allowed; background:rgba(255,255,255,0.015); }
        .mc-hint {
          font-family:'Switzer','Inter',Arial,sans-serif; font-size:10.5px;
          color:var(--v-text-tertiary); line-height:1.5; margin:7px 0 0;
        }

        .mc-save {
          width:100%; padding:14px; border:none; border-radius:999px; cursor:pointer;
          background:var(--v-accent); color:var(--v-bg-base);
          font-family:'Montserrat',sans-serif; font-size:11px; font-weight:600;
          letter-spacing:.16em; text-transform:uppercase; transition:background .3s ease;
        }
        .mc-save:hover { background:var(--v-accent-light); }
        .mc-save:disabled { background:rgba(37, 99, 235,0.18); color:var(--v-text-tertiary); cursor:not-allowed; }

        .mc-sec-ttl {
          font-family:'Montserrat',sans-serif; font-size:9px; font-weight:500;
          letter-spacing:.2em; text-transform:uppercase; color:var(--v-text-tertiary);
          margin:30px 0 10px 4px;
        }
        .mc-sec { display:flex; flex-direction:column; gap:10px; }
        .mc-sec-btn {
          display:flex; align-items:center; justify-content:space-between; gap:12px;
          width:100%; text-align:left; padding:14px 16px; border-radius:12px; cursor:pointer;
          background:var(--v-bg-card); border:1px solid rgba(37, 99, 235,0.1);
          transition:border-color .3s ease, background .3s ease;
        }
        .mc-sec-btn:hover { border-color:rgba(37, 99, 235,0.28); }
        .mc-sec-btn.danger:hover { border-color:rgba(224,85,85,0.4); background:rgba(224,85,85,0.03); }
        .mc-sec-btn-txt { font-family:'Switzer','Inter',Arial,sans-serif; font-size:13px; color:var(--v-text-primary); }
        .mc-sec-btn.danger .mc-sec-btn-txt { color:var(--v-error); }
        .mc-sec-btn-arrow { color:var(--v-text-tertiary); flex-shrink:0; }

        .mc-toast {
          position:fixed; top:88px; left:50%; transform:translateX(-50%); z-index:100;
          padding:13px 26px; border-radius:999px; max-width:calc(100vw - 32px); text-align:center;
          font-family:'Montserrat',sans-serif; font-size:10px; font-weight:500;
          letter-spacing:.14em; text-transform:uppercase;
        }
        .mc-toast.success { border:1px solid rgba(37, 99, 235,0.3); background:rgba(20,16,8,0.96); color:var(--v-accent); }
        .mc-toast.error { border:1px solid rgba(224,85,85,0.3); background:rgba(40,12,12,0.96); color:#e89898; }

        .mc-modal {
          position:fixed; inset:0; z-index:1000; padding:24px;
          background:rgba(8,8,8,0.92); backdrop-filter:blur(6px);
          display:flex; align-items:center; justify-content:center;
        }
        .mc-modal-card {
          background:var(--v-bg-card); border:1px solid rgba(37, 99, 235,0.2);
          border-radius:16px; padding:28px; max-width:380px; width:100%;
        }
        .mc-modal-card.danger { border-color:rgba(224,85,85,0.28); }
        .mc-modal-card h3 {
          font-family:'Cormorant Garamond',serif; font-weight:500; font-size:22px;
          color:var(--v-text-primary); margin:0 0 10px;
        }
        .mc-modal-card p {
          font-family:'Switzer','Inter',Arial,sans-serif; font-size:12.5px;
          color:var(--v-text-tertiary); line-height:1.6; margin:0 0 20px;
        }
        .mc-modal-actions { display:flex; flex-direction:column; gap:10px; }
        .mc-modal-btn {
          width:100%; padding:13px; border-radius:999px; cursor:pointer; border:none;
          font-family:'Montserrat',sans-serif; font-size:10px; font-weight:600;
          letter-spacing:.16em; text-transform:uppercase;
        }
        .mc-modal-btn.confirm { background:var(--v-accent); color:var(--v-bg-base); }
        .mc-modal-btn.confirm.danger { background:var(--v-error); color:#fff; }
        .mc-modal-btn.confirm:disabled { opacity:.5; cursor:not-allowed; }
        .mc-modal-btn.cancel { background:transparent; border:1px solid rgba(37, 99, 235,0.18); color:var(--v-text-tertiary); }

        .mc-footer { margin-top:40px; text-align:center; }
        .mc-footer p {
          font-family:'Montserrat',sans-serif; font-size:9px;
          letter-spacing:.22em; text-transform:uppercase; color:var(--v-text-tertiary);
        }
      `}</style>

      <div className="mc-page">
        {statusMsg && <div className={`mc-toast ${statusMsg.type}`}>{statusMsg.text}</div>}

        <div className="mc-wrap">
          <div className="mc-hero">
            <div className="mc-hero-ic">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="4" />
                <path d="M5 21c0-3.9 3.1-7 7-7s7 3.1 7 7" />
              </svg>
            </div>
            <h1>Mi cuenta</h1>
            <p>Tus datos personales y de acceso</p>
          </div>

          <form onSubmit={handleUpdate} className="mc-card">
            <div className="mc-avatar-row">
              <div className="mc-avatar">
                {profile.avatar_url ? (
                  <Image
                    src={profile.avatar_url}
                    alt="Foto de perfil"
                    width={64}
                    height={64}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  <span className="mc-avatar-initial">
                    {profile.full_name?.[0]?.toUpperCase() || email?.[0]?.toUpperCase() || 'V'}
                  </span>
                )}
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="mc-avatar-ttl">Foto de perfil</div>
                <label className="mc-avatar-btn">
                  {uploadingAvatar ? 'Subiendo…' : 'Cambiar foto'}
                  <input
                    type="file"
                    accept={IMAGE_ACCEPT_ATTR}
                    style={{ display: 'none' }}
                    onChange={handleAvatarChange}
                  />
                </label>
              </div>
            </div>

            <div className="mc-field">
              <label className="mc-label" htmlFor="mc-name">Nombre o apodo</label>
              <input
                id="mc-name"
                type="text"
                className="mc-input"
                value={profile.full_name}
                onChange={e => setProfile({ ...profile, full_name: e.target.value })}
                placeholder="Tu nombre o alias…"
              />
              <p className="mc-hint">Visible en el foro y en experiencias.</p>
            </div>

            <div className="mc-field">
              <label className="mc-label" htmlFor="mc-phone">Teléfono</label>
              <input
                id="mc-phone"
                type="tel"
                className="mc-input"
                value={profile.phone}
                onChange={e => setProfile({ ...profile, phone: e.target.value })}
                placeholder="+54 9 11 2678 3554"
              />
              <p className="mc-hint">Respaldo si un anuncio no tiene su propio WhatsApp.</p>
            </div>

            <div className="mc-field">
              <label className="mc-label" htmlFor="mc-birthdate">Fecha de nacimiento</label>
              <input
                id="mc-birthdate"
                name="birthdate"
                type="date"
                className="mc-input"
                value={profile.birthdate}
                onChange={e => setProfile({ ...profile, birthdate: e.target.value })}
                max={new Date().toISOString().slice(0, 10)}
              />
              <p className="mc-hint">Uso interno. Nunca se publica en el anuncio.</p>
            </div>

            <div className="mc-field">
              <label className="mc-label" htmlFor="mc-email">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="5" y="11" width="14" height="9" rx="1.6" />
                  <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                </svg>
                Correo electrónico
              </label>
              <input id="mc-email" type="text" className="mc-input readonly" value={email} readOnly />
              <p className="mc-hint">Es tu identificador de acceso — no se puede modificar.</p>
            </div>

            <button type="submit" className="mc-save" disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </form>

          <p className="mc-sec-ttl">Reseñas</p>
          <div className="mc-sec">
            <button
              type="button"
              className="mc-sec-btn"
              onClick={() => handleToggleVerifiedOnly(!reviewsVerifiedOnly)}
              disabled={togglingVerifiedOnly}
              style={{ opacity: togglingVerifiedOnly ? 0.6 : 1 }}
            >
              <span className="mc-sec-btn-txt">
                Mostrar solo reseñas verificadas
                <br />
                <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.45)', fontWeight: 400, marginTop: '4px', display: 'inline-block' }}>
                  {reviewsVerifiedOnly
                    ? 'Activado · solo se publican reseñas de usuarias logged-in que contactaron por WhatsApp'
                    : 'Desactivado · se muestran todas las reseñas aprobadas'}
                </span>
              </span>
              <span style={{
                marginLeft: '12px',
                width: '40px',
                height: '22px',
                borderRadius: '999px',
                background: reviewsVerifiedOnly ? 'var(--v-accent)' : 'rgba(255,255,255,0.12)',
                position: 'relative',
                transition: 'background .2s ease',
                flexShrink: 0,
              }}>
                <span style={{
                  position: 'absolute',
                  top: '2px',
                  left: reviewsVerifiedOnly ? '20px' : '2px',
                  width: '18px',
                  height: '18px',
                  borderRadius: '50%',
                  background: '#fff',
                  transition: 'left .2s ease',
                }} />
              </span>
            </button>
          </div>

          <p className="mc-sec-ttl">Seguridad</p>
          <div className="mc-sec">
            <button type="button" className="mc-sec-btn" onClick={() => setShowSignoutAllModal(true)}>
              <span className="mc-sec-btn-txt">Cerrar sesión en todos los dispositivos</span>
              <svg className="mc-sec-btn-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
            <button type="button" className="mc-sec-btn danger" onClick={() => setShowDeleteModal(true)}>
              <span className="mc-sec-btn-txt">Eliminar mi cuenta</span>
              <svg className="mc-sec-btn-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          </div>

          <div className="mc-footer">
            <p>Marketplace ✦ Latam · © 2026</p>
          </div>
        </div>

        {showSignoutAllModal && (
          <div className="mc-modal" onClick={() => setShowSignoutAllModal(false)}>
            <div className="mc-modal-card" onClick={e => e.stopPropagation()}>
              <h3>¿Cerrar todas las sesiones?</h3>
              <p>Se cerrará tu sesión en todos los dispositivos, incluido este. Vas a tener que iniciar sesión de nuevo.</p>
              <div className="mc-modal-actions">
                <button type="button" className="mc-modal-btn confirm" disabled={signingOutAll} onClick={handleSignoutAll}>
                  {signingOutAll ? 'Cerrando…' : 'Confirmar'}
                </button>
                <button type="button" className="mc-modal-btn cancel" onClick={() => setShowSignoutAllModal(false)}>
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}

        {showDeleteModal && (
          <div className="mc-modal" onClick={() => setShowDeleteModal(false)}>
            <div className="mc-modal-card danger" onClick={e => e.stopPropagation()}>
              <h3>¿Eliminar tu cuenta?</h3>
              <p>Esta acción es irreversible. Todos tus anuncios, fotos y datos se eliminan de forma permanente.</p>
              <div className="mc-modal-actions">
                <button type="button" className="mc-modal-btn confirm danger" disabled={deleting} onClick={handleDeleteAccount}>
                  {deleting ? 'Eliminando…' : 'Eliminar definitivamente'}
                </button>
                <button type="button" className="mc-modal-btn cancel" onClick={() => setShowDeleteModal(false)}>
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
