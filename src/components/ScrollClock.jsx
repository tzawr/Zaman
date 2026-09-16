import { useEffect, useRef } from 'react'

/**
 * Full-bleed, fixed canvas that draws a lit analogue clock.
 *
 * The hour and minute hands are driven by page scroll (smoothed with the same
 * lerp the NovaAI scroll-video uses), the seconds hand ticks in real time, and
 * the whole face tilts a few degrees toward the pointer so the bezel and hand
 * shadows read as depth. Nothing loops or autoplays: with no scroll and no
 * pointer the only motion is the one-per-second tick.
 *
 * Props:
 *   startHour   hour the hands show at scroll 0            (default 9)
 *   sweepMinutes how far the hands travel over the page   (default 120)
 */
export default function ScrollClock({ startHour = 9, sweepMinutes = 120 }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let width = 0
    let height = 0
    let dpr = 1
    let face = null            // offscreen static face (bezel, dial, ticks)
    let faceRadius = 0
    let raf = 0

    // Scroll → progress, smoothed.
    let target = 0
    let smoothed = 0
    // Pointer parallax, normalised to [-1, 1], smoothed.
    let pointerX = 0
    let pointerY = 0
    let tiltX = 0
    let tiltY = 0

    // Bokeh particles, seeded so a reload looks the same.
    const particles = makeParticles(34)

    function readScroll() {
      const max = document.documentElement.scrollHeight - window.innerHeight
      target = max > 0 ? clamp(window.scrollY / max, 0, 1) : 0
    }

    function onPointer(e) {
      if (reduceMotion) return
      pointerX = (e.clientX / window.innerWidth) * 2 - 1
      pointerY = (e.clientY / window.innerHeight) * 2 - 1
    }

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = window.innerWidth
      height = window.innerHeight
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      faceRadius = Math.min(width, height) * (width < 640 ? 0.36 : 0.30)
      face = renderFace(faceRadius, dpr)
      readScroll()
    }

    function frame(now) {
      smoothed += (target - smoothed) * 0.12
      tiltX += (pointerX - tiltX) * 0.06
      tiltY += (pointerY - tiltY) * 0.06

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      drawBackground(ctx, width, height, particles, now, smoothed)

      // Where the clock sits. Slightly right of centre on wide screens so the
      // headline on the left has room, dead centre on phones.
      const cx = width * (width >= 1024 ? 0.58 : 0.5) + tiltX * 10
      const cy = height * 0.5 + tiltY * 8
      const zoom = 1 + smoothed * 0.08

      ctx.save()
      ctx.translate(cx, cy)
      // Faux perspective: rotate a touch toward the pointer and squash the
      // axis that is tilting away.
      ctx.rotate(tiltX * 0.035)
      ctx.scale(zoom * (1 - Math.abs(tiltX) * 0.03), zoom * (1 - Math.abs(tiltY) * 0.04))

      // Drop shadow under the whole object, offset away from the light.
      ctx.save()
      ctx.shadowColor = 'rgba(0,0,0,0.6)'
      ctx.shadowBlur = faceRadius * 0.5
      ctx.shadowOffsetX = faceRadius * 0.08
      ctx.shadowOffsetY = faceRadius * 0.14
      ctx.fillStyle = '#0a0a0a'
      ctx.beginPath()
      ctx.arc(0, 0, faceRadius, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()

      ctx.drawImage(face, -faceRadius * 1.15, -faceRadius * 1.15, faceRadius * 2.3, faceRadius * 2.3)

      drawHands(ctx, faceRadius, computeTime(now, smoothed, startHour, sweepMinutes, reduceMotion))
      drawGlass(ctx, faceRadius)
      ctx.restore()

      raf = requestAnimationFrame(frame)
    }

    resize()
    window.addEventListener('resize', resize)
    window.addEventListener('scroll', readScroll, { passive: true })
    window.addEventListener('pointermove', onPointer, { passive: true })
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      window.removeEventListener('scroll', readScroll)
      window.removeEventListener('pointermove', onPointer)
    }
  }, [startHour, sweepMinutes])

  return (
    <div className="scroll-clock" aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  )
}

/* ------------------------------------------------------------------ */

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v))
}

function mulberry32(seed) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeParticles(n) {
  const rand = mulberry32(1402)
  return Array.from({ length: n }, () => ({
    x: rand(),
    y: rand(),
    r: 1.5 + rand() * 5,
    speed: 0.004 + rand() * 0.01,
    phase: rand() * Math.PI * 2,
    warm: rand() < 0.3,
    alpha: 0.08 + rand() * 0.22,
  }))
}

function computeTime(now, progress, startHour, sweepMinutes, reduceMotion) {
  const minutes = startHour * 60 + progress * sweepMinutes
  const minuteAngle = ((minutes % 60) / 60) * Math.PI * 2
  const hourAngle = ((minutes % 720) / 720) * Math.PI * 2

  // Live seconds with a short mechanical tick: the hand jumps, overshoots a
  // hair, and settles inside ~180ms. Reduced motion just steps.
  const d = new Date()
  const sec = d.getSeconds()
  const ms = d.getMilliseconds()
  let tick = 1
  if (!reduceMotion && ms < 180) {
    const t = ms / 180
    tick = 1 + Math.sin(t * Math.PI) * 0.35 * (1 - t) // small overshoot that decays
    tick = t < 0.5 ? easeOut(t * 2) * tick : tick
  }
  const secondAngle = ((sec - 1 + tick) / 60) * Math.PI * 2
  void now
  return { hourAngle, minuteAngle, secondAngle }
}

function easeOut(t) {
  return 1 - Math.pow(1 - t, 3)
}

/* ------------------------------------------------------------------ */

function drawBackground(ctx, w, h, particles, now, progress) {
  ctx.fillStyle = '#0a0a0a'
  ctx.fillRect(0, 0, w, h)

  // Blue-grey mist that drifts up as you scroll.
  const mist = ctx.createRadialGradient(w * 0.62, h * (0.75 - progress * 0.35), 0, w * 0.62, h * 0.5, Math.max(w, h) * 0.75)
  mist.addColorStop(0, 'rgba(84, 98, 122, 0.30)')
  mist.addColorStop(0.5, 'rgba(46, 54, 70, 0.14)')
  mist.addColorStop(1, 'rgba(10, 10, 10, 0)')
  ctx.fillStyle = mist
  ctx.fillRect(0, 0, w, h)

  // Warm floor glow from the clock's own light, low and right.
  const warm = ctx.createRadialGradient(w * 0.7, h * 1.05, 0, w * 0.7, h * 1.05, h * 0.9)
  warm.addColorStop(0, 'rgba(232, 180, 90, 0.10)')
  warm.addColorStop(1, 'rgba(232, 180, 90, 0)')
  ctx.fillStyle = warm
  ctx.fillRect(0, 0, w, h)

  // Bokeh.
  const t = now / 1000
  for (const p of particles) {
    const y = ((p.y - t * p.speed - progress * 0.15) % 1 + 1) % 1
    const x = p.x + Math.sin(t * 0.3 + p.phase) * 0.01
    const px = x * w
    const py = y * h
    const g = ctx.createRadialGradient(px, py, 0, px, py, p.r * 3)
    const col = p.warm ? '232, 180, 90' : '200, 210, 230'
    g.addColorStop(0, `rgba(${col}, ${p.alpha})`)
    g.addColorStop(1, `rgba(${col}, 0)`)
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(px, py, p.r * 3, 0, Math.PI * 2)
    ctx.fill()
  }
}

/**
 * Pre-renders the parts of the clock that do not move: the brushed bezel,
 * the recessed dial and the tick marks. Light comes from the upper-left.
 */
function renderFace(r, dpr) {
  const pad = r * 1.15
  const size = Math.ceil(pad * 2 * dpr)
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.translate(pad, pad)

  // Bezel — brushed metal, lit top-left, darker bottom-right.
  const bezelOuter = r
  const bezelInner = r * 0.9
  const metal = ctx.createLinearGradient(-r, -r, r, r)
  metal.addColorStop(0, '#f4f4f2')
  metal.addColorStop(0.18, '#c9c9c6')
  metal.addColorStop(0.42, '#6d6e70')
  metal.addColorStop(0.6, '#8f9093')
  metal.addColorStop(0.82, '#3a3b3e')
  metal.addColorStop(1, '#1c1c1e')
  ctx.beginPath()
  ctx.arc(0, 0, bezelOuter, 0, Math.PI * 2)
  ctx.fillStyle = metal
  ctx.fill()

  // Fine bevel lines on the bezel to sell the machined edge.
  ctx.lineWidth = r * 0.006
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'
  ctx.beginPath()
  ctx.arc(0, 0, bezelOuter - r * 0.012, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(0,0,0,0.55)'
  ctx.beginPath()
  ctx.arc(0, 0, bezelInner + r * 0.01, 0, Math.PI * 2)
  ctx.stroke()

  // Dial — dark graphite, recessed: darker rim, inner shadow along the top.
  const dial = ctx.createRadialGradient(-r * 0.2, -r * 0.25, r * 0.1, 0, 0, bezelInner)
  dial.addColorStop(0, '#1d1f24')
  dial.addColorStop(0.7, '#111216')
  dial.addColorStop(1, '#090a0c')
  ctx.beginPath()
  ctx.arc(0, 0, bezelInner, 0, Math.PI * 2)
  ctx.fillStyle = dial
  ctx.fill()

  ctx.save()
  ctx.beginPath()
  ctx.arc(0, 0, bezelInner, 0, Math.PI * 2)
  ctx.clip()
  const inner = ctx.createRadialGradient(0, r * 0.15, bezelInner * 0.75, 0, 0, bezelInner)
  inner.addColorStop(0, 'rgba(0,0,0,0)')
  inner.addColorStop(1, 'rgba(0,0,0,0.65)')
  ctx.fillStyle = inner
  ctx.fillRect(-r, -r, r * 2, r * 2)
  ctx.restore()

  // Ticks.
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2
    const hour = i % 5 === 0
    const len = hour ? r * 0.075 : r * 0.03
    const outer = bezelInner - r * 0.045
    ctx.beginPath()
    ctx.moveTo(Math.sin(a) * (outer - len), -Math.cos(a) * (outer - len))
    ctx.lineTo(Math.sin(a) * outer, -Math.cos(a) * outer)
    ctx.lineWidth = hour ? r * 0.012 : r * 0.004
    ctx.lineCap = 'round'
    ctx.strokeStyle = hour ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.32)'
    ctx.stroke()
  }

  // Quarter markers as small mono numerals.
  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  ctx.font = `500 ${Math.round(r * 0.075)}px Inter, system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const numR = bezelInner - r * 0.2
  ctx.fillText('12', 0, -numR)
  ctx.fillText('3', numR, 0)
  ctx.fillText('6', 0, numR)
  ctx.fillText('9', -numR, 0)

  return c
}

function drawHands(ctx, r, { hourAngle, minuteAngle, secondAngle }) {
  // Shadows first, offset away from the top-left light, growing with the
  // hand's height above the dial.
  hand(ctx, hourAngle, r * 0.5, r * 0.055, 'rgba(0,0,0,0.55)', r * 0.03, r * 0.045, true)
  hand(ctx, minuteAngle, r * 0.74, r * 0.04, 'rgba(0,0,0,0.5)', r * 0.045, r * 0.065, true)

  hand(ctx, hourAngle, r * 0.5, r * 0.055, '#f3f3f1', 0, 0, false)
  hand(ctx, minuteAngle, r * 0.74, r * 0.04, '#ffffff', 0, 0, false)

  // Seconds — thin, warm, with a glowing tip and a short counterweight.
  ctx.save()
  ctx.rotate(secondAngle)
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = r * 0.03
  ctx.shadowOffsetX = r * 0.04
  ctx.shadowOffsetY = r * 0.06
  ctx.strokeStyle = '#e8b45a'
  ctx.lineWidth = r * 0.012
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(0, r * 0.18)
  ctx.lineTo(0, -r * 0.8)
  ctx.stroke()
  ctx.shadowColor = 'rgba(255, 196, 110, 0.9)'
  ctx.shadowBlur = r * 0.08
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 0
  ctx.fillStyle = '#ffd98a'
  ctx.beginPath()
  ctx.arc(0, -r * 0.8, r * 0.022, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  // Centre cap.
  const cap = ctx.createRadialGradient(-r * 0.01, -r * 0.01, 0, 0, 0, r * 0.05)
  cap.addColorStop(0, '#ffffff')
  cap.addColorStop(0.6, '#b8b8b6')
  cap.addColorStop(1, '#2a2a2c')
  ctx.beginPath()
  ctx.arc(0, 0, r * 0.05, 0, Math.PI * 2)
  ctx.fillStyle = cap
  ctx.fill()
  ctx.beginPath()
  ctx.arc(0, 0, r * 0.018, 0, Math.PI * 2)
  ctx.fillStyle = '#e8b45a'
  ctx.fill()
}

function hand(ctx, angle, length, width, color, dx, dy, isShadow) {
  ctx.save()
  ctx.translate(dx, dy)
  ctx.rotate(angle)
  if (isShadow) {
    ctx.filter = 'blur(2px)'
  }
  ctx.fillStyle = color
  ctx.beginPath()
  // Tapered baton: wide at the hub, narrowing to a rounded tip.
  ctx.moveTo(-width * 0.5, length * 0.18)
  ctx.lineTo(-width * 0.5, -length * 0.85)
  ctx.quadraticCurveTo(0, -length, width * 0.5, -length * 0.85)
  ctx.lineTo(width * 0.5, length * 0.18)
  ctx.arc(0, length * 0.18, width * 0.5, 0, Math.PI)
  ctx.closePath()
  ctx.fill()
  if (!isShadow) {
    // Light edge on the side facing the light source.
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'
    ctx.lineWidth = Math.max(0.8, width * 0.12)
    ctx.beginPath()
    ctx.moveTo(-width * 0.5, length * 0.1)
    ctx.lineTo(-width * 0.5, -length * 0.85)
    ctx.stroke()
  }
  ctx.restore()
}

function drawGlass(ctx, r) {
  const inner = r * 0.9
  ctx.save()
  ctx.beginPath()
  ctx.arc(0, 0, inner, 0, Math.PI * 2)
  ctx.clip()
  // Broad sheen across the upper-left of the crystal.
  const sheen = ctx.createLinearGradient(-inner, -inner, inner * 0.3, inner * 0.5)
  sheen.addColorStop(0, 'rgba(255,255,255,0.14)')
  sheen.addColorStop(0.45, 'rgba(255,255,255,0.04)')
  sheen.addColorStop(0.5, 'rgba(255,255,255,0)')
  ctx.fillStyle = sheen
  ctx.fillRect(-r, -r, r * 2, r * 2)
  // Tight rim reflection.
  ctx.strokeStyle = 'rgba(255,255,255,0.10)'
  ctx.lineWidth = r * 0.02
  ctx.beginPath()
  ctx.arc(0, 0, inner - r * 0.02, Math.PI * 1.05, Math.PI * 1.6)
  ctx.stroke()
  ctx.restore()
}
