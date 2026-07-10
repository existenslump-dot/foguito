'use client'

/**
 * One upload step-card for the identity-verification flow.
 *
 * Shared between the user-facing form (`/dashboard/verify`) and the admin
 * embedded form (`AdminVerifyForUser`) so both render the exact same
 * step-card — done-preview, upload-zone with camera/file buttons, and the
 * per-step tips. Page-level chrome (hero, stepper, consents, CTA) lives in
 * each caller; this component is just the step.
 */

import { formatBytes } from '@/lib/media-limits'

export type VerifyTip = { ok: boolean; text: string }

export type VerifyStepState = 'done' | 'current' | 'pending'

type Props = {
  n: number
  title: string
  subtitle: string
  /** Title shown inside the empty upload-zone, e.g. "Subí tu selfie". */
  uploadTitle: string
  /** Spec hint, e.g. "JPG · máx. 5 MB · mínimo 1024×1024". */
  specs: string
  state: VerifyStepState
  kind: 'image' | 'video'
  /** Front camera for selfies, rear for documents. */
  captureMode: 'user' | 'environment'
  /** `accept` for the file-browser input (the camera input uses image/* | video/*). */
  uploadAccept: string
  primaryLabel: string
  secondaryLabel: string
  file: File | null
  preview: string | null
  tips?: VerifyTip[]
  onPick: (file: File, previewUrl: string) => void
  onClear: () => void
  validate: (f: File) => { ok: true } | { ok: false; reason: string }
  onError: (msg: string) => void
}

const Check = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

export default function VerifyUploadStep({
  n, title, subtitle, uploadTitle, specs, state, kind, captureMode, uploadAccept,
  primaryLabel, secondaryLabel, file, preview, tips, onPick, onClear, validate, onError,
}: Props) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    const r = validate(f)
    if (!r.ok) { onError(r.reason); e.target.value = ''; return }
    onPick(f, URL.createObjectURL(f))
    e.target.value = ''
  }

  return (
    <div className={`vus-card vus-${state}`}>
      <style>{`
        .vus-card {
          background: var(--v-bg-card);
          border: 1px solid rgba(37, 99, 235,0.08);
          border-radius: 12px;
          padding: 16px 16px 14px;
          margin-bottom: 12px;
        }
        .vus-current {
          border-color: rgba(37, 99, 235,0.22);
          background: linear-gradient(180deg, rgba(37, 99, 235,0.04) 0%, var(--v-bg-card) 100%);
        }
        .vus-done {
          border-color: rgba(106,176,106,0.22);
          background: rgba(106,176,106,0.03);
        }
        .vus-head { display: flex; align-items: center; gap: 12px; }
        .vus-icnum {
          width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0;
          background: rgba(37, 99, 235,0.08); border: 1px solid rgba(37, 99, 235,0.22);
          color: var(--v-accent);
          display: flex; align-items: center; justify-content: center;
          font-family: 'Cormorant Garamond','Playfair Display',serif;
          font-weight: 500; font-size: 15px;
        }
        .vus-done .vus-icnum {
          background: rgba(106,176,106,0.12); border-color: rgba(106,176,106,0.32);
          color: var(--v-success);
        }
        .vus-icnum svg { width: 14px; height: 14px; }
        .vus-ttl { flex: 1; min-width: 0; }
        .vus-ttl h4 {
          font-family: 'Cormorant Garamond','Playfair Display',serif;
          font-weight: 500; font-size: 16px; color: var(--v-text-primary);
          line-height: 1.2; margin: 0;
        }
        .vus-sub {
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 11px; color: var(--v-text-tertiary); margin-top: 3px; line-height: 1.4;
        }
        .vus-status {
          flex-shrink: 0; font-family: 'Switzer','Inter',Arial,sans-serif;
          font-size: 9px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase;
          padding: 4px 10px 3px; border-radius: 999px;
        }
        .vus-current .vus-status {
          background: rgba(37, 99, 235,0.08); color: var(--v-accent);
          border: 1px solid rgba(37, 99, 235,0.22);
        }
        .vus-done .vus-status {
          background: rgba(106,176,106,0.12); color: var(--v-success);
          border: 1px solid rgba(106,176,106,0.32);
        }

        .vus-upzone {
          margin-top: 12px;
          background: var(--v-bg-elevated);
          border: 1.5px dashed rgba(37, 99, 235,0.18);
          border-radius: 10px; padding: 20px 16px; text-align: center;
        }
        .vus-current .vus-upzone { border-color: rgba(37, 99, 235,0.3); }
        .vus-upic {
          width: 44px; height: 44px; margin: 0 auto 10px; border-radius: 50%;
          background: rgba(37, 99, 235,0.08); border: 1px solid rgba(37, 99, 235,0.22);
          color: var(--v-accent);
          display: flex; align-items: center; justify-content: center;
        }
        .vus-upic svg { width: 18px; height: 18px; }
        .vus-up-ttl {
          font-family: 'Switzer','Inter',Arial,sans-serif;
          font-size: 13px; font-weight: 500; color: var(--v-text-primary); margin-bottom: 4px;
        }
        .vus-up-hint {
          font-family: 'Switzer','Inter',Arial,sans-serif;
          font-size: 10.5px; color: var(--v-text-tertiary); margin-bottom: 12px; line-height: 1.45;
        }
        .vus-up-actions { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
        .vus-btn {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 9px 16px 8px; border: 1px solid rgba(37, 99, 235,0.3);
          color: var(--v-accent); border-radius: 999px; cursor: pointer;
          font-family: 'Switzer','Inter',Arial,sans-serif;
          font-size: 11px; font-weight: 500; letter-spacing: .04em;
        }
        .vus-btn svg { width: 12px; height: 12px; }
        .vus-btn.primary { background: var(--v-accent); color: var(--v-bg-base); border-color: var(--v-accent); }

        .vus-donerow {
          margin-top: 12px;
          display: grid; grid-template-columns: 64px 1fr auto; gap: 12px; align-items: center;
          padding: 10px 12px;
          background: var(--v-bg-elevated);
          border: 1px solid rgba(37, 99, 235,0.08); border-radius: 10px;
        }
        .vus-thumb {
          width: 64px; height: 64px; border-radius: 8px; overflow: hidden;
          background: var(--v-bg-base); flex-shrink: 0;
        }
        .vus-thumb-media { width: 100%; height: 100%; object-fit: cover; display: block; }
        .vus-donebody { min-width: 0; }
        .vus-donename {
          font-family: 'Switzer','Inter',Arial,sans-serif;
          font-size: 12.5px; font-weight: 500; color: var(--v-text-primary);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .vus-donemeta {
          display: flex; align-items: center; gap: 6px; margin-top: 3px;
          font-family: 'Switzer','Inter',Arial,sans-serif;
          font-size: 10.5px; color: var(--v-text-tertiary);
        }
        .vus-ok { display: inline-flex; align-items: center; gap: 3px; color: var(--v-success); }
        .vus-ok svg { width: 10px; height: 10px; }
        .vus-replace {
          background: transparent; border: none; cursor: pointer;
          color: var(--v-accent); font-family: 'Switzer','Inter',Arial,sans-serif;
          font-size: 10.5px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase;
        }

        .vus-tips {
          margin-top: 10px; padding: 10px 14px;
          background: rgba(255,255,255,0.02);
          border: 1px solid rgba(37, 99, 235,0.08); border-radius: 8px;
        }
        .vus-tip {
          display: flex; align-items: flex-start; gap: 8px; padding: 4px 0;
          font-family: 'Switzer','Inter',Arial,sans-serif;
          font-size: 11.5px; color: var(--v-text-primary); line-height: 1.4;
        }
        .vus-tip svg { width: 12px; height: 12px; color: var(--v-accent); flex-shrink: 0; margin-top: 2px; }
        .vus-tip.bad svg { color: var(--v-error); }
      `}</style>

      <div className="vus-head">
        <span className="vus-icnum">{state === 'done' ? <Check /> : n}</span>
        <div className="vus-ttl">
          <h4>{title}</h4>
          <div className="vus-sub">{subtitle}</div>
        </div>
        {state === 'done' && <span className="vus-status">Listo</span>}
        {state === 'current' && <span className="vus-status">Actual</span>}
      </div>

      {file && preview ? (
        <div className="vus-donerow">
          <div className="vus-thumb">
            {kind === 'image' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="vus-thumb-media" src={preview} alt={title} />
            ) : (
              <video className="vus-thumb-media" src={preview} muted playsInline preload="metadata" />
            )}
          </div>
          <div className="vus-donebody">
            <div className="vus-donename">{file.name}</div>
            <div className="vus-donemeta">
              <span>{formatBytes(file.size)}</span>
              <span>·</span>
              <span className="vus-ok"><Check /> Cifrado</span>
            </div>
          </div>
          <button type="button" className="vus-replace" onClick={onClear}>Cambiar</button>
        </div>
      ) : (
        <>
          <div className="vus-upzone">
            <div className="vus-upic">
              {kind === 'image' ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="23 7 16 12 23 17 23 7" />
                  <rect x="1" y="5" width="15" height="14" rx="2" />
                </svg>
              )}
            </div>
            <div className="vus-up-ttl">{uploadTitle}</div>
            <div className="vus-up-hint">{specs}</div>
            <div className="vus-up-actions">
              <label className="vus-btn primary">
                {primaryLabel}
                <input
                  type="file"
                  accept={kind === 'image' ? 'image/*' : 'video/*'}
                  capture={captureMode}
                  style={{ display: 'none' }}
                  onChange={handleChange}
                />
              </label>
              <label className="vus-btn">
                {secondaryLabel}
                <input
                  type="file"
                  accept={uploadAccept}
                  style={{ display: 'none' }}
                  onChange={handleChange}
                />
              </label>
            </div>
          </div>
          {state === 'current' && tips && tips.length > 0 && (
            <div className="vus-tips">
              {tips.map((t, i) => (
                <div key={i} className={`vus-tip ${t.ok ? '' : 'bad'}`}>
                  {t.ok ? (
                    <Check />
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  )}
                  {t.text}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
