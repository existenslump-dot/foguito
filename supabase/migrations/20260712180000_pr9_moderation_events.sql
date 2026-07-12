-- ═══════════════════════════════════════════════════════════════════════════
-- PR-9 · Quejas / takedown / cooperación con autoridades.
--
-- `moderation_events` = la cola de QUEJAS sobre contenido de creadora (DMCA,
-- ilegal, no-consentido, CSAM-sospechado, spam). Intake por-pieza, triage con SLA,
-- takedown (que se propaga SOLO con `content.status='removed'` — la RLS y los
-- guards de PR-5 ya cortan la entrega en todas las superficies), y export a
-- autoridad (referencias, nunca bytes/PII). El audit_log es el trail inmutable.
--
-- NO se crea una tabla `takedowns` aparte: el estado del takedown ya vive en
-- `content.status='removed'` + `audit_log` (content_removed/takedown_executed) +
-- `moderation_events.resolution`. Sería redundante.
--
-- Espeja `csam_incidents`: RLS deny-all (sólo service-role escribe/lee; el intake
-- va por /api/content/[id]/report y el admin por /api/admin/moderation, ambos con
-- service-role). `content_id` es FK LAXA (ON DELETE SET NULL) para que la queja
-- PERDURE aunque el contenido se borre. NUNCA se cascadea borrado a 2257/evidencia.
--
-- AML/sanciones/PEP + threat-model + hardening = PR-10 (no acá).
-- Idempotente (IF NOT EXISTS).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS moderation_events (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- FK laxa: si el content se borra, la queja perdura con content_id NULL.
  content_id               UUID REFERENCES content(id) ON DELETE SET NULL,
  -- Denormalizado para la cola/export (sobrevive el borrado del content).
  creator_id               UUID,
  -- Quién reportó (si estaba logueado) + IP (anti-abuso / audit). Nunca del body.
  reporter_user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reporter_ip              TEXT,
  category                 TEXT NOT NULL
                             CHECK (category IN ('illegal','dmca','nonconsensual','csam_suspected','spam','other')),
  description              TEXT,
  status                   TEXT NOT NULL DEFAULT 'open'
                             CHECK (status IN ('open','triaging','actioned','dismissed')),
  -- Deadline de SLA (lo setea el intake, escalonado por categoría). Vencido =
  -- status='open' AND sla_due_at < now().
  sla_due_at               TIMESTAMPTZ,
  -- Sellado por el cron cuando una queja VENCIDA ya se auditó+notificó (una sola
  -- vez). NULL = aún no notificada. El cron sólo procesa filas con esto en NULL, así
  -- no re-audita ni re-emailea cada hora la MISMA queja que sigue abierta. La cola de
  -- /admin igual la sigue mostrando overdue-arriba (esa señal no depende de esto).
  sla_breach_notified_at   TIMESTAMPTZ,
  resolution               TEXT CHECK (resolution IN ('takedown','dismissed','escalated_csam')),
  resolved_by              UUID,
  resolved_at              TIMESTAMPTZ,
  authority_export_status  TEXT NOT NULL DEFAULT 'none'
                             CHECK (authority_export_status IN ('none','generated')),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_moderation_events_status  ON moderation_events (status);
CREATE INDEX IF NOT EXISTS idx_moderation_events_content ON moderation_events (content_id);
CREATE INDEX IF NOT EXISTS idx_moderation_events_sla     ON moderation_events (sla_due_at)
  WHERE status = 'open';

-- Idempotente para DBs creadas antes de esta columna (no-op en DB fresca, que ya la
-- trae del CREATE TABLE de arriba). Mantiene el archivo convergente con prod.
ALTER TABLE moderation_events ADD COLUMN IF NOT EXISTS sla_breach_notified_at TIMESTAMPTZ;

-- RLS deny-all: sólo el service-role (que bypassa RLS) escribe/lee. Sin políticas
-- ⇒ anon/authenticated no ven nada (ni una creadora ve las quejas sobre lo suyo,
-- ni un reporter el resultado — sin oráculo). Espeja csam_incidents.
ALTER TABLE moderation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE moderation_events FORCE ROW LEVEL SECURITY;
