-- ═══════════════════════════════════════════════════════════════════════════
-- FOGUITO · PR-3 — evidencia de CSAM + registro de incidentes (pilar #0).
--
-- Cuando el escáner de CSAM (src/lib/csam/scan.ts) detecta un HIT, el pipeline,
-- EN ORDEN FAIL-CLOSED: (1) PRESERVA el material en el bucket `csam-evidence`
-- (NUNCA borra el original), (2) inserta un `csam_incidents` durable, (3) hace
-- el bloqueo duro del content (csam_status='blocked', status='removed'), y (4)
-- reporta a NCMEC (con estado durable + retry por cron).
--
-- TODO acceso a estos recursos es SERVER-SIDE con service-role. El bucket y la
-- tabla quedan DENY-ALL (RLS sin policies) — anon/authenticated no ven ni tocan
-- nada; solo el service-role (que bypassa RLS) lee/escribe.
--
-- Idempotente (ON CONFLICT DO NOTHING / CREATE … IF NOT EXISTS / DROP … IF EXISTS).
-- ═══════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────────────
-- Bucket privado `csam-evidence` — mismo patrón literal que `creator-content`.
--
-- RETENCIÓN LEGAL LARGA: la evidencia de un hit de CSAM se preserva para el
-- reporte a NCMEC y eventuales requerimientos de las autoridades. Este bucket
-- queda EXCLUIDO de cualquier purga/retención (no se toca en los crons de
-- retención). Deny-all: sin policies sobre storage.objects → solo service-role.
-- ──────────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('csam-evidence', 'csam-evidence', false)
ON CONFLICT (id) DO NOTHING;

-- NB (intencional): sin CREATE POLICY sobre storage.objects para este bucket.
-- Con RLS activa (default de Supabase Storage) y sin policy que las habilite,
-- anon/authenticated quedan en DENY-ALL; el material preservado de un hit NUNCA
-- es accesible por URL. El acceso queda 100% mediado por service-role.

-- ══════════════════════════════════════════════════════════════════════════
-- Tabla `csam_incidents` — registro durable de cada hit + estado del reporte
-- NCMEC. Deny-all (RLS ENABLE + FORCE, sin policies) → solo service-role.
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.csam_incidents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id       uuid,                 -- FK laxa a propósito: el content puede
                                         -- removerse; el incidente PERDURA.
  creator_id       uuid,
  media_ref        text,                 -- path original (bucket creator-content)
  evidence_path    text,                 -- path preservado (bucket csam-evidence)
  verdict          text,
  match_type       text,
  score            numeric,
  provider         text,
  ncmec_status     text NOT NULL DEFAULT 'pending'
                     CHECK (ncmec_status IN ('pending','reported','failed')),
  ncmec_report_id  text,
  reported_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Índice del cron de retry (busca ncmec_status in ('pending','failed')).
CREATE INDEX IF NOT EXISTS idx_csam_incidents_ncmec_status
  ON public.csam_incidents (ncmec_status);

-- Idempotencia durable: UN incidente por content (además del claim atómico +
-- terminal-check del pipeline). Un segundo intento de hit para el mismo content
-- choca (23505) y el pipeline reusa el incidente existente sin duplicar.
CREATE UNIQUE INDEX IF NOT EXISTS uq_csam_incidents_content
  ON public.csam_incidents (content_id)
  WHERE content_id IS NOT NULL;

ALTER TABLE public.csam_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.csam_incidents FORCE  ROW LEVEL SECURITY;
-- Sin policies a propósito: deny-all para authenticated/anon; solo service-role.
