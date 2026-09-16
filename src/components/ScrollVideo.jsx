import { useEffect, useRef, useState } from 'react'

/**
 * Fixed full-bleed video background whose timeline is driven by page scroll.
 *
 * Layers, bottom to top:
 *   1. poster <img>   — fades out once the video has a decoded frame
 *   2. <video>        — visible until the frame cache is ready; seeked as a fallback
 *   3. <canvas>       — draws cached ImageBitmaps by smoothed scroll progress
 *
 * progress = scrollY / (scrollHeight - innerHeight), lerped 0.12 per frame.
 * Up to FRAME_CAP frames (or duration * 12, min 24) are extracted from an
 * offscreen copy of the same file at MAX_FRAME_WIDTH so scrubbing never
 * waits on the decoder. Nothing autoplays; motion is scroll-driven only.
 */
const FRAME_CAP = 90
const MAX_FRAME_WIDTH = 960
const LERP = 0.12
const SEEK_EPSILON = 0.04

export default function ScrollVideo({ src, poster }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const [hasFrame, setHasFrame] = useState(false)
  const [framesReady, setFramesReady] = useState(false)

  useEffect(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    const ctx = canvas.getContext('2d')

    let raf = 0
    let cancelled = false
    let target = 0
    let smoothed = 0
    let frames = null       // ImageBitmap[]
    let frameW = 0
    let frameH = 0
    let width = 0
    let height = 0
    let dpr = 1
    let lastDrawn = -1

    function readScroll() {
      const max = document.documentElement.scrollHeight - window.innerHeight
      target = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0
    }

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = window.innerWidth
      height = window.innerHeight
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      lastDrawn = -1
      readScroll()
    }

    // object-cover: scale to the larger ratio, centre-crop.
    function drawCover(bitmap) {
      const scale = Math.max(width / frameW, height / frameH)
      const dw = frameW * scale
      const dh = frameH * scale
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.drawImage(bitmap, (width - dw) / 2, (height - dh) / 2, dw, dh)
    }

    function frame() {
      smoothed += (target - smoothed) * LERP
      if (frames) {
        const idx = Math.round(smoothed * (frames.length - 1))
        if (idx !== lastDrawn) {
          drawCover(frames[idx])
          lastDrawn = idx
        }
      } else if (video.duration && video.readyState >= 1) {
        const want = smoothed * Math.max(0, video.duration - 0.05)
        if (Math.abs(video.currentTime - want) > SEEK_EPSILON && !video.seeking) {
          video.currentTime = want
        }
      }
      raf = requestAnimationFrame(frame)
    }

    async function buildFrameCache() {
      // Yield so the visible video's first frame paints before we hammer the decoder.
      await new Promise((r) => setTimeout(r, 300))
      if (cancelled) return

      const off = document.createElement('video')
      off.muted = true
      off.playsInline = true
      off.preload = 'auto'
      off.src = src
      await new Promise((resolve, reject) => {
        off.addEventListener('loadeddata', resolve, { once: true })
        off.addEventListener('error', reject, { once: true })
      })
      if (cancelled) return

      const duration = off.duration
      const count = Math.max(24, Math.min(FRAME_CAP, Math.floor(duration * 12)))
      const scale = Math.min(1, MAX_FRAME_WIDTH / off.videoWidth)
      frameW = Math.round(off.videoWidth * scale)
      frameH = Math.round(off.videoHeight * scale)

      const scratch = document.createElement('canvas')
      scratch.width = frameW
      scratch.height = frameH
      const sctx = scratch.getContext('2d')

      const out = []
      for (let i = 0; i < count; i++) {
        if (cancelled) return
        const t = (i / (count - 1)) * Math.max(0, duration - 0.05)
        await new Promise((resolve) => {
          off.addEventListener('seeked', resolve, { once: true })
          off.currentTime = t
        })
        sctx.drawImage(off, 0, 0, frameW, frameH)
        out.push(await createImageBitmap(scratch))
      }
      if (cancelled) {
        out.forEach((b) => b.close())
        return
      }
      frames = out
      lastDrawn = -1
      setFramesReady(true)
    }

    function onLoadedData() {
      setHasFrame(true)
      buildFrameCache().catch(() => {
        // Frame cache failed (codec or memory); the seek fallback keeps working.
      })
    }

    resize()
    window.addEventListener('resize', resize)
    window.addEventListener('scroll', readScroll, { passive: true })
    if (video.readyState >= 2) onLoadedData()
    else video.addEventListener('loadeddata', onLoadedData, { once: true })
    raf = requestAnimationFrame(frame)

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      window.removeEventListener('scroll', readScroll)
      video.removeEventListener('loadeddata', onLoadedData)
      if (frames) frames.forEach((b) => b.close())
    }
  }, [src])

  return (
    <div className="scroll-video" aria-hidden="true">
      {poster && (
        <img
          src={poster}
          alt=""
          className={`scroll-video-layer ${hasFrame || framesReady ? 'is-hidden' : ''}`}
        />
      )}
      <video
        ref={videoRef}
        src={src}
        muted
        playsInline
        preload="auto"
        className={`scroll-video-layer ${hasFrame && !framesReady ? '' : 'is-hidden'}`}
      />
      <canvas ref={canvasRef} className={`scroll-video-layer ${framesReady ? '' : 'is-hidden'}`} />
    </div>
  )
}
