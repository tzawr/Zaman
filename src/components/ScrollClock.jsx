import { useEffect, useRef } from 'react'

/**
 * Full-bleed, fixed canvas that draws a holographic clock: nested glowing
 * dials sitting in a slow particle vortex, in Hengam's blue.
 *
 * Hour and minute hands follow smoothed page scroll, the seconds hand ticks
 * live, and the dials and vortex counter-rotate at different rates so the
 * scene has depth. The pointer nudges each layer by a different amount for
 * parallax. Nothing loops on its own beyond the tick and a very slow drift.
 *
 * Props:
 *   startHour, startMinute   time shown at scroll 0   (default 10:08)
 *   sweepMinutes             how far the hands travel over the page (120)
 */
export default function ScrollClock({ startHour = 10, startMinute = 8, sweepMinutes = 120 }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let width = 0
    let height = 0
    let dpr = 1
    let base = 0                 // min(width, height)
    let dials = []               // pre-rendered rings, outermost first
    let raf = 0

    let target = 0
    let smoothed = 0
    let pointerX = 0
    let pointerY = 0
    let px = 0
    let py = 0

    const particles = makeParticles(560)
    const softDot = makeSprite(64, [125, 211, 252], 0.9)
    const sharpDot = makeSprite(16, [224, 247, 255], 1)

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
      base = Math.min(width, height)
      const phone = width < 640
      dials = [
        // Big outer ring that runs off the edges, soft and out of focus.
        { r: base * (phone ? 0.95 : 0.82), spin: -0.10, alpha: 0.55, blur: 2.2, parallax: 26, dx: -0.06, dy: -0.04,
          canvas: renderDial(base * (phone ? 0.95 : 0.82), dpr, { numerals: true, numeralSize: 0.13, tickLen: 0.05, glow: 1.4, lineW: 0.006 }) },
        { r: base * 0.40, spin: 0.22, alpha: 0.9, blur: 0.6, parallax: 12, dx: 0, dy: 0,
          canvas: renderDial(base * 0.40, dpr, { numerals: true, numeralSize: 0.1, tickLen: 0.06, glow: 1.2, lineW: 0.007 }) },
        { r: base * 0.215, spin: -0.36, alpha: 1, blur: 0, parallax: 5, dx: 0.01, dy: 0.005,
          canvas: renderDial(base * 0.215, dpr, { numerals: true, numeralSize: 0.11, tickLen: 0.07, glow: 1, lineW: 0.009 }) },
        { r: base * 0.11, spin: 0.55, alpha: 0.85, blur: 0, parallax: 2, dx: 0, dy: 0,
          canvas: renderDial(base * 0.11, dpr, { numerals: false, tickLen: 0.1, glow: 0.8, lineW: 0.012 }) },
      ]
      readScroll()
    }

    function frame(now) {
      smoothed += (target - smoothed) * 0.12
      px += (pointerX - px) * 0.05
      py += (pointerY - py) * 0.05
      const t = now / 1000

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.globalCompositeOperation = 'source-over'
      drawBackground(ctx, width, height, smoothed)

      const cx = width * (width >= 1024 ? 0.58 : 0.5)
      const cy = height * 0.5

      ctx.globalCompositeOperation = 'lighter'
      drawVortex(ctx, particles, cx + px * 18, cy + py * 14, base * 0.5, t, smoothed, softDot, sharpDot, reduceMotion)

      for (const d of dials) {
        const rot = smoothed * d.spin * Math.PI * 2 * 0.5 + (reduceMotion ? 0 : t * d.spin * 0.02)
        const x = cx + d.dx * base + px * d.parallax
        const y = cy + d.dy * base + py * d.parallax
        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(rot)
        ctx.globalAlpha = d.alpha
        const s = d.canvas.width / dpr
        ctx.drawImage(d.canvas, -s / 2, -s / 2, s, s)
        ctx.restore()
      }
      ctx.globalAlpha = 1

      const time = computeTime(smoothed, startHour, startMinute, sweepMinutes, reduceMotion)
      drawHands(ctx, cx + px * 6, cy + py * 5, base, time)
      drawCore(ctx, cx + px * 6, cy + py * 5, base, t, reduceMotion)

      ctx.globalCompositeOperation = 'source-over'
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
  }, [startHour, startMinute, sweepMinutes])

  return (
    <div className="scroll-clock" aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  )
}

/* ------------------------------------------------------------------ */

const CYAN = '125, 211, 252'     // sky-300, sits between accent-1 and the reference's cyan
const BLUE = '96, 165, 250'      // --accent-1
const INDIGO = '99, 102, 241'    // --accent-2
const WHITE = '224, 247, 255'

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

function makeSprite(size, rgb, peak) {
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const g = c.getContext('2d')
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grad.addColorStop(0, `rgba(${rgb}, ${peak})`)
  grad.addColorStop(0.35, `rgba(${rgb}, ${peak * 0.35})`)
  grad.addColorStop(1, `rgba(${rgb}, 0)`)
  g.fillStyle = grad
  g.fillRect(0, 0, size, size)
  return c
}

/** Three spiral arms of dust, denser toward the middle, a few big bokeh. */
function makeParticles(n) {
  const rand = mulberry32(7)
  const out = []
  for (let i = 0; i < n; i++) {
    const arm = i % 3
    const r = 0.06 + Math.pow(rand(), 0.7) * 1.4
    const bokeh = rand() < 0.08
    out.push({
      r,
      a0: (arm * Math.PI * 2) / 3 + r * 3.2 + (rand() - 0.5) * 0.9,
      size: bokeh ? 6 + rand() * 12 : 0.7 + rand() * 2.2,
      alpha: bokeh ? 0.05 + rand() * 0.12 : 0.15 + rand() * 0.75,
      bokeh,
      streak: !bokeh && rand() < 0.45,
      wobble: rand() * Math.PI * 2,
    })
  }
  return out
}

function computeTime(progress, startHour, startMinute, sweepMinutes, reduceMotion) {
  const minutes = startHour * 60 + startMinute + progress * sweepMinutes
  const minuteAngle = ((minutes % 60) / 60) * Math.PI * 2
  const hourAngle = ((minutes % 720) / 720) * Math.PI * 2

  const d = new Date()
  const sec = d.getSeconds()
  const ms = d.getMilliseconds()
  let tick = 1
  if (!reduceMotion && ms < 220) {
    const t = ms / 220
    tick = easeOutBack(t)
  }
  const secondAngle = ((sec - 1 + tick) / 60) * Math.PI * 2
  return { hourAngle, minuteAngle, secondAngle }
}

function easeOutBack(t) {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

/* ------------------------------------------------------------------ */

function drawBackground(ctx, w, h, progress) {
  ctx.fillStyle = '#030816'
  ctx.fillRect(0, 0, w, h)

  const cx = w * (w >= 1024 ? 0.58 : 0.5)
  const cy = h * 0.5
  const R = Math.max(w, h)

  // Blue nebula around the clock, drifting up as the page scrolls.
  const neb = ctx.createRadialGradient(cx, cy + h * 0.1 - progress * h * 0.2, 0, cx, cy, R * 0.75)
  neb.addColorStop(0, `rgba(${BLUE}, 0.30)`)
  neb.addColorStop(0.35, `rgba(37, 99, 235, 0.16)`)
  neb.addColorStop(0.7, `rgba(${INDIGO}, 0.06)`)
  neb.addColorStop(1, 'rgba(3, 8, 22, 0)')
  ctx.fillStyle = neb
  ctx.fillRect(0, 0, w, h)

  // Secondary indigo pool low-left for asymmetry.
  const pool = ctx.createRadialGradient(w * 0.15, h * 0.95, 0, w * 0.15, h * 0.95, R * 0.6)
  pool.addColorStop(0, `rgba(${INDIGO}, 0.18)`)
  pool.addColorStop(1, `rgba(${INDIGO}, 0)`)
  ctx.fillStyle = pool
  ctx.fillRect(0, 0, w, h)

  // Vignette.
  const vig = ctx.createRadialGradient(cx, cy, R * 0.35, cx, cy, R * 0.85)
  vig.addColorStop(0, 'rgba(3, 8, 22, 0)')
  vig.addColorStop(1, 'rgba(3, 8, 22, 0.75)')
  ctx.fillStyle = vig
  ctx.fillRect(0, 0, w, h)
}

function drawVortex(ctx, particles, cx, cy, R, t, progress, softDot, sharpDot, reduceMotion) {
  const spin = progress * 1.1 + (reduceMotion ? 0 : t * 0.025)
  for (const p of particles) {
    // Inner dust orbits faster than outer, which is what makes it read as a vortex.
    const a = p.a0 + spin * (0.5 + 0.9 / (p.r + 0.35))
    const wob = reduceMotion ? 0 : Math.sin(t * 0.6 + p.wobble) * 0.012
    const r = (p.r + wob) * R
    const x = cx + Math.cos(a) * r
    const y = cy + Math.sin(a) * r

    ctx.globalAlpha = p.alpha
    if (p.bokeh) {
      const s = p.size * 2.4
      ctx.drawImage(softDot, x - s / 2, y - s / 2, s, s)
      continue
    }
    if (p.streak) {
      ctx.strokeStyle = `rgba(${CYAN}, ${p.alpha * 0.55})`
      ctx.lineWidth = p.size * 0.6
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.arc(cx, cy, r, a - 0.045 - 0.02 / p.r * 0.2, a)
      ctx.stroke()
    }
    const s = p.size * 3
    ctx.drawImage(softDot, x - s / 2, y - s / 2, s, s)
    if (p.alpha > 0.6) {
      const k = p.size * 1.1
      ctx.drawImage(sharpDot, x - k / 2, y - k / 2, k, k)
    }
  }
  ctx.globalAlpha = 1
}

/**
 * One glowing ring: 60 ticks (12 major) and optional numerals 1..12.
 * Rendered once into an offscreen canvas. Glow is baked in with shadowBlur,
 * and an optional blur pass takes the ring out of focus.
 */
function renderDial(r, dpr, { numerals, numeralSize = 0.1, tickLen, glow, lineW }) {
  const pad = r * 1.3
  const size = Math.ceil(pad * 2 * dpr)
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.translate(pad, pad)
  ctx.lineCap = 'round'

  const draw = (shadow) => {
    ctx.shadowColor = `rgba(${CYAN}, ${shadow ? 0.9 : 0})`
    ctx.shadowBlur = shadow ? r * 0.06 * glow : 0
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2
      const major = i % 5 === 0
      const len = r * tickLen * (major ? 1 : 0.45)
      const outer = r
      ctx.strokeStyle = major ? `rgba(${WHITE}, 0.95)` : `rgba(${CYAN}, 0.7)`
      ctx.lineWidth = r * lineW * (major ? 1 : 0.55)
      ctx.beginPath()
      ctx.moveTo(Math.sin(a) * (outer - len), -Math.cos(a) * (outer - len))
      ctx.lineTo(Math.sin(a) * outer, -Math.cos(a) * outer)
      ctx.stroke()
    }
    if (numerals) {
      const fs = r * numeralSize
      ctx.font = `700 ${fs}px Inter, system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = `rgba(${WHITE}, 0.95)`
      const nr = r * 1.13
      for (let i = 1; i <= 12; i++) {
        const a = (i / 12) * Math.PI * 2
        ctx.fillText(String(i), Math.sin(a) * nr, -Math.cos(a) * nr + fs * 0.05)
      }
    }
  }
  draw(true)   // glow pass
  draw(true)   // second pass thickens the bloom
  draw(false)  // crisp core

  // Faint ring line behind the ticks.
  ctx.shadowBlur = 0
  ctx.strokeStyle = `rgba(${CYAN}, 0.18)`
  ctx.lineWidth = r * 0.004
  ctx.beginPath()
  ctx.arc(0, 0, r - r * tickLen * 0.5, 0, Math.PI * 2)
  ctx.stroke()

  return c
}

function drawHands(ctx, cx, cy, base, { hourAngle, minuteAngle, secondAngle }) {
  ctx.save()
  ctx.translate(cx, cy)
  beam(ctx, hourAngle, base * 0.19, base * 0.013, base * 0.028)
  beam(ctx, minuteAngle, base * 0.31, base * 0.011, base * 0.032)
  // Seconds — thinner, longer, less bloom.
  ctx.save()
  ctx.rotate(secondAngle)
  ctx.lineCap = 'round'
  ctx.shadowColor = `rgba(${CYAN}, 0.9)`
  ctx.shadowBlur = base * 0.015
  ctx.strokeStyle = `rgba(${CYAN}, 0.75)`
  ctx.lineWidth = base * 0.003
  ctx.beginPath()
  ctx.moveTo(0, base * 0.03)
  ctx.lineTo(0, -base * 0.37)
  ctx.stroke()
  ctx.restore()
  ctx.restore()
}

/** A glowing hand: wide soft bloom, a bright cyan body and a white core. */
function beam(ctx, angle, length, width, bloom) {
  ctx.save()
  ctx.rotate(angle)
  ctx.lineCap = 'round'

  ctx.shadowColor = `rgba(${BLUE}, 1)`
  ctx.shadowBlur = bloom
  ctx.strokeStyle = `rgba(${CYAN}, 0.55)`
  ctx.lineWidth = width * 1.8
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(0, -length)
  ctx.stroke()

  ctx.shadowBlur = bloom * 0.4
  ctx.strokeStyle = `rgba(${CYAN}, 0.95)`
  ctx.lineWidth = width
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(0, -length)
  ctx.stroke()

  ctx.shadowBlur = 0
  ctx.strokeStyle = `rgba(${WHITE}, 0.95)`
  ctx.lineWidth = width * 0.35
  ctx.beginPath()
  ctx.moveTo(0, -length * 0.04)
  ctx.lineTo(0, -length * 0.97)
  ctx.stroke()
  ctx.restore()
}

function drawCore(ctx, cx, cy, base, t, reduceMotion) {
  const pulse = reduceMotion ? 1 : 1 + Math.sin(t * 2.2) * 0.06
  const R = base * 0.075 * pulse
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R)
  g.addColorStop(0, 'rgba(255, 255, 255, 1)')
  g.addColorStop(0.12, `rgba(${WHITE}, 0.9)`)
  g.addColorStop(0.35, `rgba(${CYAN}, 0.45)`)
  g.addColorStop(1, `rgba(${BLUE}, 0)`)
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, Math.PI * 2)
  ctx.fill()
}
