import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { getLegalIdentity, LEGAL_TEMPLATE_NOTICE } from '@/lib/legal'

export const metadata: Metadata = {
  title: 'Términos y Condiciones',
  description:
    'Términos y Condiciones de uso del marketplace: rol de intermediario, reglas de publicación, planes y pagos, moderación y responsabilidad. Plantilla legal genérica para revisar y adaptar con tu asesor legal.',
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

export default function TerminosPage() {
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
          Términos y Condiciones
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
            Estos Términos y Condiciones (los &laquo;Términos&raquo;) regulan el acceso y uso de la
            plataforma operada por {brand} (en adelante, &laquo;{brand}&raquo;, &laquo;la
            Plataforma&raquo; o &laquo;nosotros&raquo;), disponible en {domain} y sus subdominios,
            así como de los sitios, aplicaciones y servicios asociados. Estos Términos constituyen
            un acuerdo legalmente vinculante entre vos y {brand}. Te recomendamos leerlos junto con
            nuestra Política de Privacidad.
          </p>
        </div>

        <Section n={1} title="Definiciones">
          <div>
            <p>A los fines de estos Términos:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                <strong>Plataforma:</strong> el sitio web, las aplicaciones y los servicios operados
                por {brand}.
              </li>
              <li>
                <strong>Usuario:</strong> toda persona que accede o utiliza la Plataforma, registrada
                o no.
              </li>
              <li>
                <strong>Publicante:</strong> el Usuario que crea publicaciones, avisos o listings
                ofreciendo productos, servicios o información.
              </li>
              <li>
                <strong>Interesado:</strong> el Usuario que consulta publicaciones y busca contactar
                o contratar a un Publicante.
              </li>
              <li>
                <strong>Publicación o listing:</strong> el contenido cargado por un Publicante,
                incluidos textos, imágenes, precios y datos de contacto.
              </li>
              <li>
                <strong>Contenido:</strong> cualquier dato, texto, imagen, archivo o material
                cargado, transmitido o exhibido en la Plataforma.
              </li>
              <li>
                <strong>Cuenta:</strong> el registro personal que habilita el acceso a determinadas
                funciones.
              </li>
            </ul>
          </div>
        </Section>

        <Section n={2} title="Aceptación de los Términos">
          <p>
            Al registrarte, acceder o utilizar la Plataforma, declarás haber leído, comprendido y
            aceptado estos Términos en su totalidad, junto con las políticas que los complementan. Si
            no estás de acuerdo con alguna de sus cláusulas, no debés utilizar la Plataforma.
          </p>
          <p>
            Podemos exigir, en ciertos momentos, una aceptación expresa de estos Términos o de sus
            actualizaciones como condición para seguir utilizando determinadas funciones.
          </p>
        </Section>

        <Section n={3} title="Elegibilidad y registro de cuenta">
          <p>
            Para usar la Plataforma debés tener capacidad legal para contratar conforme a la
            normativa aplicable en tu jurisdicción. Cuando la Plataforma se ofrezca únicamente a
            personas mayores de edad, declarás cumplir con la edad mínima requerida. Si utilizás la
            Plataforma en nombre de una persona jurídica, declarás contar con facultades suficientes
            para obligarla.
          </p>
          <p>
            Algunas funciones requieren crear una Cuenta. Te comprometés a brindar información veraz,
            completa y actualizada, y a mantenerla así. Sos responsable de la confidencialidad de tus
            credenciales y de toda actividad realizada desde tu Cuenta. Notificanos de inmediato ante
            cualquier uso no autorizado o sospecha de compromiso de seguridad. Cada Usuario puede
            mantener una única Cuenta, salvo autorización expresa.
          </p>
        </Section>

        <Section n={4} title="Rol del marketplace">
          <p>
            {brand} es un marketplace que funciona como punto de encuentro e intermediario técnico:
            conecta a los Publicantes con los Interesados y pone a disposición las herramientas para
            publicar, buscar y contactar.
          </p>
          <p>
            {brand} <strong>no es parte</strong> de los acuerdos, transacciones, contratos ni
            relaciones que se generen entre Publicantes e Interesados. No provee directamente los
            bienes o servicios anunciados, no interviene en la negociación, el pago o la entrega, y no
            garantiza la calidad, legalidad, veracidad, seguridad ni disponibilidad de lo publicado.
            Cualquier acuerdo se celebra exclusivamente entre las partes involucradas y bajo su
            responsabilidad. {brand} no actúa como agente, representante ni fiador de ningún Usuario.
          </p>
        </Section>

        <Section n={5} title="Obligaciones de los Publicantes">
          <div>
            <p>Al publicar contenido, el Publicante se obliga a:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                brindar información <strong>veraz, exacta y actualizada</strong>, que no induzca a
                error sobre el producto, servicio, precio o condiciones;
              </li>
              <li>
                publicar solo contenido <strong>lícito</strong> y conforme a la normativa aplicable a
                su actividad, incluidas las autorizaciones, habilitaciones o licencias que
                correspondan;
              </li>
              <li>
                contar con <strong>todos los derechos</strong> sobre el contenido que carga (textos,
                imágenes, marcas) o con las autorizaciones necesarias de sus titulares;
              </li>
              <li>responder de forma diligente y de buena fe a las consultas de los Interesados; y</li>
              <li>
                cumplir con las obligaciones fiscales, comerciales y de consumo que resulten
                aplicables a su actividad.
              </li>
            </ul>
            <p className="mt-2">
              El Publicante es el único responsable de sus publicaciones y de las relaciones que
              entable con los Interesados.
            </p>
          </div>
        </Section>

        <Section n={6} title="Obligaciones de los Usuarios">
          <div>
            <p>Todo Usuario se compromete a:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>utilizar la Plataforma de buena fe y conforme a estos Términos y a la ley aplicable;</li>
              <li>no interferir con el funcionamiento, la seguridad o la integridad de la Plataforma;</li>
              <li>
                verificar por su cuenta la idoneidad de los Publicantes, Interesados y de los bienes o
                servicios antes de contratar;
              </li>
              <li>tratar con respeto a los demás Usuarios y al personal de soporte; y</li>
              <li>no utilizar el contenido de terceros fuera de los fines previstos por la Plataforma.</li>
            </ul>
          </div>
        </Section>

        <Section n={7} title="Contenido prohibido">
          <div>
            <p>
              Sin perjuicio de otras restricciones legales, queda prohibido publicar, transmitir o
              difundir a través de la Plataforma contenido que:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>sea ilícito o promueva actividades ilegales según la normativa aplicable;</li>
              <li>sea falso, fraudulento, engañoso o constituya una estafa;</li>
              <li>infrinja derechos de propiedad intelectual, de imagen, de privacidad o de terceros;</li>
              <li>
                sea difamatorio, injurioso, discriminatorio, violento o que incite al odio contra
                personas o grupos;
              </li>
              <li>implique la suplantación de identidad o el falseamiento de un vínculo con personas o entidades;</li>
              <li>contenga datos personales de terceros sin su consentimiento;</li>
              <li>
                ofrezca bienes o servicios cuya comercialización esté prohibida o restringida por la
                ley aplicable;
              </li>
              <li>contenga software malicioso, enlaces dañinos o mecanismos de phishing; o</li>
              <li>constituya correo no solicitado (spam), publicidad encubierta o esquemas piramidales.</li>
            </ul>
            <p className="mt-2">
              Nos reservamos el derecho de definir, mediante políticas o pautas complementarias, qué
              contenido se considera prohibido o restringido en la Plataforma.
            </p>
          </div>
        </Section>

        <Section n={8} title="Planes, suscripciones y pagos">
          <p>
            Algunas funciones pueden requerir el pago de planes, créditos o suscripciones. Los
            precios, su moneda, la duración y las condiciones aplicables se informan al momento de la
            contratación y pueden actualizarse con previo aviso para contrataciones futuras.
          </p>
          <p>
            Los pagos se procesan a través de <strong>proveedores externos de medios de pago</strong>.
            {' '}{brand} no almacena los datos completos de tus tarjetas o instrumentos de pago; esa
            información es tratada por el procesador correspondiente conforme a sus propios términos y
            políticas. Las suscripciones pueden <strong>renovarse automáticamente</strong> por
            períodos sucesivos según las condiciones informadas al contratar, hasta que las canceles.
            Podés gestionar la cancelación desde tu Cuenta o contactándonos; la cancelación detiene
            las renovaciones futuras y, salvo indicación en contrario, mantiene el acceso hasta el fin
            del período ya abonado.
          </p>
          <p>
            <strong>Política de reembolsos (genérica):</strong> salvo disposición legal imperativa en
            contrario o indicación expresa de {brand}, los importes correspondientes a períodos ya
            transcurridos o a servicios ya prestados no son reembolsables. Cuando la normativa de
            consumo aplicable reconozca un derecho de arrepentimiento o retracto, este se respetará en
            los términos y plazos que esa normativa establezca.
          </p>
        </Section>

        <Section n={9} title="Verificación (opcional)">
          <p>
            La Plataforma puede ofrecer, de forma <strong>opcional</strong>, procesos de verificación
            de identidad o de datos para reforzar la confianza entre Usuarios. La participación es
            voluntaria y puede requerir que aportes documentación. La existencia de una verificación o
            de una insignia asociada no implica que {brand} garantice o avale a un Usuario, ni
            sustituye la diligencia que cada parte debe aplicar. El tratamiento de los datos y
            documentos de verificación se rige por nuestra Política de Privacidad.
          </p>
        </Section>

        <Section n={10} title="Propiedad intelectual y licencia de contenido">
          <p>
            La Plataforma, su software, diseño, marcas, logotipos y demás elementos son propiedad de
            {' '}{brand} o de sus licenciantes y están protegidos por la normativa de propiedad
            intelectual aplicable. No se concede ningún derecho sobre ellos salvo el uso de la
            Plataforma conforme a estos Términos.
          </p>
          <p>
            El contenido que publicás sigue siendo tuyo. Al cargarlo, otorgás a {brand} una licencia
            {' '}<strong>no exclusiva, mundial, gratuita y transferible a nuestros proveedores de
            infraestructura</strong> para alojarlo, almacenarlo, reproducirlo, adaptarlo técnicamente
            (por ejemplo, redimensionar imágenes) y mostrarlo, con el único fin de operar, mantener,
            promocionar y mejorar la Plataforma. Esta licencia subsiste por el tiempo necesario para
            esos fines, incluso tras la eliminación del contenido respecto de copias técnicas o de
            respaldo, dentro de plazos razonables.
          </p>
        </Section>

        <Section n={11} title="Moderación, suspensión y baja de cuentas">
          <p>
            Podemos revisar, editar, rechazar, despublicar o eliminar cualquier publicación, así como
            aplicar procesos de moderación automatizados o manuales. No estamos obligados a monitorear
            el contenido de terceros de forma proactiva ni asumimos responsabilidad por dicho
            contenido, sin perjuicio de actuar cuando tomemos conocimiento de un contenido ilícito o
            que infrinja estos Términos.
          </p>
          <p>
            Podemos suspender, limitar o cancelar Cuentas que incumplan estos Términos, que presenten
            indicios de fraude o actividad ilícita, o cuando lo exija la ley aplicable. Cuando sea
            razonable, procuraremos notificarte el motivo. También podés dar de baja tu Cuenta en
            cualquier momento desde tu configuración o contactándonos.
          </p>
        </Section>

        <Section n={12} title="Descargo de garantías">
          <p>
            La Plataforma se ofrece &laquo;tal cual&raquo; y &laquo;según disponibilidad&raquo;. En la
            máxima medida permitida por la ley aplicable, {brand} no otorga garantías de ningún tipo,
            expresas o implícitas, incluidas las de comerciabilidad, idoneidad para un fin determinado
            o ausencia de errores. No garantizamos que la Plataforma sea ininterrumpida, segura o
            esté libre de errores, ni que el contenido de terceros sea exacto o confiable.
          </p>
        </Section>

        <Section n={13} title="Limitación de responsabilidad">
          <p>
            En la máxima medida permitida por la ley aplicable, {brand}, sus directivos, empleados y
            proveedores no serán responsables por daños indirectos, incidentales, especiales,
            punitivos o consecuentes, ni por lucro cesante, pérdida de datos o de oportunidades,
            derivados del uso o la imposibilidad de uso de la Plataforma.
          </p>
          <p>
            En particular, {brand} no será responsable por la conducta, el contenido, las
            declaraciones ni las transacciones de los Usuarios entre sí. Cuando una norma imperativa
            no admita la exclusión total de responsabilidad, esta quedará limitada al máximo permitido
            por dicha norma.
          </p>
        </Section>

        <Section n={14} title="Indemnidad">
          <p>
            Te comprometés a mantener indemne y a defender a {brand}, sus directivos, empleados y
            proveedores frente a cualquier reclamo, demanda, pérdida o gasto (incluidos honorarios
            legales razonables) derivado de tu contenido, de tu uso de la Plataforma, del
            incumplimiento de estos Términos o de la infracción de derechos de terceros o de la ley
            aplicable.
          </p>
        </Section>

        <Section n={15} title="Resolución de disputas">
          <p>
            Ante cualquier controversia con {brand}, te pedimos que primero nos contactes para buscar
            una solución de buena fe. Si no se alcanza un acuerdo, la controversia se resolverá
            conforme a la sección de ley aplicable y jurisdicción, sin perjuicio de los mecanismos de
            resolución de conflictos de consumo que la normativa aplicable ponga a tu disposición. Las
            disputas entre Usuarios deben resolverse directamente entre ellos.
          </p>
        </Section>

        <Section n={16} title="Modificaciones del servicio y de los Términos">
          <p>
            Podemos modificar, suspender o discontinuar total o parcialmente la Plataforma, sus
            funciones o sus planes, en cualquier momento, procurando dar aviso cuando los cambios sean
            sustanciales.
          </p>
          <p>
            Asimismo, podemos actualizar estos Términos. Publicaremos la versión vigente en esta
            página e indicaremos su fecha de actualización. El uso continuado de la Plataforma luego
            de la publicación de cambios implica su aceptación. Si no estás de acuerdo con los nuevos
            Términos, debés dejar de usar la Plataforma.
          </p>
        </Section>

        <Section n={17} title="Cesión">
          <p>
            No podés ceder ni transferir tus derechos u obligaciones bajo estos Términos sin nuestro
            consentimiento previo por escrito. {brand} podrá ceder estos Términos, total o
            parcialmente, en el marco de una reorganización, fusión, adquisición o transferencia de
            activos, notificándolo cuando corresponda.
          </p>
        </Section>

        <Section n={18} title="Ley aplicable y jurisdicción">
          <p>
            Estos Términos se rigen por la legislación vigente en <strong>[tu jurisdicción]</strong>.
            Ante cualquier controversia, las partes procurarán una solución de buena fe y, en su
            defecto, se someterán a los tribunales competentes de <strong>[tu jurisdicción]</strong>,
            salvo que una norma imperativa —en particular de protección al consumidor— disponga otro
            fuero o ley aplicable. Completá estos campos con la jurisdicción donde {brand} opera antes
            de publicar el documento.
          </p>
        </Section>

        <Section n={19} title="Contacto">
          <p>
            Para consultas sobre estos Términos podés escribirnos a{' '}
            <a
              href={`mailto:${email}`}
              className="underline"
              style={{ color: 'var(--v-accent-strong)' }}
            >
              {email}
            </a>
            .
          </p>
        </Section>
      </div>
    </main>
  )
}
