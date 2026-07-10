'use client'

export function ProtectedImage({ src, alt, style, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      draggable={false}
      onContextMenu={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
      style={{ userSelect: 'none', WebkitUserSelect: 'none', pointerEvents: 'none', ...style }}
      {...props}
    />
  )
}

export function ProtectedVideo({ src, children, ...props }: React.VideoHTMLAttributes<HTMLVideoElement>) {
  return (
    <div style={{ position: 'relative', userSelect: 'none' }}>
      <video
        src={src}
        controlsList="nodownload nofullscreen"
        disablePictureInPicture
        onContextMenu={(e) => e.preventDefault()}
        {...props}
      >
        {children}
      </video>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 1,
          background: 'transparent',
        }}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  )
}
