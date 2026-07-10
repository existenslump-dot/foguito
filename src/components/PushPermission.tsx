'use client'
import { supabase } from '@/lib/supabase/client'
import { useState, useEffect } from 'react'

export default function PushPermission() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator)) return
    if (localStorage.getItem('marketplace_push_asked') === 'true') return
    if (Notification.permission === 'granted') return

    // Only show for logged-in users after a short delay
    const timer = setTimeout(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) setShow(true)
    }, 3000)

    return () => clearTimeout(timer)
  }, [])

  const handleEnable = async () => {
    localStorage.setItem('marketplace_push_asked', 'true')
    const permission = await Notification.requestPermission()

    if (permission === 'granted' && process.env.NEXT_PUBLIC_VAPID_KEY) {
      try {
        const registration = await navigator.serviceWorker.ready
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: process.env.NEXT_PUBLIC_VAPID_KEY,
        })

        // user_id is derived server-side from the session cookie; do not
        // include it in the body (that was impersonation-by-default).
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          await fetch('/api/push/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subscription }),
          })
        }
      } catch (err) {
        console.error('Push subscription error:', err)
      }
    }

    setShow(false)
  }

  const handleDismiss = () => {
    localStorage.setItem('marketplace_push_asked', 'true')
    setShow(false)
  }

  if (!show) return null

  return (
    <div
      style={{
        position: 'fixed', bottom: '80px', right: '16px', zIndex: 300,
        background: 'var(--v-bg-card)', border: '1px solid rgba(37, 99, 235,0.25)',
        borderRadius: '2px', padding: '20px', maxWidth: '280px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <p style={{
        fontFamily: "'Montserrat', sans-serif", fontSize: '11px', fontWeight: 400,
        color: 'var(--v-text-primary)', lineHeight: 1.6, marginBottom: '16px',
      }}>
        ¿Recibir notificaciones de Marketplace?
      </p>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          onClick={handleEnable}
          style={{
            flex: 1, padding: '10px', border: '1px solid rgba(37, 99, 235,0.4)',
            background: 'transparent', color: 'var(--v-accent-strong)', borderRadius: '2px',
            cursor: 'pointer', fontFamily: "'Montserrat', sans-serif",
            fontSize: '8px', fontWeight: 600, letterSpacing: '.18em',
            textTransform: 'uppercase', transition: 'background .3s ease',
          }}
        >
          Activar
        </button>
        <button
          onClick={handleDismiss}
          style={{
            flex: 1, padding: '10px', border: '1px solid rgba(37, 99, 235,0.2)',
            background: 'transparent', color: 'var(--v-text-secondary)', borderRadius: '2px',
            cursor: 'pointer', fontFamily: "'Montserrat', sans-serif",
            fontSize: '8px', fontWeight: 600, letterSpacing: '.18em',
            textTransform: 'uppercase',
          }}
        >
          No
        </button>
      </div>
    </div>
  )
}
