-- ═══════════════════════════════════════════════════════════════════════════
-- FOGUITO · PR-3(A) — bucket privado `creator-content` para el media de contenido
--
-- La creadora sube su contenido (imagen/video) a este bucket. A diferencia del
-- media público de Cloudinary del engine heredado, el contenido pago NUNCA es
-- público por URL: es la superficie que el pilar #0 protege (18+ / 2257 / CSAM).
--
-- TODO acceso al bucket es SERVER-SIDE con service-role:
--   · alta   → POST /api/content (requireUser, sube via getSupabaseAdmin()).
--   · review → admin firma una URL efímera via service-role (GET /api/admin/content/[id]).
--   · entrega al fan → PR-5 (URL firmada + watermark, sólo con entitlement).
--
-- Fail-closed: NO creamos policies permisivas sobre storage.objects para este
-- bucket. Con RLS activa (default de Supabase Storage) y sin policy que las
-- habilite, anon/authenticated quedan en DENY-ALL; sólo el service-role (que
-- bypassa RLS) lee/escribe. Así el contenido queda inaccesible por URL hasta
-- que pase CSAM (PR-3) y haya un canal de entrega firmado (PR-5).
--
-- Idempotente (ON CONFLICT DO NOTHING).
-- ═══════════════════════════════════════════════════════════════════════════

-- Bucket privado (public=false). El id/name coinciden con el que consumen
-- src/lib/content.ts + las rutas /api/content y /api/admin/content.
INSERT INTO storage.buckets (id, name, public)
VALUES ('creator-content', 'creator-content', false)
ON CONFLICT (id) DO NOTHING;

-- NB (intencional): sin CREATE POLICY sobre storage.objects para este bucket.
-- Cualquier policy permisiva reabriría la superficie que el pilar #0 cierra.
-- El acceso queda 100% mediado por las rutas server-side con service-role.
