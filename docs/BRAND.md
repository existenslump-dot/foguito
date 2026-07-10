# Foguito × NihilVision — Design tokens

Fuente: `foguito-design-system-v1.html`. Regla rectora: **cara pop adelante, compliance
invisible atrás.** Dark por default + toggle light (persistir en localStorage).

## Color

| Token | Hex | Uso |
|-------|-----|-----|
| `--ember` | `#FF5330` | acento primario, fuego |
| `--flame` | `#FFB338` | acento cálido, precios/temperatura |
| `--magenta` | `#FF2E7E` | acento secundario, fin del gradiente |
| `--grad` | `linear-gradient(135deg,#FF5330,#FF2E7E)` | botones primary, CTA |
| `--grad-fire` | `linear-gradient(180deg,#FFB338,#FF5330 58%,#FF2E7E)` | wordmark "o", glow |
| `--wine` | `#3A0E26` | **pupila del ojo** (nunca negro puro) |
| `--night` | `#17101A` | **bg dark (default)** |
| `--void` | `#0E0A11` | fondo de NihilVision (matriz) |
| `--cream` | `#FFF3E9` | texto sobre dark, núcleo del ojo |
| bg light | `#FFF6EF` | fondo modo claro |
| ink light | `#2A181D` | texto modo claro |

Dark: `--surface:#241823` · `--bg-3:#2C1E2A` · `--line:rgba(255,179,56,.16)`.

## Tipografía (Google Fonts)

| Rol | Familia | Pesos |
|-----|---------|-------|
| Display Foguito | **Unbounded** | 600/700/800/900 |
| Matriz (NihilVision) | **Space Grotesk** | 700 · UPPERCASE |
| Body | **DM Sans** | 400/500/700 |
| Utilidad / mono | **DM Mono** | 400/500 |

Cargar con `next/font/google` (recomendado) o self-host en `public/fonts/`.
**No usar Fraunces** (esa es la voz fría del memo de estructura, no de Foguito).

## Logo — reglas duras

- **Ninguna versión va sin ojo.** Gota sola = Tinder → prohibida en todo tamaño (incl. favicon).
- Logo detallado (hero/lockup) = **núcleo = ojo**, pupila `--wine`.
- App-icon / favicon = **A · ojo-lente** (forma simplificada, knockout una tinta).
- Estado "en vivo" (creadora online) = **ojo más abierto**.
- NihilVision = ojo vertical en gota, line-art, glitch ember+magenta, sobre `--void`.
- Nada de negro puro en el ícono → usar `--wine`.

## Voz

Habla como el fan, no como el abogado. Metáfora de fuego consistente:
**prendé** (suscribir) · **mandá un foguito** (propina/PPV) · **a todo fuego** (tier top) ·
**se apagó** (vencida). Regla de oro: *si una feature no se puede decir con fuego, no se llama así.*

## Tiers = temperatura

`Tibio` (entrada/previews) → `Caliente` (suscripción base) → `Ardiendo` (PPV+mensajes) →
`A todo fuego` (trato exclusivo).
