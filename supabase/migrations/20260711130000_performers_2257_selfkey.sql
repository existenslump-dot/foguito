-- ═══════════════════════════════════════════════════════════════════════════
-- FOGUITO · PR-2 — registros 2257: key del performer PROPIO (self) + retención
--
-- Sobre performers_2257 (creado en 20260710120000) agrega:
--   1) is_self — marca la fila que corresponde a la PROPIA creadora, auto-
--      completada por el webhook de Didit tras verificar 18+.
--   2) índice único parcial por added_by WHERE is_self — una sola fila self por
--      creadora (backstop anti-duplicado del auto-complete idempotente).
--   3) nota de retención legal (18 U.S.C. § 2257) sobre id_doc_path.
--
-- NO toca content_publish_guard ni los guards existentes.
-- Idempotente (ADD COLUMN IF NOT EXISTS / CREATE UNIQUE INDEX IF NOT EXISTS).
-- ═══════════════════════════════════════════════════════════════════════════

-- is_self: TRUE sólo en la fila 2257 de la propia creadora (auto-completada por
-- el veredicto Didit 18+, service-role → pasa performers_2257_guard). El resto
-- son colaboradores cargados a mano y certificados por el admin.
ALTER TABLE performers_2257
  ADD COLUMN IF NOT EXISTS is_self boolean NOT NULL DEFAULT false;

-- Una única fila self por creadora (added_by). Índice ÚNICO PARCIAL: red de
-- seguridad a nivel DB contra duplicados si dos webhooks concurrentes intentan
-- crear el self performer a la vez.
--
-- ⚠️ NB: un índice único parcial NO es un arbiter válido para el `on_conflict`
-- de PostgREST/supabase-js (Postgres exige el predicado WHERE en la sentencia
-- ON CONFLICT para inferir un índice parcial, y PostgREST sólo emite columnas).
-- Por eso el upsert idempotente del self performer se hace find-or-write en el
-- código (src/lib/performers.ts → ensureSelfPerformerFromDidit); este índice es
-- el backstop, no el mecanismo de upsert.
CREATE UNIQUE INDEX IF NOT EXISTS performers_2257_self_uq
  ON performers_2257 (added_by) WHERE is_self;

-- Retención legal (18 U.S.C. § 2257): los documentos de identidad de los
-- performers 2257 viven en el bucket privado identity-documents bajo el prefijo
-- '<uid>/performers/**' y tienen una ventana de retención LARGA, independiente
-- del cierre de cuenta. Quedan EXCLUIDOS del purge de retención de
-- identity-documents — la exclusión real se implementa en
-- src/lib/identity-retention.ts (Paso 5 del PR-2).
COMMENT ON COLUMN performers_2257.id_doc_path IS
  '2257 ID doc path (private identity-documents bucket) under <uid>/performers/**. EXCLUDED from the identity-retention purge — long legal retention window (18 U.S.C. 2257).';
