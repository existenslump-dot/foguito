-- ═══════════════════════════════════════════════════════════════════════════
-- FOGUITO · PR-4 — age_verify_webhook_events: dedup / anti-replay del webhook
-- de verificación de edad del CONSUMIDOR (fan).
--
-- Espejo de didit_webhook_events (PR-1). La verificación HMAC + frescura (300s)
-- autentica un evento pero NO impide reprocesar el MISMO evento (retry del
-- proveedor) ni un replay dentro de la ventana. Esta tabla registra la clave
-- natural (session_id + status + created_at); el webhook inserta ANTES de
-- persistir y un conflicto de PK (23505) ⇒ ya procesado ⇒ no-op. Así cada evento
-- genuino escribe a lo sumo UNA fila 'verificada' en age_gate_verifications.
--
-- Deny-all: RLS ENABLE + FORCE y SIN policies ⇒ solo el service-role (que
-- bypassa RLS) puede leer/escribir. El webhook corre con getSupabaseAdmin().
--
-- Idempotente (CREATE TABLE IF NOT EXISTS).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.age_verify_webhook_events (
  session_id        text        NOT NULL,
  status            text        NOT NULL,
  event_created_at  bigint      NOT NULL,   -- body.created_at (Unix seconds)
  processed_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, status, event_created_at)
);

ALTER TABLE public.age_verify_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.age_verify_webhook_events FORCE  ROW LEVEL SECURITY;
-- Sin policies a propósito: deny-all para authenticated/anon; solo service-role.
