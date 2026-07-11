-- PR-5 hardening — el paywall (content_select) no debe regalar el PPV.
--
-- BUG (esquema PR-0): la rama de suscripción de `content_select` habilitaba
-- CUALQUIER pieza publicada de la creadora mientras el fan tuviera UNA suscripción
-- activa — sin mirar `visibility` ni `required_tier`. O sea: una sola suscripción
-- (la más barata) desbloqueaba TODO el catálogo, incluido el contenido
-- `visibility='ppv'` (pago-por-pieza) y cualquier tier. La UI del perfil ya
-- muestra el precio PPV/tier (p. ej. "500 foguitos" / "gold") que la DB no cobraba.
--
-- FIX (mínimo e inequívoco): una suscripción vigente desbloquea SOLO el contenido
-- `visibility='tier'` de la creadora. El PPV es compra POR-PIEZA: exige SIEMPRE su
-- propio `entitlements` (source='ppv'), nunca una suscripción. El `free_preview`
-- sigue público; el entitlement por-pieza sigue desbloqueando la pieza puntual
-- (PPV, tip, o unlock otorgado por suscripción).
--
-- FUERA DE ALCANCE (PR-6): el gating fino por RANGO de tier (que un `bronze` no vea
-- una pieza `required_tier='gold'`) necesita definir el vocabulario de tiers de
-- suscripción de foguito — hoy `subscriptions.tier`/`content.required_tier` son TEXT
-- placeholder sin orden. Se difiere al PR de granting/pricing.
--
-- Idempotente (DROP POLICY IF EXISTS + CREATE). No toca datos.

DROP POLICY IF EXISTS content_select ON content;
CREATE POLICY content_select ON content FOR SELECT
  USING (
    creator_id = auth.uid()
    OR public.is_admin()
    OR (
      status = 'published' AND csam_status = 'pass' AND (
        visibility = 'free_preview'
        OR EXISTS (
          SELECT 1 FROM entitlements e
          WHERE e.fan_id = auth.uid() AND e.content_id = content.id
            AND (e.expires_at IS NULL OR e.expires_at > now())
        )
        OR (
          -- Suscripción vigente ⇒ SOLO contenido 'tier'. El PPV queda afuera:
          -- necesita su entitlement propio (compra por-pieza).
          visibility = 'tier'
          AND EXISTS (
            SELECT 1 FROM subscriptions s
            WHERE s.fan_id = auth.uid() AND s.creator_id = content.creator_id
              AND s.status = 'active' AND (s.expires_at IS NULL OR s.expires_at > now())
          )
        )
      )
    )
  );
