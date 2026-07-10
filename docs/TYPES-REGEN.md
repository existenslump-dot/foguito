# Regenerating Supabase types

The stale `src/types/supabase.ts` was removed in Sprint 2 — it referenced
a pre-geo-refactor schema and was never imported. When typed queries
become a priority, regenerate it fresh:

## Prerequisites

1. **Supabase CLI** installed globally: `npm install -g supabase`
2. **Login once** per machine: `npx supabase login` (opens browser, grants a
   personal access token). This token is stored in `~/.supabase/` and
   distinct from `SUPABASE_SERVICE_ROLE_KEY` — it's only used by the CLI.
3. **Project ID** — from Supabase Dashboard → Project Settings → General.
   Stored as `SUPABASE_PROJECT_ID` in your local env (NOT in Vercel; this
   is dev-tooling only).

## Run

```bash
export SUPABASE_PROJECT_ID=<your-project-id>
npm run types:generate
```

The script writes `src/types/supabase.ts` with the current prod schema.
Diff the file against HEAD before committing — migrations add/remove
columns and the diff is the source of truth for what changed.

## What to do with it

`types:generate` only writes the file. To make queries typed, thread the
generated `Database` type through your client creation:

```ts
// src/lib/supabase/client.ts
import type { Database } from '@/types/supabase'
import { createBrowserClient } from '@supabase/ssr'

export const supabase = createBrowserClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)
```

Same treatment for `src/lib/clients/supabase-admin.ts`:

```ts
import type { Database } from '@/types/supabase'
import { createClient } from '@supabase/supabase-js'

cached = createClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})
```

Once the types flow, queries like `supabase.from('posts').select('title')`
narrow their return types automatically — catches typos like
`select('titl')` at compile time instead of runtime 400.

## Cadence

- **After every migration that adds/removes columns** — types drift silently otherwise.
- **Before starting a refactor** that touches query shapes — catches the drift upfront.

## Gotchas

- `src/types/supabase.ts` writes in UTF-8. Past versions landed with a
  UTF-16 BOM (Windows `Set-Content` default) — the file was deleted in
  Sprint 2 for that reason. The `>` shell redirect from `npm run
  types:generate` produces UTF-8 on bash/zsh; on PowerShell use
  `npx supabase ... | Set-Content -Encoding utf8 src/types/supabase.ts`.
- `--schema public` limits output to the public schema. If we add
  custom schemas (e.g. `internal`), extend with `--schema internal` too
  and the generator merges them.
- The generated file is large (>10k lines for a 20+ table schema). It's
  typed + tree-shakable, so bundle impact is zero at runtime.
