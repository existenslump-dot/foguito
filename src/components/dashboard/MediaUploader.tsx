'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { DropzoneInputProps, DropzoneRootProps } from 'react-dropzone'

export type EditorTarget =
  | { kind: 'existing'; url: string }
  | { kind: 'new'; idx: number }

interface Props {
  isAdmin: boolean
  tier: string
  tierLimits: { photos: number; videos: number; audios: number }

  getRootProps: <T extends DropzoneRootProps>(props?: T) => T
  getInputProps: <T extends DropzoneInputProps>(props?: T) => T
  isDragActive: boolean

  // Images — existing* optional (omit for create flows that only upload new files)
  existingImageUrls?: string[]
  setExistingImageUrls?: Dispatch<SetStateAction<string[]>>
  newImageFiles: File[]
  setNewImageFiles: Dispatch<SetStateAction<File[]>>
  newImagePreviews: string[]
  setNewImagePreviews: Dispatch<SetStateAction<string[]>>
  editedNewImages: Record<number, string>
  setEditedNewImages: Dispatch<SetStateAction<Record<number, string>>>

  existingVideoUrls?: string[]
  setExistingVideoUrls?: Dispatch<SetStateAction<string[]>>
  newVideoFiles: File[]
  setNewVideoFiles: Dispatch<SetStateAction<File[]>>

  existingAudioUrl?: string | null
  setExistingAudioUrl?: Dispatch<SetStateAction<string | null>>
  existingAudioFilename?: string
  setExistingAudioFilename?: Dispatch<SetStateAction<string>>
  newAudioFile: File | null
  setNewAudioFile: Dispatch<SetStateAction<File | null>>

  coverUrl: string | null
  setCoverUrl: Dispatch<SetStateAction<string | null>>

  profilePhotoUrl: string | null
  setProfilePhotoUrl: Dispatch<SetStateAction<string | null>>

  setEditorSrc: Dispatch<SetStateAction<string | null>>
  setEditorTarget: Dispatch<SetStateAction<EditorTarget | null>>

  uploadProgress: Record<number, number>
}

const IcEdit = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4v16h16v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
)
const IcTrash = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
  </svg>
)

export default function MediaUploader(props: Props) {
  const {
    tier, tierLimits,
    getRootProps, getInputProps, isDragActive,
    newImageFiles, setNewImageFiles,
    newImagePreviews, setNewImagePreviews,
    editedNewImages, setEditedNewImages,
    newVideoFiles, setNewVideoFiles,
    newAudioFile, setNewAudioFile,
    coverUrl, setCoverUrl,
    profilePhotoUrl, setProfilePhotoUrl,
    setEditorSrc, setEditorTarget,
    uploadProgress,
  } = props

  const existingImageUrls = useMemo(
    () => props.existingImageUrls ?? [],
    [props.existingImageUrls],
  )
  const setExistingImageUrls  = props.setExistingImageUrls
  const existingVideoUrls = useMemo(
    () => props.existingVideoUrls ?? [],
    [props.existingVideoUrls],
  )
  const setExistingVideoUrls  = props.setExistingVideoUrls
  const existingAudioUrl      = props.existingAudioUrl ?? null
  const setExistingAudioUrl   = props.setExistingAudioUrl
  const existingAudioFilename = props.existingAudioFilename ?? ''
  const setExistingAudioFilename = props.setExistingAudioFilename

  const hasExisting = existingImageUrls.length > 0 || existingVideoUrls.length > 0 || existingAudioUrl !== null
  const totalImages = existingImageUrls.length + newImageFiles.length
  const totalVideos = existingVideoUrls.length + newVideoFiles.length
  const hasAudio = !!(existingAudioUrl || newAudioFile)

  // Keep coverUrl / profilePhotoUrl pointed at a photo that still exists.
  useEffect(() => {
    const allUrls = [
      ...existingImageUrls,
      ...newImagePreviews.map((url, i) => editedNewImages[i] ?? url),
    ]
    if (allUrls.length === 0) return
    if (!coverUrl || !allUrls.includes(coverUrl)) {
      setCoverUrl(allUrls[0])
    }
    if (profilePhotoUrl && !allUrls.includes(profilePhotoUrl)) {
      setProfilePhotoUrl(null)
    }
  }, [existingImageUrls, newImagePreviews, editedNewImages, coverUrl, setCoverUrl, profilePhotoUrl, setProfilePhotoUrl])

  const TIP_KEY = 'mu_drag_tip_seen_v1'
  const [showTip, setShowTip] = useState(() => {
    if (typeof window === 'undefined') return false
    try { return !localStorage.getItem(TIP_KEY) } catch { return false }
  })
  function dismissTip() {
    setShowTip(false)
    try { localStorage.setItem(TIP_KEY, '1') } catch {}
  }

  type DragState = {
    kind: 'existing' | 'new'
    fromIdx: number
    targetIdx: number | null
  }
  const [drag, setDrag] = useState<DragState | null>(null)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pointerStartRef = useRef<{ x: number; y: number; kind: 'existing' | 'new'; idx: number } | null>(null)

  function moveExisting(from: number, to: number) {
    if (from === to || !setExistingImageUrls) return
    setExistingImageUrls(prev => {
      const next = [...prev]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })
    dismissTip()
  }

  function moveNew(from: number, to: number) {
    if (from === to) return
    dismissTip()
    setNewImageFiles(prev => {
      const next = [...prev]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })
    setNewImagePreviews(prev => {
      const next = [...prev]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })
    setEditedNewImages(prev => {
      const next: Record<number, string> = {}
      Object.entries(prev).forEach(([k, v]) => {
        const oldIdx = parseInt(k)
        let newIdx = oldIdx
        if (oldIdx === from) newIdx = to
        else if (from < to && oldIdx > from && oldIdx <= to) newIdx = oldIdx - 1
        else if (from > to && oldIdx >= to && oldIdx < from) newIdx = oldIdx + 1
        next[newIdx] = v
      })
      return next
    })
  }

  function findTileUnderPointer(clientX: number, clientY: number): { kind: 'existing' | 'new'; idx: number } | null {
    const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null
    const tile = el?.closest<HTMLElement>('[data-tile-kind]')
    if (!tile) return null
    const kind = tile.getAttribute('data-tile-kind') as 'existing' | 'new'
    const idx = parseInt(tile.getAttribute('data-tile-idx') ?? '-1', 10)
    if (idx < 0) return null
    return { kind, idx }
  }

  function onTilePointerDown(kind: 'existing' | 'new', idx: number, e: React.PointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest('button')) return
    if (e.pointerType === 'mouse' && e.button !== 0) return

    pointerStartRef.current = { x: e.clientX, y: e.clientY, kind, idx }
    longPressTimerRef.current = setTimeout(() => {
      setDrag({ kind, fromIdx: idx, targetIdx: null })
      longPressTimerRef.current = null
      try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch {}
    }, 200)
  }

  useEffect(() => {
    if (!drag) {
      function handlePreDragMove(e: PointerEvent) {
        if (!pointerStartRef.current || !longPressTimerRef.current) return
        const dx = Math.abs(e.clientX - pointerStartRef.current.x)
        const dy = Math.abs(e.clientY - pointerStartRef.current.y)
        if (dx > 8 || dy > 8) {
          clearTimeout(longPressTimerRef.current)
          longPressTimerRef.current = null
          pointerStartRef.current = null
        }
      }
      function handlePreDragUp() {
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current)
          longPressTimerRef.current = null
        }
        pointerStartRef.current = null
      }
      window.addEventListener('pointermove', handlePreDragMove)
      window.addEventListener('pointerup', handlePreDragUp)
      window.addEventListener('pointercancel', handlePreDragUp)
      return () => {
        window.removeEventListener('pointermove', handlePreDragMove)
        window.removeEventListener('pointerup', handlePreDragUp)
        window.removeEventListener('pointercancel', handlePreDragUp)
      }
    }
    const activeDrag = drag
    function handleDragMove(e: PointerEvent) {
      e.preventDefault()
      const target = findTileUnderPointer(e.clientX, e.clientY)
      setDrag(prev => {
        if (!prev) return prev
        const newTargetIdx = (target && target.kind === prev.kind) ? target.idx : null
        if (newTargetIdx === prev.targetIdx) return prev
        return { ...prev, targetIdx: newTargetIdx }
      })
    }
    function handleDragUp(e: PointerEvent) {
      const target = findTileUnderPointer(e.clientX, e.clientY)
      if (target && target.kind === activeDrag.kind && target.idx !== activeDrag.fromIdx) {
        if (activeDrag.kind === 'existing') moveExisting(activeDrag.fromIdx, target.idx)
        else moveNew(activeDrag.fromIdx, target.idx)
      }
      setDrag(null)
      pointerStartRef.current = null
    }
    window.addEventListener('pointermove', handleDragMove, { passive: false })
    window.addEventListener('pointerup', handleDragUp)
    window.addEventListener('pointercancel', handleDragUp)
    return () => {
      window.removeEventListener('pointermove', handleDragMove)
      window.removeEventListener('pointerup', handleDragUp)
      window.removeEventListener('pointercancel', handleDragUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag])

  return (
    <section className="mu-section">
      <style>{`
        .mu-section { margin-bottom: 4px; }
        .mu-head {
          display: flex; align-items: baseline; justify-content: space-between;
          gap: 12px; margin-bottom: 14px;
        }
        .mu-head h3 {
          font-family: 'Cormorant Garamond','Playfair Display',serif;
          font-weight: 500; font-size: 15px; color: var(--v-accent);
          letter-spacing: .16em; text-transform: uppercase; margin: 0;
        }
        .mu-count {
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 10.5px; color: var(--v-text-tertiary); letter-spacing: .04em;
        }
        .mu-count b { color: var(--v-accent-light); font-weight: 600; }

        .mu-drop {
          border: 1.5px dashed rgba(37, 99, 235,0.3);
          background: rgba(37, 99, 235,0.03);
          border-radius: 10px; padding: 24px; text-align: center;
          margin-bottom: 12px; cursor: pointer; transition: border-color .2s, background .2s;
        }
        .mu-drop.drag { border-color: var(--v-accent); background: rgba(37, 99, 235,0.07); }
        .mu-drop p {
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 12px; color: var(--v-text-tertiary);
        }
        .mu-drop p.sub { font-size: 10px; color: var(--v-text-tertiary); margin-top: 5px; letter-spacing: .04em; }

        .mu-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
        .mu-tile {
          position: relative; aspect-ratio: 1/1; border-radius: 8px; overflow: hidden;
          border: 1px solid rgba(37, 99, 235,0.08); background: var(--v-bg-base);
        }
        .mu-tile.cover { border-color: var(--v-accent); }
        .mu-tile.profile { border-color: #cdbfa0; }
        /* touch-action: manipulation keeps natural scrolling during the
           long-press window; during an active drag the global handler
           preventDefault's pointermove to block it. user-select:none avoids
           accidental text/img selection while holding. */
        .mu-tile.mu-draggable {
          cursor: grab;
          user-select: none;
          -webkit-user-select: none;
          touch-action: manipulation;
          -webkit-touch-callout: none;
        }
        .mu-tile.mu-draggable:active { cursor: grabbing; }
        .mu-tile.mu-dragging { opacity: 0.35; transition: opacity .15s ease; }
        .mu-tile.mu-drop-target {
          outline: 2px solid var(--v-accent);
          outline-offset: -2px;
          transform: scale(1.03);
          transition: transform .12s ease;
        }
        .mu-tile-media { width: 100%; height: 100%; object-fit: cover; display: block; }
        .mu-tile-grad {
          position: absolute; inset: 0; pointer-events: none;
          background: linear-gradient(180deg, rgba(8,8,8,0.55) 0%, transparent 30%, transparent 58%, rgba(8,8,8,0.78) 100%);
        }
        .mu-badges { position: absolute; top: 6px; left: 6px; z-index: 2; display: flex; flex-direction: column; gap: 3px; }
        .mu-badge {
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 8px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase;
          padding: 3px 7px 2px; border-radius: 3px;
        }
        .mu-badge.cover { background: var(--v-accent); color: var(--v-bg-base); }
        .mu-badge.profile { background: #e8e0cf; color: var(--v-bg-base); }
        .mu-badge.nuevo { background: rgba(37, 99, 235,0.85); color: var(--v-bg-base); }
        .mu-pos {
          position: absolute; top: 6px; right: 6px; z-index: 2;
          width: 18px; height: 18px; border-radius: 50%;
          background: rgba(8,8,8,0.72); border: 1px solid rgba(37, 99, 235,0.18);
          color: var(--v-text-primary);
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 9px; font-weight: 600;
          display: flex; align-items: center; justify-content: center;
        }
        .mu-ctrls {
          position: absolute; bottom: 6px; left: 0; right: 0; z-index: 2;
          display: flex; justify-content: center; gap: 4px;
        }
        .mu-cbtn {
          width: 24px; height: 24px; border-radius: 50%; padding: 0; cursor: pointer;
          background: rgba(8,8,8,0.78); backdrop-filter: blur(4px);
          display: flex; align-items: center; justify-content: center;
          transition: background .15s ease;
        }
        .mu-cbtn svg { width: 11px; height: 11px; }
        .mu-cbtn-edit { border: 1px solid rgba(255,255,255,0.18); color: rgba(255,255,255,0.7); }
        .mu-cbtn-edit:hover { color: #fff; background: rgba(8,8,8,0.92); }
        .mu-cbtn-cover { border: 1px solid rgba(37, 99, 235,0.4); color: var(--v-accent);
          font-family: 'Cormorant Garamond','Playfair Display',serif; font-weight: 600; font-size: 11px; }
        .mu-cbtn-cover.on { background: var(--v-accent); color: var(--v-bg-base); }
        .mu-cbtn-profile { border: 1px solid rgba(205,191,160,0.5); color: #cdbfa0;
          font-family: 'Cormorant Garamond','Playfair Display',serif; font-weight: 600; font-size: 11px; }
        .mu-cbtn-profile.on { background: #e8e0cf; color: var(--v-bg-base); }
        .mu-cbtn-del { border: 1px solid rgba(199,90,90,0.4); color: #e89898; }
        .mu-cbtn-del:hover { background: rgba(199,90,90,0.3); }

        .mu-vid {
          display: flex; align-items: center; justify-content: center;
          color: var(--v-accent); background: var(--v-bg-elevated);
        }
        .mu-vid svg { width: 26px; height: 26px; }
        .mu-audio {
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 5px; padding: 8px; background: rgba(37, 99, 235,0.04);
        }
        .mu-audio-name {
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 8px; color: var(--v-text-tertiary); text-align: center;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap; width: 100%;
        }
        .mu-empty {
          aspect-ratio: 1/1; border-radius: 8px;
          border: 1.5px dashed rgba(37, 99, 235,0.25); background: rgba(255,255,255,0.02);
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 5px; color: var(--v-accent); cursor: pointer; transition: border-color .2s;
        }
        .mu-empty:hover { border-color: var(--v-accent); }
        .mu-empty svg { width: 18px; height: 18px; }
        .mu-empty span {
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 9px; font-weight: 500; letter-spacing: .12em; text-transform: uppercase;
        }
        .mu-progress {
          position: absolute; bottom: 0; left: 0; right: 0; height: 3px;
          background: rgba(37, 99, 235,0.2);
        }
        .mu-progress > div { height: 100%; background: linear-gradient(90deg, var(--v-accent), var(--v-accent-light)); transition: width .2s; }
        .mu-hint {
          margin-top: 10px;
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 10.5px; color: var(--v-text-tertiary); line-height: 1.5;
        }
        .mu-hint-strong {
          display: block;
          margin-top: 6px;
          color: var(--v-text-secondary);
          font-weight: 500;
        }

        /* First-time tip — a banner over the grid with a moving-hand
           animation, so the user sees the correct gesture is press + drag
           (not tap + tap). Closes itself on the first reorder or on clicking
           the X. Persisted in localStorage. */
        .mu-tip {
          display: flex; align-items: center; gap: 10px;
          padding: 9px 12px;
          background: rgba(37, 99, 235,0.07);
          border: 1px solid rgba(37, 99, 235,0.22);
          border-radius: 8px;
          margin-bottom: 10px;
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 11.5px; line-height: 1.4;
          color: var(--v-text-secondary);
          animation: mu-tip-fadein .35s ease;
        }
        @keyframes mu-tip-fadein {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: none; }
        }
        .mu-tip-icon {
          font-size: 18px; flex-shrink: 0;
          animation: mu-tip-handwave 1.8s ease-in-out infinite;
          display: inline-block;
        }
        @keyframes mu-tip-handwave {
          0%, 60%, 100% { transform: translateX(0); }
          20% { transform: translateX(2px) rotate(6deg); }
          40% { transform: translateX(14px); }
        }
        .mu-tip-text { flex: 1; }
        .mu-tip-text b { color: var(--v-accent); font-weight: 500; }
        .mu-tip-close {
          background: none; border: none; color: rgba(255,255,255,0.4);
          font-size: 20px; line-height: 1; cursor: pointer; padding: 0 4px;
          flex-shrink: 0;
        }
        .mu-tip-close:hover { color: var(--v-text-secondary); }
      `}</style>

      <div className="mu-head">
        <h3>Fotos</h3>
        {tier && (
          <span className="mu-count">
            <b>{totalImages} / {tierLimits.photos}</b> fotos
            {tierLimits.videos > 0 && ` · ${totalVideos}/${tierLimits.videos} videos`}
            {tierLimits.audios > 0 && ` · ${hasAudio ? 1 : 0}/${tierLimits.audios} audio`}
          </span>
        )}
      </div>

      <div {...getRootProps()} className={`mu-drop ${isDragActive ? 'drag' : ''}`}>
        <input {...getInputProps()} />
        <p>Arrastrá imágenes{tierLimits.videos > 0 ? ', videos' : ''}{tierLimits.audios > 0 ? ' o audios' : ''} aquí</p>
        <p className="sub">o tocá para seleccionar</p>
      </div>

      {showTip && totalImages > 1 && (
        <div className="mu-tip" role="status">
          <span className="mu-tip-icon" aria-hidden="true">👆</span>
          <span className="mu-tip-text">
            <b>Mantené apretada</b> una foto y deslizala para reordenar. El orden de las fotos es el orden en que aparecen en la publicación.
          </span>
          <button type="button" className="mu-tip-close" aria-label="Cerrar ayuda" onClick={dismissTip}>×</button>
        </div>
      )}

      <div className="mu-grid">
        {existingImageUrls.map((url, i) => {
          const isProfile = profilePhotoUrl === url
          const isCover   = coverUrl === url
          const isDragging = drag?.kind === 'existing' && drag.fromIdx === i
          const isDropTarget = drag?.kind === 'existing' && drag.targetIdx === i && drag.fromIdx !== i
          return (
            <div
              key={url}
              data-tile-kind="existing"
              data-tile-idx={i}
              onPointerDown={ev => onTilePointerDown('existing', i, ev)}
              className={`mu-tile mu-draggable ${isCover ? 'cover' : isProfile ? 'profile' : ''} ${isDragging ? 'mu-dragging' : ''} ${isDropTarget ? 'mu-drop-target' : ''}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="Imagen del anuncio" className="mu-tile-media" draggable={false} />
              <div className="mu-tile-grad" />
              <div className="mu-badges">
                {isCover && <span className="mu-badge cover">Portada</span>}
                {isProfile && <span className="mu-badge profile">Perfil</span>}
              </div>
              <span className="mu-pos">{i + 1}</span>
              <div className="mu-ctrls">
                <button type="button" className="mu-cbtn mu-cbtn-edit" title="Editar / difuminar"
                  onClick={ev => { ev.stopPropagation(); setEditorSrc(url); setEditorTarget({ kind: 'existing', url }) }}>
                  <IcEdit />
                </button>
                <button type="button" className={`mu-cbtn mu-cbtn-cover ${isCover ? 'on' : ''}`}
                  title="Marcar como portada"
                  onClick={ev => { ev.stopPropagation(); setCoverUrl(url) }}>C</button>
                <button type="button" className={`mu-cbtn mu-cbtn-profile ${isProfile ? 'on' : ''}`}
                  title={isProfile ? 'Quitar foto de perfil' : 'Marcar como foto de perfil'}
                  onClick={ev => { ev.stopPropagation(); setProfilePhotoUrl(isProfile ? null : url) }}>P</button>
                <button type="button" className="mu-cbtn mu-cbtn-del" title="Eliminar"
                  onClick={ev => { ev.stopPropagation(); setExistingImageUrls?.(prev => prev.filter(u => u !== url)) }}>
                  <IcTrash />
                </button>
              </div>
            </div>
          )
        })}

        {newImagePreviews.map((url, i) => {
          const displayUrl = editedNewImages[i] ?? url
          const isProfile = profilePhotoUrl === displayUrl
          const isCover   = coverUrl === displayUrl
          const isDragging = drag?.kind === 'new' && drag.fromIdx === i
          const isDropTarget = drag?.kind === 'new' && drag.targetIdx === i && drag.fromIdx !== i
          return (
            <div
              key={`new-${i}`}
              data-tile-kind="new"
              data-tile-idx={i}
              onPointerDown={ev => onTilePointerDown('new', i, ev)}
              className={`mu-tile mu-draggable ${isCover ? 'cover' : isProfile ? 'profile' : ''} ${isDragging ? 'mu-dragging' : ''} ${isDropTarget ? 'mu-drop-target' : ''}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={displayUrl} alt="Imagen nueva del anuncio" className="mu-tile-media" draggable={false} />
              <div className="mu-tile-grad" />
              <div className="mu-badges">
                {isCover && <span className="mu-badge cover">Portada</span>}
                {isProfile && <span className="mu-badge profile">Perfil</span>}
                {!isCover && !isProfile && hasExisting && <span className="mu-badge nuevo">Nuevo</span>}
              </div>
              <span className="mu-pos">{existingImageUrls.length + i + 1}</span>
              <div className="mu-ctrls">
                <button type="button" className="mu-cbtn mu-cbtn-edit" title="Editar / difuminar"
                  onClick={ev => { ev.stopPropagation(); setEditorSrc(displayUrl); setEditorTarget({ kind: 'new', idx: i }) }}>
                  <IcEdit />
                </button>
                <button type="button" className={`mu-cbtn mu-cbtn-cover ${isCover ? 'on' : ''}`}
                  title="Marcar como portada"
                  onClick={ev => { ev.stopPropagation(); setCoverUrl(displayUrl) }}>C</button>
                <button type="button" className={`mu-cbtn mu-cbtn-profile ${isProfile ? 'on' : ''}`}
                  title={isProfile ? 'Quitar foto de perfil' : 'Marcar como foto de perfil'}
                  onClick={ev => { ev.stopPropagation(); setProfilePhotoUrl(isProfile ? null : displayUrl) }}>P</button>
                <button type="button" className="mu-cbtn mu-cbtn-del" title="Eliminar"
                  onClick={ev => {
                      ev.stopPropagation()
                      const preview = newImagePreviews[i]
                      if (preview?.startsWith('blob:')) URL.revokeObjectURL(preview)
                      setNewImageFiles(p => p.filter((_, idx) => idx !== i))
                      setNewImagePreviews(p => p.filter((_, idx) => idx !== i))
                      setEditedNewImages(p => {
                        const reindexed: Record<number, string> = {}
                        Object.entries(p).forEach(([k, v]) => {
                          const ki = parseInt(k)
                          if (ki === i) return
                          reindexed[ki > i ? ki - 1 : ki] = v
                        })
                        return reindexed
                      })
                      if (coverUrl === (editedNewImages[i] ?? preview)) {
                        const remaining = newImagePreviews.filter((_, idx) => idx !== i)
                        setCoverUrl(remaining[0] ?? null)
                      }
                    }}>
                  <IcTrash />
                </button>
              </div>
              {uploadProgress[i] !== undefined && uploadProgress[i] < 100 && (
                <div className="mu-progress"><div style={{ width: `${uploadProgress[i]}%` }} /></div>
              )}
            </div>
          )
        })}

        {existingVideoUrls.map((url, i) => (
          <div key={`evid-${i}`} className="mu-tile mu-vid">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" />
            </svg>
            <button type="button" className="mu-cbtn mu-cbtn-del" style={{ position: 'absolute', top: 6, right: 6 }}
              title="Eliminar video"
              onClick={() => setExistingVideoUrls?.(prev => prev.filter(u => u !== url))}>
              <IcTrash />
            </button>
          </div>
        ))}

        {newVideoFiles.map((_, i) => (
          <div key={`nvid-${i}`} className="mu-tile mu-vid">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" />
            </svg>
            {hasExisting && <span className="mu-badge nuevo" style={{ position: 'absolute', top: 6, left: 6 }}>Nuevo</span>}
            <button type="button" className="mu-cbtn mu-cbtn-del" style={{ position: 'absolute', top: 6, right: 6 }}
              title="Eliminar video"
              onClick={() => setNewVideoFiles(prev => prev.filter((_, idx) => idx !== i))}>
              <IcTrash />
            </button>
          </div>
        ))}

        {hasAudio && (
          <div className="mu-tile mu-audio">
            <svg width="30" height="22" viewBox="0 0 30 22" fill="none">
              {[3,7,2,10,5,8,3,6,4,9,5,7,3].map((h, wi) => (
                <rect key={wi} x={wi * 2.2 + 1} y={11 - h / 2} width="1.3" height={h} fill="rgba(37, 99, 235,0.75)" rx="0.6" />
              ))}
            </svg>
            <span className="mu-audio-name">{newAudioFile ? newAudioFile.name : (existingAudioFilename || 'Audio')}</span>
            <button type="button" className="mu-cbtn mu-cbtn-del" style={{ position: 'absolute', top: 6, right: 6 }}
              title="Eliminar audio"
              onClick={() => { setExistingAudioUrl?.(null); setExistingAudioFilename?.(''); setNewAudioFile(null) }}>
              <IcTrash />
            </button>
          </div>
        )}

        {totalImages < tierLimits.photos && (
          <div className="mu-empty" {...getRootProps()}>
            <input {...getInputProps()} />
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            <span>Subir</span>
          </div>
        )}
      </div>

      <p className="mu-hint">
        Tocá C para portada (card del feed) · P para foto de perfil (detalle) · ✎ para difuminar.
        <span className="mu-hint-strong">Presioná y arrastrá para cambiar el orden de las fotos.</span>
      </p>
    </section>
  )
}
