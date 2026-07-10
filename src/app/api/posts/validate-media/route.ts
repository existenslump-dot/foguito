import { NextRequest, NextResponse } from 'next/server'
import { TIER_LIMITS, type TierKey } from '@/lib/tiers'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { tier, photoCount, videoCount, audioCount } = body as {
      tier: string
      photoCount: number
      videoCount: number
      audioCount: number
    }

    if (!tier || !(tier in TIER_LIMITS)) {
      return NextResponse.json(
        { error: 'Tier inválido o no especificado' },
        { status: 400 },
      )
    }

    const limits = TIER_LIMITS[tier as TierKey]
    const errors: string[] = []

    if (photoCount > limits.photos) {
      errors.push(`Máximo ${limits.photos} fotos permitidas para el tier ${tier} (enviaste ${photoCount})`)
    }
    if (videoCount > limits.videos) {
      errors.push(`Máximo ${limits.videos} videos permitidos para el tier ${tier} (enviaste ${videoCount})`)
    }
    if (audioCount > limits.audios) {
      errors.push(`Máximo ${limits.audios} audios permitidos para el tier ${tier} (enviaste ${audioCount})`)
    }

    if (errors.length > 0) {
      return NextResponse.json({ error: errors.join('. ') }, { status: 400 })
    }

    return NextResponse.json({ valid: true })
  } catch {
    return NextResponse.json(
      { error: 'Error al validar los medios' },
      { status: 500 },
    )
  }
}
