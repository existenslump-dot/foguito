# Foguito — Manifiesto de assets a cargar

Nombres y rutas exactas de los archivos a subir en `public/`. Convención tomada de
Velora+ (`public/images/*`) para que el porte de `next.config.ts` / `site.webmanifest` /
`<Head>` sea 1:1.

**Estado:** `✅ incluido` = ya está en el repo (SVG master generado desde el design system).
`⬆️ subir` = lo tenés que generar/exportar y subir. `♻️ velora` = existe en Velora+, se
re-brandea.

## 1. Marca / logos (SVG master)

| Ruta | Propósito | Spec | Estado |
|------|-----------|------|:------:|
| `public/brand/logo-foguito.svg` | Logo primario (núcleo=ojo, pupila wine). Hero/lockup/full-color | vector 100×125 | ✅ incluido |
| `public/brand/icon-foguito.svg` | App-icon maskable (ojo-lente, cuadrado gradiente) | vector 100×100 | ✅ incluido |
| `public/brand/favicon-foguito.svg` | Favicon mono (ember + ojo wine) | vector 100×125 | ✅ incluido |
| `public/brand/logo-nihilvision.svg` | Matriz line-art glitch. Footer "una propiedad de NihilVision" | vector 100×130 | ✅ incluido |
| `public/brand/wordmark-foguito.svg` | Wordmark "foguito" (Unbounded, "o" con grad-fire) | vector | ⬆️ subir |
| `public/brand/lockup-foguito.svg` | Ícono + wordmark horizontal (nav) | vector | ⬆️ subir |

## 2. Favicons / PWA (exportar de los SVG master)

| Ruta | Propósito | Spec | Estado |
|------|-----------|------|:------:|
| `public/favicon.ico` | Favicon clásico (multi-size 16/32/48) | .ico | ⬆️ subir |
| `public/images/favicon-32x32.png` | Favicon 32 | 32×32 PNG | ⬆️ subir |
| `public/images/favicon-16x16.png` | Favicon 16 | 16×16 PNG | ⬆️ subir |
| `public/images/apple-touch-icon.png` | Icono iOS | 180×180 PNG | ⬆️ subir |
| `public/images/icon-192x192.png` | PWA | 192×192 PNG | ⬆️ subir |
| `public/images/icon-512x512.png` | PWA | 512×512 PNG | ⬆️ subir |
| `public/images/icon-512x512-maskable.png` | PWA maskable (safe-zone) | 512×512 PNG | ⬆️ subir |
| `public/images/site.webmanifest` | Manifest PWA (`theme_color`/`background_color` = `#17101A`, name "Foguito") | JSON | ⬆️ subir |

## 3. Social / Open Graph

| Ruta | Propósito | Spec | Estado |
|------|-----------|------|:------:|
| `public/images/og-image.jpg` | OG default (hero fuego + wordmark) | 1200×630 JPG | ⬆️ subir |
| `public/images/og-creadora-fallback.jpg` | OG fallback perfil (sin filtrar contenido adulto) | 1200×630 JPG | ⬆️ subir |

> OG dinámico por perfil se genera con `/api/og` (patrón de Velora+, `@vercel/og`) —
> **nunca** exponer un thumbnail explícito en el OG (SFW siempre).

## 4. Landing / marketing

| Ruta | Propósito | Spec | Estado |
|------|-----------|------|:------:|
| `public/images/hero-glow.webp` | Glow de fuego detrás del hero | ~1600px WEBP | ⬆️ subir |
| `public/images/hero-poster.jpg` | Poster del hero (fallback de video) | 1600×900 JPG | ⬆️ subir |
| `public/images/paso-prende.svg` | Ícono "Prendé" (cómo funciona) | vector | ⬆️ subir |
| `public/images/paso-foguito.svg` | Ícono "Mandá un foguito" | vector | ⬆️ subir |
| `public/images/paso-fuego.svg` | Ícono "A todo fuego" | vector | ⬆️ subir |

## 5. Fuentes (self-host opcional)

Recomendado: `next/font/google` (Unbounded, Space Grotesk, DM Sans, DM Mono) → sin archivos.
Si self-host (como `public/fonts/switzer/` en Velora+):

```
public/fonts/unbounded/unbounded-{600,700,800,900}.woff2
public/fonts/space-grotesk/space-grotesk-700.woff2
public/fonts/dm-sans/dm-sans-{400,500,700}.woff2
public/fonts/dm-mono/dm-mono-{400,500}.woff2
```

## 6. Iconografía funcional (♻️ re-brandear de Velora+)

| Ruta | Nota |
|------|------|
| `public/images/verificado.png` | Badge verificado 18+ (re-tintar a ember/flame) |
| `public/images/{argentina,brasil,chile}.png` | Banderas para el selector de jurisdicción del age-gate |
| `public/images/telegram.png`, `whatsapp.png` | Solo si el contacto directo aplica (probablemente NO en Foguito: el chat es interno) |

---

### Cómo exportar los PNG desde el SVG master

```bash
# requiere rsvg-convert (librsvg) o inkscape
rsvg-convert -w 512 -h 512 public/brand/icon-foguito.svg  > public/images/icon-512x512.png
rsvg-convert -w 192 -h 192 public/brand/icon-foguito.svg  > public/images/icon-192x192.png
rsvg-convert -w 180 -h 180 public/brand/icon-foguito.svg  > public/images/apple-touch-icon.png
rsvg-convert -w 32  -h 32  public/brand/favicon-foguito.svg > public/images/favicon-32x32.png
rsvg-convert -w 16  -h 16  public/brand/favicon-foguito.svg > public/images/favicon-16x16.png
# favicon.ico (multi-size) con ImageMagick:
convert public/images/favicon-16x16.png public/images/favicon-32x32.png public/favicon.ico
```
