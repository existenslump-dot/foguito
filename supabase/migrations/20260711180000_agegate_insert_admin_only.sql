-- ═══════════════════════════════════════════════════════════════════════════
-- FOGUITO · PR-4 — age_gate_verifications: cerrar la AUTO-DECLARACIÓN.
--
-- El baseline (20260710120000) creó agegate_insert con:
--   WITH CHECK (user_id = auth.uid() OR public.is_admin())
-- es decir, el propio FAN podía insertar su fila de "verificación" por PostgREST
-- directo (SDK) — una AUTO-DECLARACIÓN de edad, exactamente lo que el pilar #0
-- prohíbe. La verificación de edad del consumidor debe ser REAL (proveedor
-- Didit/Yoti), nunca un checkbox ni un insert del cliente.
--
-- Fix: la ÚNICA vía legítima de escribir una fila 'verificada' es el webhook
-- server-authoritative (src/app/api/webhooks/age-verify/route.ts), que corre con
-- el service-role (getSupabaseAdmin) y BYPASSA RLS — no necesita esta policy.
-- Por eso restringimos agegate_insert a admin-only: cierra el insert directo del
-- fan sin estorbar al webhook (service-role) ni al admin.
--
-- NB: agegate_select queda INTACTA (el fan sigue leyendo lo suyo; admin todo) —
-- la lee el gate para decidir el paso. Solo tocamos el INSERT.
--
-- Idempotente (DROP POLICY IF EXISTS / CREATE POLICY).
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS agegate_insert ON public.age_gate_verifications;
CREATE POLICY agegate_insert ON public.age_gate_verifications
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
