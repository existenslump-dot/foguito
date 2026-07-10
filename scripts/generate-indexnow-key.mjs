#!/usr/bin/env node
/**
 * Generate a fresh IndexNow key and print setup instructions.
 *
 * IndexNow keys are 32+ hex chars (spec), served by the site at
 * `/{KEY}.txt` so Bing/Yandex can verify ownership. The middleware at
 * src/middleware.ts intercepts `/{INDEXNOW_KEY}.txt` and echoes the key
 * back — so rotating the key requires updating Vercel + redeploy, then
 * notifying each search engine (or letting them re-verify on the next
 * cycle).
 *
 * Usage:
 *   node scripts/generate-indexnow-key.mjs
 *
 * Output: the key + copy-paste-ready env var line + next-step checklist.
 */

import { randomBytes } from 'node:crypto'

const key = randomBytes(16).toString('hex') // 32 hex chars — spec minimum

// Base URL for the printed verification hints. Driven by env so the output
// matches the deployment; falls back to a neutral example domain.
const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://your-domain.com').replace(/\/$/, '')

const lines = [
  '',
  '  ╔══════════════════════════════════════════════════════════════╗',
  '  ║                   IndexNow key generated                     ║',
  '  ╚══════════════════════════════════════════════════════════════╝',
  '',
  `  Key:  ${key}`,
  '',
  '  ── Next steps ──────────────────────────────────────────────',
  '',
  '  1. Set in Vercel → Settings → Environment Variables:',
  `        INDEXNOW_KEY=${key}`,
  '     (Production scope. Also add to Preview if you want IndexNow',
  '     pings from branch deploys.)',
  '',
  '  2. Deploy. The middleware will start serving',
  `        ${baseUrl}/${key}.txt`,
  '',
  '  3. Verify it\'s live (wait ~30s for Vercel propagation):',
  `        curl ${baseUrl}/${key}.txt`,
  `     → should echo: ${key}`,
  '',
  '  4. Register with Bing Webmaster Tools:',
  '        https://www.bing.com/webmasters → IndexNow → Submit a new key',
  '     (Yandex + Seznam + Naver auto-discover via the submission API.)',
  '',
  '  5. Post-approval workflow already calls submitIndexNow() in',
  '     src/lib/indexnow.ts — no code change needed, the key env var',
  '     turns it from no-op to active.',
  '',
]

for (const line of lines) console.log(line)
