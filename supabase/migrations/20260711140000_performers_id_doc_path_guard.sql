-- ═══════════════════════════════════════════════════════════════════════════
-- FOGUITO · PR-2 (hardening) — performers_2257_guard: acotar id_doc_path.
--
-- Hallazgo de review adversarial (medium): la RLS performers_rw sólo restringe
-- `added_by` (= auth.uid()), NO `id_doc_path`. Un insert directo por SDK
-- (authenticated, sin pasar por /api/performers) podía plantar un id_doc_path
-- apuntando al DNI/selfie de OTRO usuario (`<victimUid>/id_doc.jpg`); al revisar,
-- el admin firmaría ese path y se le serviría el documento de un tercero, además
-- de corromper la procedencia del registro 2257.
--
-- Fix a nivel DB: para escritores NO admin/service-role, coaccionar id_doc_path
-- si no vive bajo la carpeta propia del performer (`<added_by>/performers/…`).
-- El path legítimo lo escribe /api/performers con SERVICE-ROLE (que retorna NEW
-- arriba, sin coacción), así que este guard no afecta el flujo real. Defensa en
-- profundidad junto al chequeo de prefijo en getPerformerForReview.
--
-- Reemplaza la función (CREATE OR REPLACE preserva el REVOKE previo). Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.performers_2257_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF public.is_admin() OR public.is_service_role() THEN
    RETURN NEW;
  END IF;

  -- La creadora (authenticated) NUNCA auto-certifica.
  IF TG_OP = 'INSERT' THEN
    NEW.is_complete  := false;
    NEW.dob_verified := false;
  ELSE
    NEW.is_complete  := OLD.is_complete;
    NEW.dob_verified := OLD.dob_verified;
  END IF;

  -- id_doc_path sólo puede apuntar a `<added_by>/performers/…` (su propia carpeta).
  IF NEW.id_doc_path IS NOT NULL
     AND NEW.id_doc_path NOT LIKE (NEW.added_by::text || '/performers/%') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.id_doc_path := NULL;              -- descarta el path ajeno
    ELSE
      NEW.id_doc_path := OLD.id_doc_path;   -- no permite repuntarlo a un doc ajeno
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
