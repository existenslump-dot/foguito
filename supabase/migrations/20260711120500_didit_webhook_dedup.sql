-- ═══════════════════════════════════════════════════════════════════════════
-- FOGUITO · PR-1 — didit_webhook_events: dedup / anti-replay del webhook Didit.
--
-- La verificación HMAC + frescura (300s) autentica un evento, pero NO impide
-- reprocesar el MISMO evento genuino dos veces (retry de Didit) ni un replay
-- capturado dentro de la ventana de 300s. Esta tabla registra la clave natural
-- de cada evento (session_id + status + created_at); el webhook inserta ANTES de
-- persistir y un conflicto de PK (23505) ⇒ ya procesado ⇒ no-op. Así cada evento
-- genuino se aplica exactamente una vez.
--
-- Deny-all: RLS ENABLE + FORCE y SIN policies ⇒ solo el service-role (que
-- bypassa RLS) puede leer/escribir. El webhook corre con getSupabaseAdmin().
--
-- Idempotente (CREATE TABLE IF NOT EXISTS / DROP POLICY IF EXISTS).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.didit_webhook_events (
  session_id        text        NOT NULL,
  status            text        NOT NULL,
  event_created_at  bigint      NOT NULL,   -- body.created_at (Unix seconds)
  processed_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, status, event_created_at)
);

ALTER TABLE public.didit_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.didit_webhook_events FORCE  ROW LEVEL SECURITY;
-- Sin policies a propósito: deny-all para authenticated/anon; solo service-role.
