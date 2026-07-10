import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Contacto · Marketplace',
  description:
    'Escribinos para soporte, publicaciones o alianzas. Respondemos en menos de 24 horas hábiles.',
  alternates: { canonical: '/contacto' },
  openGraph: {
    title: 'Contacto · Marketplace',
    description: 'Canal directo con el equipo de Marketplace — soporte, publicaciones y prensa.',
    url: '/contacto',
    type: 'website',
  },
  robots: { index: true, follow: true },
}

export default function ContactoLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
