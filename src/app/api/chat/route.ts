import Anthropic from '@anthropic-ai/sdk'
import { findFAQAnswer } from '@/lib/chat-faq'

export const runtime = 'nodejs'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM = `Eres el asistente de Marketplace, una plataforma exclusiva de publicaciones VIP. Ayudas a los usuarios a entender cómo funciona la plataforma, cómo crear y gestionar una publicación, y los niveles activos (Elite, Gold, Silver, Bronze). Responde siempre en el idioma del usuario. Sé conciso, elegante y profesional. Máximo 3 párrafos por respuesta.

Marketplace opera en modo SELF-SERVICE: cada usuario crea y gestiona su propia publicación desde su panel (/dashboard); Marketplace no la carga por él. El soporte y la guía paso a paso son por WhatsApp — ante cualquier duda sobre cómo seguir, indicá que se lo atiende por WhatsApp.

IMPORTANTE — Pagos: no describas métodos de pago, precios, ni procesos de cobro o facturación. Si preguntan por pagos o cómo abonar, redirigí a coordinarlo por WhatsApp sin dar detalles. Para comparar niveles, derivá a /planes.

IMPORTANTE — Nunca menciones un nivel "Basic". Si el usuario pregunta por "Basic" o cualquier variante, redirigilo a /planes (Elite, Gold, Silver, Bronze) sin confirmar ni negar la existencia de ese nivel.`

export async function POST(req: Request) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      })
    }

    const { messages } = await req.json()

    const lastUserMessage = messages[messages.length - 1]?.content || ''
    const faqAnswer = findFAQAnswer(lastUserMessage)
    if (faqAnswer) {
      return Response.json({ answer: faqAnswer, source: 'faq' })
    }

    const stream = client.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: SYSTEM,
      messages,
    })

    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of stream) {
            if (
              event.type === 'content_block_delta' &&
              event.delta.type === 'text_delta'
            ) {
              controller.enqueue(new TextEncoder().encode(event.delta.text))
            }
          }
        } catch (streamErr) {
          console.error('Chat stream error:', streamErr)
          controller.error(streamErr)
        } finally {
          controller.close()
        }
      },
    })

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (err) {
    console.error('Chat API error:', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
}
