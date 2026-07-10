import type { Metadata } from 'next'
import FAQ from '@/lib/chat-faq'

// Server component — the FAQ content is static (sourced from the generic
// Q&A list in `@/lib/chat-faq`), so it renders on the server with no client
// JS. The accordion uses native <details>/<summary> for accessibility and
// zero-runtime expand/collapse. Light theme, blue accent via `--v-*` tokens.

export const metadata: Metadata = {
  title: 'Preguntas frecuentes — Marketplace',
  description:
    'Respuestas a las dudas más comunes sobre cómo publicar, gestionar y contratar servicios en Marketplace: anuncios, fotos, verificación, pagos, seguridad y datos.',
}

export default function FAQPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <header className="mb-10 text-center">
        <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[9px] font-medium tracking-[.32em] uppercase text-[var(--v-accent-strong)] mb-3">
          Ayuda
        </p>
        <h1
          className="font-light text-[var(--v-text-primary)]"
          style={{
            fontFamily: 'var(--font-serif), Georgia, serif',
            fontSize: 'clamp(32px, 6vw, 48px)',
            lineHeight: 1.15,
          }}
        >
          Preguntas frecuentes
        </h1>
        <p className="mt-4 font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[14px] leading-[1.6] text-[var(--v-text-secondary)]">
          Encontrá respuestas rápidas sobre cómo usar Marketplace. ¿No está
          tu duda? Escribinos por WhatsApp y te guiamos paso a paso.
        </p>
      </header>

      <ul className="flex flex-col gap-3 list-none p-0 m-0">
        {FAQ.map((item) => (
          <li key={item.question}>
            <details className="group rounded-[8px] border border-[var(--v-border)] bg-[var(--v-bg-card)] px-5 py-1 open:border-[var(--v-border-accent)] transition-colors">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[15px] font-medium text-[var(--v-text-primary)] [&::-webkit-details-marker]:hidden">
                {item.question}
                <span
                  aria-hidden="true"
                  className="shrink-0 text-[var(--v-accent-strong)] text-[18px] leading-none transition-transform group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p className="pb-5 pr-8 font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[13.5px] leading-[1.7] text-[var(--v-text-secondary)]">
                {item.answer}
              </p>
            </details>
          </li>
        ))}
      </ul>
    </main>
  )
}
