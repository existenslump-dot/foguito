import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { getLegalIdentity, LEGAL_TEMPLATE_NOTICE } from '@/lib/legal'

export const metadata: Metadata = {
  title: 'Política de Privacidad',
  description:
    'Política de Privacidad del marketplace: qué datos se recopilan, finalidades y bases de tratamiento, terceros, conservación, seguridad y derechos de los titulares. Plantilla legal genérica para revisar y adaptar con tu asesor legal.',
  robots: { index: true, follow: true },
}

function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <h2
        className="text-[var(--v-text-primary)]"
        style={{
          fontFamily: 'var(--v-font-serif)',
          fontSize: 'clamp(20px, 3vw, 26px)',
          fontWeight: 500,
          letterSpacing: 'var(--v-ls-serif)',
          lineHeight: 1.25,
        }}
      >
        <span className="text-[var(--v-accent-strong)]">{n}.</span> {title}
      </h2>
      <div
        className="mt-3 space-y-3 text-[var(--v-text-secondary)]"
        style={{ fontFamily: 'var(--v-font-ui)', fontSize: '15px', lineHeight: 1.8 }}
      >
        {children}
      </div>
    </section>
  )
}

export default function PrivacidadPage() {
  const { brand, domain, email, year } = getLegalIdentity()

  return (
    <main
      className="min-h-screen"
      style={{ background: 'var(--v-bg-base)', color: 'var(--v-text-primary)' }}
    >
      <div className="mx-auto max-w-3xl px-6 py-16">
        {/* Template disclaimer — muted, non-dominant. */}
        <div
          role="note"
          className="mb-10 rounded-[var(--v-radius-sm)] border px-4 py-3"
          style={{
            borderColor: 'var(--v-border-accent)',
            background: 'var(--v-accent-subtle)',
            fontFamily: 'var(--v-font-ui)',
            fontSize: '12px',
            lineHeight: 1.6,
            color: 'var(--v-text-tertiary)',
          }}
        >
          {LEGAL_TEMPLATE_NOTICE}
        </div>

        <p
          className="text-[var(--v-accent-strong)]"
          style={{
            fontFamily: 'var(--v-font-ui)',
            fontSize: '10px',
            letterSpacing: 'var(--v-ls-label)',
            textTransform: 'uppercase',
          }}
        >
          Legal
        </p>
        <h1
          className="mt-3 text-[var(--v-text-primary)]"
          style={{
            fontFamily: 'var(--v-font-serif)',
            fontSize: 'clamp(32px, 5vw, 48px)',
            fontWeight: 500,
            lineHeight: 1.1,
            letterSpacing: 'var(--v-ls-serif)',
          }}
        >
          Política de Privacidad
        </h1>
        <p
          className="mt-3 text-[var(--v-text-tertiary)]"
          style={{ fontFamily: 'var(--v-font-ui)', fontSize: '13px' }}
        >
          Última actualización: {year} · {brand}
        </p>

        <div
          className="mt-6 space-y-3 text-[var(--v-text-secondary)]"
          style={{ fontFamily: 'var(--v-font-ui)', fontSize: '15px', lineHeight: 1.8 }}
        >
          <p>
            En {brand} ({domain}) valoramos tu privacidad. Esta Política explica qué datos personales
            tratamos, con qué fines, sobre qué base de tratamiento, con quién los compartimos, durante
            cuánto tiempo los conservamos y qué derechos tenés. Te recomendamos leerla junto con
            nuestros Términos y Condiciones.
          </p>
        </div>

        <Section n={1} title="Responsable del tratamiento">
          <p>
            El responsable del tratamiento de los datos descritos en esta Política es{' '}
            <strong>{brand}</strong>, con domicilio en <strong>[domicilio del responsable]</strong>.
            Para cualquier consulta sobre privacidad o el ejercicio de tus derechos podés
            contactarnos en{' '}
            <a href={`mailto:${email}`} className="underline" style={{ color: 'var(--v-accent-strong)' }}>
              {email}
            </a>
            . Completá los campos entre corchetes con los datos reales del responsable antes de
            publicar este documento.
          </p>
        </Section>

        <Section n={2} title="Datos que recopilamos">
          <div>
            <p>Según cómo uses la Plataforma, podemos tratar las siguientes categorías de datos:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                <strong>Datos de cuenta:</strong> nombre o seudónimo, correo electrónico, contraseña
                (almacenada de forma cifrada) y preferencias de cuenta.
              </li>
              <li>
                <strong>Datos de perfil:</strong> información adicional que decidís agregar a tu
                perfil, como descripción, ubicación general o datos de contacto.
              </li>
              <li>
                <strong>Contenido de publicaciones (listings):</strong> textos, imágenes, precios,
                datos de contacto y demás información que decidís publicar.
              </li>
              <li>
                <strong>Otro contenido que generás:</strong> archivos, imágenes y materiales que
                cargás a la Plataforma.
              </li>
              <li>
                <strong>Datos de uso y de dispositivo:</strong> dirección IP, tipo de dispositivo,
                sistema operativo y navegador, páginas vistas, interacciones, fechas y horas de
                acceso, e identificadores técnicos similares.
              </li>
              <li>
                <strong>Comunicaciones:</strong> los mensajes que nos enviás (por ejemplo, a soporte)
                y, cuando corresponda, los intercambios facilitados a través de la Plataforma.
              </li>
              <li>
                <strong>Datos de pago:</strong> los procesa el proveedor de pagos; nosotros
                conservamos únicamente referencias mínimas (por ejemplo, estado de la transacción o
                identificador de pago), no los datos completos de tu tarjeta o instrumento.
              </li>
              <li>
                <strong>Documentos de verificación (si aplica):</strong> cuando se ofrece un proceso
                de verificación de identidad, los documentos que aportes voluntariamente.
              </li>
            </ul>
          </div>
        </Section>

        <Section n={3} title="Finalidades y base de tratamiento">
          <div>
            <p>Tratamos tus datos para las siguientes finalidades, sobre las bases que se indican:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                <strong>Operar la Plataforma</strong> (crear y administrar tu cuenta, publicar tus
                avisos, conectar Publicantes con Interesados) — base: <em>ejecución del contrato</em>.
              </li>
              <li>
                <strong>Procesar pagos, planes y suscripciones</strong> — base: <em>ejecución del
                contrato</em> y <em>cumplimiento de obligaciones legales</em> (por ejemplo,
                contables o fiscales).
              </li>
              <li>
                <strong>Brindar soporte</strong> y responder tus consultas — base: <em>ejecución del
                contrato</em> e <em>interés legítimo</em>.
              </li>
              <li>
                <strong>Seguridad, prevención de fraude y moderación</strong> de contenido — base:
                {' '}<em>interés legítimo</em> y <em>cumplimiento de obligaciones legales</em>.
              </li>
              <li>
                <strong>Verificación de identidad</strong>, cuando participás en ese proceso — base:
                {' '}tu <em>consentimiento</em> y/o <em>interés legítimo</em> en la confianza de la
                Plataforma.
              </li>
              <li>
                <strong>Comunicaciones opcionales</strong> (novedades, marketing) — base: tu{' '}
                <em>consentimiento</em>, que podés retirar en cualquier momento.
              </li>
              <li>
                <strong>Mejorar y analizar</strong> el servicio — base: <em>interés legítimo</em>.
              </li>
            </ul>
            <p className="mt-2">
              Las bases concretas se aplican conforme a la normativa de protección de datos aplicable
              en tu jurisdicción.
            </p>
          </div>
        </Section>

        <Section n={4} title="Terceros y encargados de tratamiento">
          <div>
            <p>
              Para operar la Plataforma recurrimos a proveedores que actúan por nuestra cuenta y
              conforme a nuestras instrucciones. Describimos las categorías de proveedores, sin que su
              mención implique una obligación de usar un proveedor en particular:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                <strong>Hosting, base de datos e infraestructura</strong> (alojamiento de la
                aplicación y de los datos, por ejemplo mediante un proveedor de backend gestionado);
              </li>
              <li>
                <strong>Almacenamiento de medios y CDN</strong> (alojamiento, optimización y entrega
                de imágenes y archivos);
              </li>
              <li><strong>Procesadores de pago</strong> (gestión de cobros y suscripciones);</li>
              <li>
                <strong>Proveedores de correo electrónico</strong> (envío de notificaciones y mensajes
                transaccionales);
              </li>
              <li>
                <strong>Analítica y observabilidad</strong> (métricas de uso, registro de errores y
                rendimiento);
              </li>
              <li>
                <strong>Protección y captcha</strong> (prevención de abuso, spam y actividad
                automatizada).
              </li>
            </ul>
            <p className="mt-2">
              No vendemos tus datos personales. Solo los compartimos con terceros cuando es necesario
              para prestar el servicio, con tu consentimiento o cuando lo exija una autoridad
              competente conforme a la ley aplicable. Cada deployment debe completar la lista concreta
              de proveedores y las garantías correspondientes.
            </p>
          </div>
        </Section>

        <Section n={5} title="Transferencias internacionales">
          <p>
            Algunos de nuestros proveedores pueden tratar datos en servidores ubicados fuera de tu
            país. Cuando ello ocurra, procuramos que la transferencia cuente con garantías adecuadas
            conforme a la normativa de protección de datos aplicable (por ejemplo, cláusulas
            contractuales u otros mecanismos reconocidos), de modo que tus datos mantengan un nivel de
            protección razonable.
          </p>
        </Section>

        <Section n={6} title="Cookies y tecnologías similares">
          <p>
            Utilizamos cookies y tecnologías similares para mantener tu sesión, recordar tus
            preferencias, velar por la seguridad y entender cómo se usa la Plataforma. Algunas son
            necesarias para el funcionamiento del servicio; otras son opcionales (por ejemplo, de
            analítica) y se utilizan según corresponda conforme a la normativa aplicable. Podés
            gestionar las cookies desde la configuración de tu navegador; deshabilitar algunas puede
            afectar el funcionamiento del servicio.
          </p>
        </Section>

        <Section n={7} title="Conservación y purga de datos">
          <p>
            Conservamos tus datos mientras tu cuenta esté activa y durante el tiempo necesario para
            cumplir los fines descritos o las obligaciones legales aplicables. Al cerrar tu cuenta,
            eliminamos o anonimizamos tus datos en un plazo razonable, salvo aquellos que debamos
            retener por motivos legales (por ejemplo, registros contables) o para resolver disputas y
            hacer cumplir nuestros acuerdos.
          </p>
          <p>
            En particular, cuando exista un proceso de verificación, los{' '}
            <strong>documentos de verificación se purgan automáticamente tras el cierre de la
            cuenta</strong>: el sistema elimina los archivos del almacenamiento privado dentro del
            período de retención configurado, sin necesidad de una solicitud manual.
          </p>
        </Section>

        <Section n={8} title="Derechos de los titulares">
          <div>
            <p>
              Conforme a la normativa de protección de datos aplicable, podés ejercer, según
              corresponda, los siguientes derechos sobre tus datos:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li><strong>Acceso:</strong> saber qué datos tuyos tratamos y obtener una copia.</li>
              <li><strong>Rectificación:</strong> corregir datos inexactos o incompletos.</li>
              <li><strong>Supresión:</strong> solicitar la eliminación de tus datos cuando proceda.</li>
              <li><strong>Oposición:</strong> oponerte a ciertos tratamientos basados en interés legítimo.</li>
              <li><strong>Limitación:</strong> pedir que se restrinja el tratamiento en determinados casos.</li>
              <li><strong>Portabilidad:</strong> recibir tus datos en un formato estructurado y de uso común.</li>
            </ul>
            <p className="mt-2">
              Para ejercerlos, escribinos a{' '}
              <a href={`mailto:${email}`} className="underline" style={{ color: 'var(--v-accent-strong)' }}>
                {email}
              </a>
              . También podés eliminar tu cuenta desde tu configuración o solicitándolo por esa vía.
              Cuando lo permita la normativa aplicable, podés presentar un reclamo ante la autoridad
              de control competente.
            </p>
          </div>
        </Section>

        <Section n={9} title="Seguridad">
          <p>
            Aplicamos medidas técnicas y organizativas razonables para proteger tus datos frente a
            accesos no autorizados, pérdida o alteración, incluyendo cifrado en tránsito, control de
            accesos y almacenamiento privado para documentos sensibles. Ningún sistema es
            completamente infalible, por lo que no podemos garantizar seguridad absoluta.
          </p>
        </Section>

        <Section n={10} title="Menores de edad">
          <p>
            La Plataforma no está dirigida a menores de edad y no recopilamos de forma consciente
            datos de personas que no alcancen la edad mínima requerida en su jurisdicción. Cuando la
            Plataforma se ofrezca únicamente a personas mayores de edad (por ejemplo, mediante un
            control de edad), el uso queda reservado a quienes cumplan ese requisito. Si creés que un
            menor nos proporcionó datos, contactanos para eliminarlos.
          </p>
        </Section>

        <Section n={11} title="Cambios a esta Política">
          <p>
            Podemos actualizar esta Política para reflejar cambios en el servicio o en la normativa
            aplicable. Publicaremos la versión vigente en esta página e indicaremos su fecha de
            actualización. Cuando los cambios sean sustanciales, procuraremos avisarte por medios
            razonables.
          </p>
        </Section>

        <Section n={12} title="Contacto del responsable">
          <p>
            Para consultas sobre privacidad o el ejercicio de tus derechos, escribinos a{' '}
            <a href={`mailto:${email}`} className="underline" style={{ color: 'var(--v-accent-strong)' }}>
              {email}
            </a>
            .
          </p>
          <p className="text-[var(--v-text-tertiary)]" style={{ fontSize: '13px' }}>
            Versión vigente desde {year}.
          </p>
        </Section>
      </div>
    </main>
  )
}
