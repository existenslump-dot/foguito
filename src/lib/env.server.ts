import 'server-only'

const required = (key: string): string => {
  const val = process.env[key]
  if (!val) throw new Error(`Missing required env var: ${key}`)
  return val
}

const optional = (key: string): string | undefined => process.env[key]

/** Lazily validated — only throws when the getter is actually called. */
function lazy(key: string) {
  return {
    get value(): string {
      return required(key)
    },
  }
}

export const env = {
  supabaseUrl: required('NEXT_PUBLIC_SUPABASE_URL'),
  supabaseAnonKey: required('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  get supabaseServiceRole() { return lazy('SUPABASE_SERVICE_ROLE_KEY').value },
  get resendApiKey() { return lazy('RESEND_API_KEY').value },
  get nowpaymentsApiKey() { return lazy('NOWPAYMENTS_API_KEY').value },
  get nowpaymentsIpnSecret() { return lazy('NOWPAYMENTS_IPN_SECRET').value },
  get cloudinaryApiKey() { return lazy('CLOUDINARY_API_KEY').value },
  get cloudinaryApiSecret() { return lazy('CLOUDINARY_API_SECRET').value },
  hcaptchaSecret: optional('HCAPTCHA_SECRET'),
  sentryDsn: optional('SENTRY_DSN'),
}
