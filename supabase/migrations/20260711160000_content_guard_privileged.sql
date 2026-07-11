-- ═══════════════════════════════════════════════════════════════════════════
-- FOGUITO · Option A (hardening) — content_guard_privileged.
--
-- Hallazgo de review adversarial (CRITICAL): la tabla `content` NO tenía guard
-- de columnas privilegiadas (a diferencia de `creators`/`performers_2257`). La
-- RLS content_insert/content_update sólo chequea `creator_id = auth.uid()`, así
-- que una creadora verificada podía, por el SDK directo (sin pasar por
-- /api/content), setear `csam_status='pass'` ELLA MISMA, linkear su performer
-- self y hacer UPDATE status='published' — content_publish_guard confía en
-- NEW.csam_status y lo dejaba pasar. Resultado: contenido PUBLICADO sin escaneo
-- CSAM ni revisión admin. Rompe el pilar #0.
--
-- Sibling (MEDIUM): `media_ref` sin acotar (mismo hueco que id_doc_path en PR-2)
-- → un insert directo podía referenciar media de OTRA creadora; el admin lo
-- firmaría al revisar y (latente-HIGH) la entrega de PR-5 lo serviría a fans.
--
-- Fix (el patrón que ya existe en el repo — espejo de creators_guard_privileged
-- / performers_2257_guard): para escritores NO admin/service-role, coaccionar
-- las columnas sensibles. csam_status/status/published_at sólo los mueven el
-- scanner (PR-3), el admin y las rutas service-role. La creación legítima pasa
-- por /api/content con service-role (retorna NEW arriba, sin coacción).
--
-- content_publish_guard queda intacto — este guard hace que su chequeo de
-- csam_status='pass' sea REAL (sólo el scanner/service-role puede setearlo).
--
-- Idempotente (CREATE OR REPLACE / DROP TRIGGER IF EXISTS).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.content_guard_privileged()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF public.is_admin() OR public.is_service_role() THEN
    RETURN NEW;
  END IF;

  -- La creadora (authenticated, SDK directo) NUNCA puede: auto-certificar CSAM,
  -- avanzar el workflow, auto-publicar, ni referenciar media fuera de su prefijo.
  IF TG_OP = 'INSERT' THEN
    NEW.csam_status     := 'pending';
    NEW.csam_scanned_at := NULL;
    NEW.status          := 'uploaded';
    NEW.published_at    := NULL;
    IF NEW.media_ref IS NOT NULL
       AND NEW.media_ref NOT LIKE (NEW.creator_id::text || '/%') THEN
      NEW.media_ref := NULL;
    END IF;
  ELSE
    NEW.csam_status     := OLD.csam_status;
    NEW.csam_scanned_at := OLD.csam_scanned_at;
    NEW.status          := OLD.status;
    NEW.published_at    := OLD.published_at;
    IF NEW.media_ref IS NOT NULL
       AND NEW.media_ref NOT LIKE (NEW.creator_id::text || '/%') THEN
      NEW.media_ref := OLD.media_ref;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS content_guard_privileged_trg ON content;
CREATE TRIGGER content_guard_privileged_trg
  BEFORE INSERT OR UPDATE ON content
  FOR EACH ROW EXECUTE FUNCTION public.content_guard_privileged();

-- No invocable por RPC (el trigger la corre sin chequear EXECUTE).
REVOKE ALL ON FUNCTION public.content_guard_privileged() FROM public, anon, authenticated;
