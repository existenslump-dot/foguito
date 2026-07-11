-- ═══════════════════════════════════════════════════════════════════════════
-- FOGUITO · PR-1 — posts_publish_guard: pilar #0 sobre el path LEGACY `posts`.
--
-- El engine heredado publica en `posts` (status='published' / is_approved=true),
-- NO en la tabla nueva `content`. content_publish_guard (20260710120000) cubre
-- SOLO `content`, así que hasta que el producto migre a `content` (PR-5) el path
-- de publicación vivo quedaba SIN gate 18+ a nivel DB. Este trigger porta el
-- pilar #0 a `posts`: nada pasa a publicado sin creadora verificada 18+.
--
-- SECURITY DEFINER → corre aunque el escritor sea service-role o admin (p. ej.
-- /api/admin/approve-post): el gate es absoluto, igual que content_publish_guard.
-- Solo coacciona la PUBLICACIÓN real; draft/pending/revision/rejected y
-- is_approved=false pasan sin tocar (una creadora puede tener borradores).
--
-- Idempotente (CREATE OR REPLACE / DROP TRIGGER IF EXISTS).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.posts_publish_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Solo actuamos cuando el row queda en estado publicable y esa transición es
  -- nueva (INSERT, o pasa de no-publicado a publicado, o cambia is_approved).
  IF (NEW.status = 'published' OR NEW.is_approved IS TRUE)
     AND (
       TG_OP = 'INSERT'
       OR OLD.status IS DISTINCT FROM 'published'
       OR OLD.is_approved IS DISTINCT FROM NEW.is_approved
     ) THEN

    IF NOT EXISTS (
      SELECT 1 FROM creators c
      WHERE c.user_id = NEW.user_id
        AND c.kyc_status = 'verified'
        AND c.age_verified = true
    ) THEN
      RAISE EXCEPTION 'posts_publish_guard: creadora % no verificada 18+', NEW.user_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS posts_publish_guard_trg ON posts;
CREATE TRIGGER posts_publish_guard_trg
  BEFORE INSERT OR UPDATE ON posts
  FOR EACH ROW EXECUTE FUNCTION public.posts_publish_guard();

-- La función de trigger no debe ser invocable por RPC (PostgREST expone toda
-- función public). El trigger la corre sin chequear EXECUTE, así que revocar no
-- rompe el gate y cierra la superficie RPC.
REVOKE ALL ON FUNCTION public.posts_publish_guard() FROM public, anon, authenticated;
