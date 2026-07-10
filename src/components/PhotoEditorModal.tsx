'use client'
import { useState, useRef, useEffect, useCallback } from 'react'

interface Props {
  src: string
  onSave: (dataUrl: string) => void
  onClose: () => void
}

type BlurMode = 'rect' | 'circle' | 'brush'

export default function PhotoEditorModal({ src, onSave, onClose }: Props) {
  const canvasRef        = useRef<HTMLCanvasElement>(null)
  const containerRef     = useRef<HTMLDivElement>(null)
  const undoStack        = useRef<ImageData[]>([])
  const isDrawing        = useRef(false)
  const drawStart        = useRef<{ x: number; y: number } | null>(null)
  const snapshotted      = useRef(false)

  const [blurMode,     setBlurMode]     = useState<BlurMode>('brush')
  const [brushRadius,  setBrushRadius]  = useState(28)
  const [dragPreview,  setDragPreview]  = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [imageLoaded,    setImageLoaded]    = useState(false)
  const [canUndo,        setCanUndo]        = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const maxW = 1280
      const scale = img.naturalWidth > maxW ? maxW / img.naturalWidth : 1
      canvas.width  = Math.round(img.naturalWidth  * scale)
      canvas.height = Math.round(img.naturalHeight * scale)
      // `willReadFrequently` hints the 2D context toward a CPU-backed buffer
      // so subsequent `getImageData()` reads (initial snapshot below + every
      // blur stroke via pushSnapshot + every undo via performUndo) don't pay
      // the GPU→CPU readback cost per call. Browsers also stop emitting the
      // "Canvas2D: Multiple readback operations..." console warning that we
      // were triggering on every edit session. Per spec the first
      // getContext call wins the attributes, so all later `.getContext('2d')`
      // callers on this same canvas (pushSnapshot, performUndo, blurRect/
      // blurEllipse/blurBrush) inherit the hint for free.
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      undoStack.current = [ctx.getImageData(0, 0, canvas.width, canvas.height)]
      setImageLoaded(true)
    }
    img.src = src
  }, [src])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault()
        performUndo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // eslint-disable-next-line react-hooks/immutability
  const pushSnapshot = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const snap = ctx.getImageData(0, 0, canvas.width, canvas.height)
    undoStack.current = [...undoStack.current.slice(-9), snap]
    setCanUndo(undoStack.current.length > 1)
  }

  // eslint-disable-next-line react-hooks/immutability
  const performUndo = () => {
    const canvas = canvasRef.current
    if (!canvas || undoStack.current.length <= 1) return
    const next = undoStack.current.slice(0, -1)
    undoStack.current = next
    const ctx = canvas.getContext('2d')!
    ctx.putImageData(next[next.length - 1], 0, 0)
    setCanUndo(next.length > 1)
  }

  // Three-pass stacked blur. A single 14px gaussian left facial topology
  // readable at typical post resolutions (the face could still be
  // recognized through a "circle" blur over the head). Stacking three
  // passes at 20/18/16px compounds into an effective ~50px blur that
  // fully dissolves features — heavy enough to protect the subject,
  // soft enough at the edges that it still reads as a blur and not a
  // black-box censor.
  const applyStrongBlur = (tCtx: CanvasRenderingContext2D, draw: (c: CanvasRenderingContext2D) => void) => {
    tCtx.filter = 'blur(20px)'
    draw(tCtx)
    tCtx.filter = 'blur(18px)'
    tCtx.drawImage(tCtx.canvas, 0, 0)
    tCtx.filter = 'blur(16px)'
    tCtx.drawImage(tCtx.canvas, 0, 0)
    tCtx.filter = 'none'
  }

  const blurRect = (canvas: HTMLCanvasElement, x: number, y: number, w: number, h: number) => {
    const ctx = canvas.getContext('2d')!
    const tmp = document.createElement('canvas')
    tmp.width = Math.max(1, w); tmp.height = Math.max(1, h)
    const tCtx = tmp.getContext('2d')!
    applyStrongBlur(tCtx, c => c.drawImage(canvas, x, y, w, h, -6, -6, w + 12, h + 12))
    ctx.drawImage(tmp, x, y, w, h)
  }

  const blurEllipse = (canvas: HTMLCanvasElement, cx: number, cy: number, rx: number, ry: number) => {
    const ctx = canvas.getContext('2d')!
    const tmp = document.createElement('canvas')
    tmp.width = Math.max(1, rx * 2); tmp.height = Math.max(1, ry * 2)
    const tCtx = tmp.getContext('2d')!
    applyStrongBlur(tCtx, c => c.drawImage(canvas, cx - rx, cy - ry, rx * 2, ry * 2, -6, -6, rx * 2 + 12, ry * 2 + 12))
    ctx.save()
    ctx.beginPath()
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
    ctx.clip()
    ctx.drawImage(tmp, cx - rx, cy - ry, rx * 2, ry * 2)
    ctx.restore()
  }

  const blurBrush = (canvas: HTMLCanvasElement, cx: number, cy: number, r: number) => {
    const ctx = canvas.getContext('2d')!
    const sz = Math.max(1, r * 2)
    const tmp = document.createElement('canvas')
    tmp.width = sz; tmp.height = sz
    const tCtx = tmp.getContext('2d')!
    // Brush strokes are generally smaller; two passes is enough without
    // over-feathering the stroke edges.
    tCtx.filter = 'blur(14px)'
    tCtx.drawImage(canvas, cx - r, cy - r, sz, sz, -6, -6, sz + 12, sz + 12)
    tCtx.filter = 'blur(12px)'
    tCtx.drawImage(tmp, 0, 0)
    tCtx.filter = 'none'
    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.clip()
    ctx.drawImage(tmp, cx - r, cy - r, sz, sz)
    ctx.restore()
  }

  const getPos = (e: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const point = 'touches' in e && e.touches.length > 0
      ? e.touches[0]
      : 'changedTouches' in e && e.changedTouches.length > 0
      ? e.changedTouches[0]
      : e as MouseEvent
    return {
      x: (point.clientX - rect.left) * scaleX,
      y: (point.clientY - rect.top) * scaleY,
    }
  }

  // No explicit preventDefault on touch events — React 19 registers
  // onTouchStart / onTouchMove as passive by default, so a
  // `preventDefault()` call just silently fails AND spams the console
  // with "Unable to preventDefault inside passive event listener" (seen
  // ~358× per blur session in prod). The scroll-suppression we actually
  // need comes from `touch-action: none` on the container below, which
  // is a pure-CSS guarantee that doesn't require active listeners.
  const onPointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    if (!imageLoaded) return
    const pos = getPos(e)
    isDrawing.current = true
    drawStart.current = pos
    snapshotted.current = false

    if (blurMode === 'brush') {
      pushSnapshot()
      snapshotted.current = true
      blurBrush(canvasRef.current!, pos.x, pos.y, brushRadius)
    }
  }

  const onPointerMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing.current || !drawStart.current) return
    const pos = getPos(e)
    const start = drawStart.current

    if (blurMode === 'brush') {
      blurBrush(canvasRef.current!, pos.x, pos.y, brushRadius)
      return
    }

    const x = Math.min(start.x, pos.x)
    const y = Math.min(start.y, pos.y)
    const w = Math.abs(pos.x - start.x)
    const h = Math.abs(pos.y - start.y)

    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    setDragPreview({
      x: x * (rect.width / canvas.width),
      y: y * (rect.height / canvas.height),
      w: w * (rect.width / canvas.width),
      h: h * (rect.height / canvas.height),
    })
  }

  const onPointerUp = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing.current || !drawStart.current) return
    const pos = getPos(e)
    const start = drawStart.current
    setDragPreview(null)

    const x = Math.min(start.x, pos.x)
    const y = Math.min(start.y, pos.y)
    const w = Math.abs(pos.x - start.x)
    const h = Math.abs(pos.y - start.y)

    const canvas = canvasRef.current!
    if (blurMode === 'rect' && w > 5 && h > 5) {
      pushSnapshot()
      blurRect(canvas, x, y, w, h)
    } else if (blurMode === 'circle') {
      const cx = start.x + (pos.x - start.x) / 2
      const cy = start.y + (pos.y - start.y) / 2
      if (w / 2 > 3 && h / 2 > 3) {
        pushSnapshot()
        blurEllipse(canvas, cx, cy, w / 2, h / 2)
      }
    }

    isDrawing.current = false
    drawStart.current = null
  }

  const onPointerCancel = () => {
    isDrawing.current = false
    drawStart.current = null
    setDragPreview(null)
  }

  const applyAndSave = useCallback(() => {
    const srcCanvas = canvasRef.current
    if (!srcCanvas) return
    onSave(srcCanvas.toDataURL('image/jpeg', 0.92))
  }, [onSave])

  return (
    <div className="pe-overlay">
      <style>{`
        .pe-overlay {
          position:fixed; inset:0; z-index:9999; padding:20px;
          background:rgba(8,8,8,0.97); backdrop-filter:blur(12px);
          display:flex; align-items:center; justify-content:center;
        }
        .pe-modal {
          background:var(--v-bg-card); border:1px solid rgba(37, 99, 235,0.22);
          border-radius:16px; max-width:660px; width:100%; max-height:92vh;
          overflow-y:auto; display:flex; flex-direction:column;
        }
        @media (max-width:768px) {
          .pe-overlay { padding:0; }
          .pe-modal {
            border-radius:0; max-width:100vw; width:100vw;
            max-height:100vh; height:100vh;
          }
        }

        .pe-header {
          display:flex; align-items:center; justify-content:space-between; gap:12px;
          padding:14px 18px; border-bottom:1px solid rgba(37, 99, 235,0.12);
        }
        .pe-title { display:flex; align-items:center; gap:10px; }
        .pe-title-ic {
          width:32px; height:32px; border-radius:50%; flex-shrink:0;
          background:linear-gradient(135deg, rgba(37, 99, 235,0.18), rgba(37, 99, 235,0.04));
          border:1px solid rgba(37, 99, 235,0.22); color:var(--v-accent);
          display:flex; align-items:center; justify-content:center;
        }
        .pe-title-ic svg { width:15px; height:15px; }
        .pe-title-txt {
          font-family:'Cormorant Garamond','Playfair Display',serif;
          font-size:17px; font-weight:500; color:var(--v-text-primary); line-height:1.05;
        }
        .pe-title-sub {
          font-family:'Montserrat',sans-serif; font-size:8px; font-weight:500;
          letter-spacing:.18em; text-transform:uppercase; color:var(--v-accent); margin-top:3px;
        }
        .pe-close {
          width:32px; height:32px; border-radius:50%; flex-shrink:0;
          background:transparent; border:1px solid rgba(255,255,255,0.08);
          color:var(--v-text-tertiary); cursor:pointer; font-size:15px; line-height:1;
          display:flex; align-items:center; justify-content:center;
          transition:color .25s ease, border-color .25s ease;
        }
        .pe-close:hover { color:var(--v-text-primary); border-color:rgba(37, 99, 235,0.32); }

        .pe-toolbar {
          display:flex; align-items:center; gap:12px; flex-wrap:wrap;
          padding:14px 18px 6px;
        }
        .pe-tools {
          display:flex; gap:4px; padding:4px; border-radius:11px;
          background:var(--v-bg-base); border:1px solid rgba(37, 99, 235,0.1);
        }
        .pe-tool {
          width:34px; height:34px; padding:0; border-radius:8px; cursor:pointer;
          display:inline-flex; align-items:center; justify-content:center;
          border:1px solid transparent; background:transparent; color:var(--v-text-tertiary);
          transition:color .25s ease, background .25s ease, border-color .25s ease;
        }
        .pe-tool:hover { color:var(--v-accent-light); }
        .pe-tool.active {
          background:linear-gradient(135deg, rgba(37, 99, 235,0.22), rgba(37, 99, 235,0.06));
          border-color:rgba(37, 99, 235,0.4); color:var(--v-accent);
        }
        .pe-tool svg { display:block; }

        .pe-size { display:flex; align-items:center; gap:9px; }
        .pe-size-lbl {
          font-family:'Montserrat',sans-serif; font-size:8px; font-weight:500;
          letter-spacing:.16em; text-transform:uppercase; color:var(--v-text-tertiary);
        }
        .pe-size input[type=range] { accent-color:var(--v-accent); width:88px; cursor:pointer; }
        .pe-size-val {
          font-family:'Montserrat',sans-serif; font-size:11px; font-weight:600;
          color:var(--v-accent); min-width:22px; text-align:center;
        }

        .pe-undo {
          width:34px; height:34px; border-radius:9px; cursor:pointer; margin-left:auto;
          background:transparent; border:1px solid rgba(37, 99, 235,0.16);
          color:var(--v-text-tertiary);
          display:inline-flex; align-items:center; justify-content:center;
          transition:color .25s ease, border-color .25s ease;
        }
        .pe-undo:not(:disabled):hover { color:var(--v-accent); border-color:rgba(37, 99, 235,0.38); }
        .pe-undo:disabled { opacity:.3; cursor:default; }
        .pe-undo svg { display:block; }

        .pe-canvas-area { padding:10px 18px 4px; }
        .pe-canvas-wrap {
          position:relative; cursor:crosshair; user-select:none; line-height:0;
          touch-action:none; border-radius:12px; overflow:hidden;
          border:1px solid rgba(37, 99, 235,0.1);
        }
        .pe-canvas-wrap canvas { max-width:100%; display:block; }
        .pe-guide {
          font-family:'Switzer','Inter',Arial,sans-serif; font-size:11.5px;
          color:var(--v-text-tertiary); text-align:center; margin:12px 0 0;
        }

        .pe-loader {
          position:absolute; inset:0; display:flex; align-items:center;
          justify-content:center; background:rgba(8,8,8,0.6);
        }
        .pe-spinner {
          width:26px; height:26px; border:2px solid rgba(37, 99, 235,0.3);
          border-top-color:var(--v-accent); border-radius:50%; animation:pe-spin .8s linear infinite;
        }
        @keyframes pe-spin { to { transform:rotate(360deg); } }

        .pe-actions { display:flex; gap:10px; padding:16px 18px 18px; }
        .pe-btn {
          flex:1; padding:14px; border-radius:999px; cursor:pointer;
          font-family:'Montserrat',sans-serif; font-size:10px; font-weight:600;
          letter-spacing:.16em; text-transform:uppercase;
          display:inline-flex; align-items:center; justify-content:center; gap:7px;
          transition:background .25s ease, border-color .25s ease, color .25s ease;
        }
        .pe-btn svg { width:13px; height:13px; }
        .pe-btn-save { background:var(--v-accent); color:var(--v-bg-base); border:none; }
        .pe-btn-save:hover { background:var(--v-accent-light); }
        .pe-btn-cancel {
          background:transparent; color:var(--v-text-tertiary);
          border:1px solid rgba(37, 99, 235,0.18);
        }
        .pe-btn-cancel:hover { color:var(--v-text-primary); border-color:rgba(37, 99, 235,0.35); }
      `}</style>

      <div className="pe-modal">

        <div className="pe-header">
          <div className="pe-title">
            <span className="pe-title-ic">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3s6 5.7 6 10a6 6 0 0 1-12 0c0-4.3 6-10 6-10z" />
              </svg>
            </span>
            <div>
              <div className="pe-title-txt">Difuminar zonas</div>
              <div className="pe-title-sub">Editor de foto</div>
            </div>
          </div>
          <button type="button" onClick={onClose} className="pe-close" aria-label="Cerrar">✕</button>
        </div>

        <div className="pe-toolbar">
          <div className="pe-tools">
            <button
              type="button"
              onClick={() => setBlurMode('circle')}
              title="Difuminar — Círculo"
              className={`pe-tool ${blurMode === 'circle' ? 'active' : ''}`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="9" /></svg>
            </button>
            <button
              type="button"
              onClick={() => setBlurMode('rect')}
              title="Difuminar — Rectángulo"
              className={`pe-tool ${blurMode === 'rect' ? 'active' : ''}`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="4" y="4" width="16" height="16" rx="2" /></svg>
            </button>
            <button
              type="button"
              onClick={() => setBlurMode('brush')}
              title="Difuminar — Pincel"
              className={`pe-tool ${blurMode === 'brush' ? 'active' : ''}`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20l4-1 10-10-3-3L5 16l-1 4z" /></svg>
            </button>
          </div>

          {blurMode === 'brush' && (
            <div className="pe-size">
              <span className="pe-size-lbl">Tamaño</span>
              <input
                type="range"
                min={8}
                max={80}
                value={brushRadius}
                onChange={e => setBrushRadius(Number(e.target.value))}
              />
              <span className="pe-size-val">{brushRadius}</span>
            </div>
          )}

          <button
            type="button"
            onClick={performUndo}
            disabled={!canUndo}
            title="Deshacer (Ctrl+Z)"
            className="pe-undo"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 14 4 9l5-5" />
              <path d="M4 9h11a4.5 4.5 0 1 1 0 9h-4" />
            </svg>
          </button>
        </div>

        <div className="pe-canvas-area">
          <div
            ref={containerRef}
            className="pe-canvas-wrap"
            onMouseDown={onPointerDown}
            onMouseMove={onPointerMove}
            onMouseUp={onPointerUp}
            onMouseLeave={onPointerCancel}
            onTouchStart={onPointerDown}
            onTouchMove={onPointerMove}
            onTouchEnd={onPointerUp}
            onTouchCancel={onPointerCancel}
          >
            <canvas ref={canvasRef} />

            {dragPreview && dragPreview.w > 2 && dragPreview.h > 2 && (
              <div style={{
                position: 'absolute',
                left: dragPreview.x, top: dragPreview.y,
                width: dragPreview.w, height: dragPreview.h,
                border: '1px dashed var(--v-accent)',
                background: 'rgba(37, 99, 235,0.12)',
                pointerEvents: 'none',
                ...(blurMode === 'circle' ? { borderRadius: '50%' } : {}),
              }} />
            )}

            {!imageLoaded && (
              <div className="pe-loader"><div className="pe-spinner" /></div>
            )}
          </div>

          <p className="pe-guide">
            {blurMode === 'brush'
              ? 'Dibujá sobre las zonas que querés difuminar'
              : 'Arrastrá para definir la zona a difuminar'}
          </p>
        </div>

        <div className="pe-actions">
          <button type="button" onClick={applyAndSave} className="pe-btn pe-btn-save">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Guardar
          </button>
          <button type="button" onClick={onClose} className="pe-btn pe-btn-cancel">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}
