'use client'
import { useLang } from '@/contexts/LanguageContext'
import { t, type TKey } from '@/lib/i18n'

/**
 * The `feed_faq_*` strings must stay word-for-word in sync with
 * `cityFaqQuestions()` in lib/seo.ts (the JSON-LD source) so the visible
 * text and the FAQPage schema match.
 */
export default function CityFaq({ cityName }: { cityName: string }) {
  const { lang } = useLang()
  const faqs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(n => ({
    q: t(lang, `feed_faq_q${n}` as TKey, { city: cityName }),
    a: t(lang, `feed_faq_a${n}` as TKey, { city: cityName }),
  }))
  return (
    <section
      aria-labelledby="city-faq-heading"
      className="mx-auto max-w-[680px] px-6 pb-12 pt-8 border-t border-[rgba(37,99,235,0.08)]"
    >
      <h2
        id="city-faq-heading"
        className="text-center font-['Cormorant_Garamond','Playfair_Display',serif] text-[clamp(20px,2.5vw,26px)] font-medium text-[var(--v-accent)] leading-[1.15]"
      >
        Preguntas <em className="not-italic">frecuentes</em>
      </h2>
      <p className="text-center mt-1 mb-5 font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[12px] text-[var(--v-text-tertiary)]">
        {cityName} · {faqs.length} preguntas
      </p>
      <div className="flex flex-col gap-1.5">
        {faqs.map((faq, i) => (
          <details
            key={i}
            className="group rounded-lg border border-[rgba(37,99,235,0.08)] bg-[rgba(184,178,168,0.03)] open:bg-[rgba(37,99,235,0.06)] open:border-[rgba(37,99,235,0.32)] transition-colors"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[13px] font-medium text-[var(--v-text-primary)] group-open:text-[var(--v-accent)] leading-[1.3]">
              <span>{faq.q}</span>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-3 h-3 flex-shrink-0 text-[var(--v-accent)] transition-transform group-open:rotate-180"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </summary>
            <p className="px-4 pb-4 font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[12.5px] leading-[1.6] text-[var(--v-text-secondary)] font-light">
              {faq.a}
            </p>
          </details>
        ))}
      </div>
    </section>
  )
}
