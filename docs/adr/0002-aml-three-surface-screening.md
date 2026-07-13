# 0002 — AML: una puerta (`screenSubject`) para las tres superficies + anti-downgrade

**Status:** Accepted (2026-07, PR-10)

## Context

El criterio de aceptación de compliance exige screening de sanciones en las **tres** superficies:
creadora (onboarding), consumidor (money-in) y payout (money-out). Sin una puerta única, cada call
site llamaría al provider por su cuenta, sin trail común ni política consistente, y sería fácil que
un re-screening con el stub inerte "limpie" a alguien que un vendor real ya marcó `hit`.

## Decision

- **Una sola función `src/lib/aml/screenSubject(admin, {subjectType, subjectId, …})`** por la que
  pasa TODO screening. Hace: (1) llama al provider, (2) inserta el trail append-only en
  `sanctions_screenings` (best-effort), (3) estampa la columna fast-path del sujeto
  (`creators.sanctions_status` o `profiles.consumer_sanctions_status`) — load-bearing, tira si falla.
- **`sanctions_screenings` es deny-all** (RLS forzada, sólo service-role): trail AML + fuente de
  staleness para el rescreening batch.
- **Anti-downgrade:** con el stub (sin vendor cableado), un veredicto `review`/`clear` **NO baja** un
  `hit` ya persistido — sólo un vendor real puede sacar a alguien de `hit`. Espeja el `.neq hit` del
  cron y el "requiere revisión manual para salir".
- **Gate `held_aml`:** el money-in (`purchase_foguitos`) retiene la orden (no acredita) si el
  consumidor es `hit`. El write del flag está guardeado por trigger (el fan no se auto-clarea).

## Consequences

- Trail y política AML consistentes en las tres superficies; auditables.
- Un re-screening accidental con el stub no puede levantar un hold de un sancionado.
- El provider throw se propaga → el caller falla cerrado (502/held), nunca `clear` silencioso.
- Costo: `screenSubject` hace una lectura extra del status persistido cuando el provider no está
  configurado (para el anti-downgrade) — despreciable a la frecuencia de screening.
