// `question` is the user-facing label rendered on the public /faq page; the
// `keywords`/`answer` pair still drives the chat bot's substring matching.
export interface FAQEntry {
  question: string
  keywords: string[]
  answer: string
}

const FAQ: FAQEntry[] = [
  {
    question: '¿Cómo publico un anuncio?',
    keywords: ['publicar', 'publicacion', 'anuncio', 'crear', 'nuevo anuncio', 'darse de alta', 'dar de alta', 'solicitud', 'ofrecer servicio'],
    answer: 'Creás y gestionás tu propio anuncio desde tu panel. Registrate en /registro, ingresá a /dashboard y cargá tu anuncio desde ahí: elegí la categoría (Hogar y Reparaciones, Clases Particulares, Belleza y Bienestar, Eventos y Fotografía, Tecnología y Soporte o Salud y Cuidados), describí tu servicio, tu zona de cobertura y tu tarifa. Se permite un anuncio activo por cuenta. Ante cualquier duda sobre cómo seguir, te guiamos paso a paso por WhatsApp.',
  },
  {
    question: '¿Qué niveles o planes hay?',
    keywords: ['tier', 'nivel', 'niveles', 'plan', 'planes', 'gold', 'silver', 'bronze', 'elite', 'precio', 'costo', 'cuanto', 'tarifa', 'valor'],
    answer: 'Marketplace tiene cuatro niveles: Elite, Gold, Silver y Bronze. Cada uno incluye distintos cupos de fotos, videos y features de visibilidad. La comparativa completa de qué ofrece cada nivel está en /planes. Para avanzar y coordinar tu anuncio, te guiamos por WhatsApp.',
  },
  {
    question: '¿Cómo subo y edito las fotos?',
    keywords: ['foto', 'fotos', 'imagen', 'imagenes', 'subir fotos', 'editar fotos'],
    answer: 'Desde tu panel subís y editás las fotos de tu anuncio. Aceptamos JPG, PNG y WEBP; la cantidad máxima depende de tu nivel. El editor integrado permite recortar y aplicar la marca de agua. Mostrá tu trabajo: fotos reales de tus servicios o tu local ayudan a que te contacten.',
  },
  {
    question: '¿Qué son las historias?',
    keywords: ['historia', 'historias', 'story', 'stories'],
    answer: 'Las historias duran 24 horas y se crean desde tu panel. Requieren aprobación del moderador antes de publicarse.',
  },
  {
    question: '¿Cómo verifico mi identidad?',
    keywords: ['verificar', 'verificacion', 'verificada', 'sello', 'check'],
    answer: 'La verificación de identidad es opcional, pero recomendada: aumenta la confianza de quienes te contactan. La iniciás vos desde tu panel (/dashboard → Verificar): subís tu documentación y el equipo de Marketplace la revisa. Una vez aprobada, tu anuncio muestra el sello ✓ Verificado. La verificación de identidad y la aprobación del anuncio son procesos independientes.',
  },
  {
    question: 'Olvidé mi contraseña, ¿cómo la recupero?',
    keywords: ['contraseña', 'password', 'olvide', 'recuperar', 'restablecer', 'no puedo entrar', 'login'],
    answer: 'Si olvidaste tu contraseña, en /ingresar tenés la opción "¿Olvidaste tu contraseña?" (te lleva a /recuperar). Te enviamos un email para restablecerla.',
  },
  {
    question: '¿Cómo elimino mi cuenta?',
    keywords: ['eliminar cuenta', 'borrar cuenta', 'eliminar mi cuenta', 'dar de baja', 'darme de baja'],
    answer: 'Podés eliminar tu cuenta desde tu panel → Mi cuenta (/dashboard/profile) → sección Seguridad → "Eliminar mi cuenta". La acción es irreversible: borra todos tus datos y anuncios.',
  },
  {
    question: '¿Dónde veo las estadísticas de mi anuncio?',
    keywords: ['estadistica', 'estadisticas', 'metricas', 'visitas', 'rendimiento', 'analytics'],
    answer: 'En tu panel tenés la sección Estadísticas (/dashboard/analytics), con el detalle de visitas y rendimiento de tu anuncio.',
  },
  {
    question: '¿Cómo contacto al soporte?',
    keywords: ['contacto', 'soporte', 'ayuda', 'problema', 'consulta', 'asistencia'],
    answer: 'El soporte y la guía paso a paso es por WhatsApp — escribinos y te ayudamos con cualquier duda sobre cómo seguir. También tenés el formulario en /contacto y el correo contacto@example.com.',
  },
  {
    question: '¿Cómo contacto a un profesional?',
    keywords: ['contactar anunciante', 'contacto anunciante', 'escribir anunciante', 'mensaje al anunciante', 'hablar con', 'contactar profesional', 'contratar'],
    answer: 'Cada anuncio tiene un botón "Contactar" que abre WhatsApp directamente con ese profesional. El acuerdo (alcance del trabajo, tarifa, día y horario) se coordina siempre entre vos y el profesional; Marketplace solo publica los anuncios y no intermedia en la contratación.',
  },
  {
    question: '¿Cuánto dura un anuncio y cómo lo renuevo?',
    keywords: ['renovar', 'renovacion', 'vencimiento', 'expira', 'vence', 'dias', 'vigencia'],
    answer: 'Los anuncios tienen vigencia de 30 días. La renovación la hacés vos desde tu panel (/dashboard), con el botón "Renovar plan". Si necesitás ayuda con el proceso, te guiamos por WhatsApp.',
  },
  {
    question: '¿Cómo activo una promoción?',
    keywords: ['promocion', 'promo', 'destacar', 'oferta'],
    answer: 'Desde tu panel podés activar una promoción en tu anuncio (botón "Promoción"): definís un precio promocional y la duración (1 a 30 días). El anuncio aparece con el badge "EN PROMOCIÓN" en el listado.',
  },
  {
    question: '¿Cómo funcionan los pagos?',
    keywords: ['pago', 'pagar', 'abonar', 'cobro', 'comprar', 'metodos de pago', 'medio de pago', 'factura', 'comprobante'],
    answer: 'El pago del servicio va siempre directo entre vos y el profesional — Marketplace no procesa ni intermedia cobros entre clientes y anunciantes. Para coordinar tu plan y cualquier consulta comercial sobre la plataforma, te atendemos y te guiamos por WhatsApp.',
  },
  {
    question: '¿Qué consejos de seguridad debo tener?',
    keywords: ['seguridad', 'consejo', 'consejos', 'estafa', 'precaucion', 'precauciones', 'cuidado'],
    answer: 'Para contratar con tranquilidad: priorizá anuncios con el sello "Verificado", acordá por escrito el alcance del trabajo y la tarifa antes de empezar, y desconfiá de quien pida pagos por adelantado o por fuera de los medios habituales. Si algo no te cierra, cancelá y reportá el anuncio desde el listado.',
  },
  {
    question: '¿Cómo reporto un anuncio sospechoso?',
    keywords: ['reporte', 'reportar', 'denunciar', 'fraude', 'falso', 'denuncia', 'abuso'],
    answer: 'Si encontrás un anuncio sospechoso o que incumple las reglas, usá el botón "Reportar" al final de cada aviso. El equipo de moderación revisa cada reporte y retira los anuncios que infrinjan los Términos y Condiciones. Para casos urgentes escribí a seguridad@example.com.',
  },
  {
    question: '¿Dónde están los Términos y la Privacidad?',
    keywords: ['legal', 'terminos', 'privacidad', 'politica', 'condiciones', 'ley', 'leyes', 'marco legal', 'normativa', 'datos personales'],
    answer: 'Los Términos están en /terminos y la Política de Privacidad en /privacidad. Marketplace opera conforme a la normativa de protección de datos aplicable y a sus propios Términos y Condiciones. Consultas legales: legal@example.com. Datos personales: privacidad@example.com.',
  },
  {
    question: '¿Cómo se tratan mis datos y documentos?',
    keywords: ['dato', 'datos', 'kyc', 'documento', 'documentos', 'tratamiento de datos', 'mis datos'],
    answer: 'Los archivos que subís para la verificación opcional de identidad se guardan en almacenamiento privado con cifrado en reposo y en tránsito, acceso restringido al equipo de moderación y nunca son visibles públicamente. El detalle del tratamiento de datos está en /privacidad, conforme a la normativa de protección de datos aplicable.',
  },
  {
    question: '¿Qué derechos tengo sobre mis datos personales?',
    keywords: ['acceso', 'rectificar', 'borrar datos', 'eliminar datos', 'derecho', 'derechos'],
    answer: 'Tenés derecho de acceso, rectificación, supresión y oposición sobre tus datos personales conforme a la normativa de protección de datos aplicable. Podés eliminar tu cuenta desde tu panel o escribir a privacidad@example.com — respondemos sin costo. El detalle está en /privacidad.',
  },
  {
    question: 'Me bajaron el anuncio, ¿puedo apelar?',
    keywords: ['apelar', 'apelacion', 'remocion', 'me bajaron', 'reclamo', 'baja injusta'],
    answer: 'Toda decisión de remoción o suspensión de un anuncio puede ser apelada mediante un escrito fundado a soporte@example.com dentro de los 10 días corridos posteriores a la notificación. La apelación es revisada por un moderador distinto al que tomó la decisión inicial. Detalle en /terminos.',
  },
]

export default FAQ

export function findFAQAnswer(userMessage: string): string | null {
  const msg = [...userMessage.toLowerCase().normalize('NFD')]
    .filter(ch => {
      const cp = ch.codePointAt(0) ?? 0
      return cp < 0x300 || cp > 0x36f
    })
    .join('')

  for (const item of FAQ) {
    if (item.keywords.some(kw => msg.includes(kw))) return item.answer
  }
  return null
}
