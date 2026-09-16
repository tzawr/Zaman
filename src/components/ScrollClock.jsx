import { useEffect, useRef } from 'react'

/**
 * Full-bleed, fixed canvas: the viewport is a window into an enormous,
 * multi-layer holographic timepiece. Five concentric dial systems sit at
 * different apparent depths around a pivot at (58% w, 56% h); the outer
 * ones run far past the viewport edges so their numerals are cropped.
 *
 * All geometry is relative to U = max(viewport width, height) so the
 * composition stays oversized on every aspect ratio.
 *
 * Per frame: background, far dust, dial ticks (batched paths), numeral
 * sprites (pre-rendered with baked glow), hands, core, near dust.
 * No React state is touched inside the loop.
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
    let U = 0
    let layers = []
    let hands = null
    let bg = null
    let raf = 0

    let target = 0
    let smoothed = 0
    let pointerX = 0
    let pointerY = 0
    let px = 0
    let py = 0

    const dust = makeDust(620)
    const arcs = makeArcs(14)
    const softDot = makeSprite(64, CYAN, 0.9)
    const sharpDot = makeSprite(12, WHITE, 1)

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
      U = Math.max(width, height)
      layers = buildLayers(U, dpr)
      hands = buildHands(U, dpr)
      bg = buildBackground(width, height, width * 0.58, height * 0.56, U, dpr)
      readScroll()
    }

    function frame(now) {
      smoothed += (target - smoothed) * 0.12
      px += (pointerX - px) * 0.05
      py += (pointerY - py) * 0.05
      const t = reduceMotion ? 0 : now / 1000

      const cx = width * 0.58
      const cy = height * 0.56

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.globalCompositeOperation = 'source-over'
      ctx.drawImage(bg, 0, 0, width, height)

      ctx.globalCompositeOperation = 'lighter'
      drawArcs(ctx, arcs, cx + px * 14, cy + py * 10, U, t, smoothed)
      drawDust(ctx, dust, cx, cy, U, t, smoothed, px, py, softDot, sharpDot, 'far')

      for (const L of layers) {
        const rot = L.rot0 + smoothed * L.spin + t * L.drift
        drawLayer(ctx, L, cx + L.ox * U + px * L.parallax, cy + L.oy * U + py * L.parallax * 0.8, rot)
      }

      const time = computeTime(smoothed, startHour, startMinute, sweepMinutes, t, reduceMotion)
      const hx = cx + px * 5
      const hy = cy + py * 4
      drawAtmosphere(ctx, hx, hy, U, t)
      drawHands(ctx, hx, hy, hands, time)
      drawCore(ctx, hx, hy, hands, t)
      drawDust(ctx, dust, cx, cy, U, t, smoothed, px, py, softDot, sharpDot, 'near')

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

const CYAN = '125, 211, 252'   // sky-300
const BLUE = '96, 165, 250'    // --accent-1
const DEEP = '37, 99, 235'     // blue-600
const WHITE = '236, 250, 255'

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
  grad.addColorStop(0.3, `rgba(${rgb}, ${peak * 0.35})`)
  grad.addColorStop(1, `rgba(${rgb}, 0)`)
  g.fillStyle = grad
  g.fillRect(0, 0, size, size)
  return c
}

/* ---------------------------- layers ------------------------------ */

/**
 * Dial systems, outermost first. Radii are fractions of U.
 *   rot0     resting rotation (the reference has 12 sitting at the left)
 *   spin     radians of rotation across the full page scroll
 *   drift    radians per second at rest
 *   ticks    [{ every, len, w, alpha }] — 'every' is the tick count around the ring
 */
function buildLayers(U, dpr) {
  const defs = [
    { // A — colossal outer dial, mostly off-screen, soft and dim
      r: 0.66, ox: -0.11, oy: 0.03, rot0: -1.0, spin: 0.22, drift: 0.0025, parallax: 34, alpha: 0.42, soft: 1.8,
      ring: { at: 0.985, alpha: 0.10, w: 0.0035 },
      ticks: [
        { every: 12, len: 0.06, w: 0.0055, alpha: 0.9 },
        { every: 60, len: 0.026, w: 0.0026, alpha: 0.55 },
        { every: 240, len: 0.011, w: 0.0012, alpha: 0.35 },
      ],
      numerals: { at: 0.885, font: 0.085, alpha: 0.85, blur: 1.1, weight: 600 },
    },
    { // B — large middle dial filling the viewport
      r: 0.41, ox: -0.065, oy: 0.035, rot0: -1.42, spin: -0.42, drift: -0.004, parallax: 20, alpha: 0.78, soft: 1.0,
      ring: { at: 0.975, alpha: 0.14, w: 0.0025 },
      ticks: [
        { every: 12, len: 0.046, w: 0.0048, alpha: 1 },
        { every: 60, len: 0.022, w: 0.0026, alpha: 0.7 },
        { every: 240, len: 0.009, w: 0.0012, alpha: 0.35 },
      ],
      numerals: { at: 0.875, font: 0.046, alpha: 0.95, blur: 0.3, weight: 600 },
    },
    { // E — ticks-only ring between the middle dial and the inner clock
      r: 0.27, ox: 0.012, oy: -0.012, rot0: 0.4, spin: 0.7, drift: 0.006, parallax: 13, alpha: 0.5, soft: 1,
      ring: { at: 1, alpha: 0.12, w: 0.0018 },
      ticks: [
        { every: 24, len: 0.018, w: 0.0032, alpha: 0.8 },
        { every: 144, len: 0.007, w: 0.0012, alpha: 0.45 },
      ],
    },
    { // C — inner clock, sharpest, clearly readable
      r: 0.165, ox: 0, oy: 0, rot0: 0.35, spin: -1.0, drift: -0.008, parallax: 7, alpha: 1, soft: 0.8,
      ring: { at: 0.99, alpha: 0.22, w: 0.002 },
      ticks: [
        { every: 12, len: 0.026, w: 0.0042, alpha: 1 },
        { every: 60, len: 0.012, w: 0.0018, alpha: 0.75 },
      ],
      numerals: { at: 0.84, font: 0.026, alpha: 1, blur: 0, weight: 600 },
    },
    { // D — tiny ring around the pivot
      r: 0.078, ox: 0, oy: 0, rot0: -0.6, spin: 1.6, drift: 0.012, parallax: 3, alpha: 0.95, soft: 0.6,
      ring: { at: 1, alpha: 0.25, w: 0.0016 },
      ticks: [
        { every: 12, len: 0.014, w: 0.0026, alpha: 0.9 },
        { every: 48, len: 0.006, w: 0.0012, alpha: 0.6 },
      ],
      numerals: { at: 0.72, font: 0.013, alpha: 0.85, blur: 0, weight: 500 },
    },
  ]

  return defs.map((d) => ({
    ...d,
    R: d.r * U,
    glyphs: d.numerals ? makeGlyphs(d.numerals.font * U, d.numerals, dpr) : null,
  }))
}

/** Twelve numeral sprites with glow baked in. */
function makeGlyphs(fontPx, { blur, weight }, dpr) {
  const out = []
  const pad = fontPx * 0.9
  for (let i = 1; i <= 12; i++) {
    const text = String(i)
    const wpx = fontPx * (i >= 10 ? 1.3 : 0.75) + pad * 2
    const hpx = fontPx * 1.2 + pad * 2
    const c = document.createElement('canvas')
    c.width = Math.ceil(wpx * dpr)
    c.height = Math.ceil(hpx * dpr)
    const g = c.getContext('2d')
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.font = `${weight} ${fontPx}px Inter, system-ui, sans-serif`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    if (blur) g.filter = `blur(${blur}px)`
    // Wide blue bloom, tighter cyan glow, crisp white core.
    g.shadowColor = `rgba(${BLUE}, 0.9)`
    g.shadowBlur = fontPx * 0.45
    g.fillStyle = `rgba(${CYAN}, 0.55)`
    g.fillText(text, wpx / 2, hpx / 2)
    g.shadowColor = `rgba(${CYAN}, 1)`
    g.shadowBlur = fontPx * 0.14
    g.fillStyle = `rgba(${CYAN}, 0.9)`
    g.fillText(text, wpx / 2, hpx / 2)
    g.shadowBlur = 0
    g.fillStyle = `rgba(${WHITE}, 0.95)`
    g.fillText(text, wpx / 2, hpx / 2)
    out.push({ c, w: wpx, h: hpx })
  }
  return out
}

function drawLayer(ctx, L, cx, cy, rot) {
  const { R, alpha, soft } = L
  ctx.save()
  ctx.translate(cx, cy)

  // Faint base ring.
  if (L.ring) {
    ctx.globalAlpha = alpha * L.ring.alpha
    ctx.strokeStyle = `rgba(${CYAN}, 1)`
    ctx.lineWidth = L.ring.w * U_OF(L)
    ctx.beginPath()
    ctx.arc(0, 0, R * L.ring.at, 0, Math.PI * 2)
    ctx.stroke()
  }

  // Ticks: one batched path per class, stroked twice (soft bloom, crisp core).
  ctx.rotate(rot)
  ctx.lineCap = 'round'
  for (const T of L.ticks) {
    const len = T.len * U_OF(L)
    const w = T.w * U_OF(L)
    ctx.beginPath()
    for (let i = 0; i < T.every; i++) {
      // Skip positions already covered by a coarser class.
      if (isCoveredByCoarser(L.ticks, T, i)) continue
      const a = (i / T.every) * Math.PI * 2
      const s = Math.sin(a)
      const c = -Math.cos(a)
      ctx.moveTo(s * (R - len), c * (R - len))
      ctx.lineTo(s * R, c * R)
    }
    ctx.globalAlpha = alpha * T.alpha * 0.28
    ctx.strokeStyle = `rgba(${BLUE}, 1)`
    ctx.lineWidth = w * (2.8 + soft)
    ctx.stroke()
    ctx.globalAlpha = alpha * T.alpha * 0.55
    ctx.strokeStyle = `rgba(${CYAN}, 1)`
    ctx.lineWidth = w * (1.6 + soft * 0.4)
    ctx.stroke()
    ctx.globalAlpha = alpha * T.alpha
    ctx.strokeStyle = `rgba(${WHITE}, 1)`
    ctx.lineWidth = w
    ctx.stroke()
  }
  ctx.rotate(-rot)

  // Numerals stay upright while riding the rotated ring.
  if (L.glyphs) {
    const nr = R * L.numerals.at
    ctx.globalAlpha = alpha * L.numerals.alpha
    for (let i = 1; i <= 12; i++) {
      const a = (i / 12) * Math.PI * 2 + rot
      const x = Math.sin(a) * nr
      const y = -Math.cos(a) * nr
      const g = L.glyphs[i - 1]
      ctx.drawImage(g.c, x - g.w / 2, y - g.h / 2, g.w, g.h)
    }
  }
  ctx.globalAlpha = 1
  ctx.restore()
}

// Layers store radii as fractions of U; recover U from R / r.
function U_OF(L) {
  return L.R / L.r
}

function isCoveredByCoarser(ticks, T, i) {
  for (const other of ticks) {
    if (other === T) break
    if ((i * other.every) % T.every === 0) return true
  }
  return false
}

/* --------------------------- atmosphere --------------------------- */

function buildBackground(w, h, cx, cy, U, dpr) {
  const c = document.createElement('canvas')
  c.width = Math.ceil(w * dpr)
  c.height = Math.ceil(h * dpr)
  const ctx = c.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = '#030816'
  ctx.fillRect(0, 0, w, h)

  // Localised light around the pivot; falls off to near-black.
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, U * 0.62)
  g.addColorStop(0, `rgba(${DEEP}, 0.34)`)
  g.addColorStop(0.3, `rgba(${DEEP}, 0.16)`)
  g.addColorStop(0.65, `rgba(${DEEP}, 0.05)`)
  g.addColorStop(1, 'rgba(3, 8, 22, 0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)

  // Secondary soft pool left of centre, as in the reference.
  const g2 = ctx.createRadialGradient(w * 0.34, h * 0.5, 0, w * 0.34, h * 0.5, U * 0.42)
  g2.addColorStop(0, `rgba(${BLUE}, 0.10)`)
  g2.addColorStop(1, `rgba(${BLUE}, 0)`)
  ctx.fillStyle = g2
  ctx.fillRect(0, 0, w, h)

  // Corner vignette.
  const v = ctx.createRadialGradient(cx, cy, U * 0.3, cx, cy, U * 0.95)
  v.addColorStop(0, 'rgba(3, 8, 22, 0)')
  v.addColorStop(1, 'rgba(2, 5, 14, 0.8)')
  ctx.fillStyle = v
  ctx.fillRect(0, 0, w, h)
  return c
}

function drawAtmosphere(ctx, cx, cy, U, t) {
  const pulse = 1 + Math.sin(t * 1.6) * 0.04
  const R = U * 0.26 * pulse
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R)
  g.addColorStop(0, `rgba(${BLUE}, 0.32)`)
  g.addColorStop(0.4, `rgba(${DEEP}, 0.14)`)
  g.addColorStop(1, `rgba(${DEEP}, 0)`)
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, Math.PI * 2)
  ctx.fill()
}

/* ------------------------------ dust ------------------------------ */

function makeDust(n) {
  const rand = mulberry32(19)
  const out = []
  for (let i = 0; i < n; i++) {
    const depth = rand()                        // 0 far … 1 near
    const r = 0.04 + Math.pow(rand(), 0.85) * 0.78
    const bright = rand()
    out.push({
      r,
      a0: rand() * Math.PI * 2,
      depth,
      near: depth > 0.72,
      size: depth > 0.72 ? 0.6 + rand() * 1.6 : 1.5 + rand() * 4,
      alpha: depth > 0.72 ? 0.25 + bright * 0.7 : 0.05 + bright * 0.2,
      streak: depth > 0.72 && rand() < 0.4,
      hot: bright > 0.93,
      wobble: rand() * Math.PI * 2,
    })
  }
  return out
}

function drawDust(ctx, dust, cx, cy, U, t, progress, px, py, softDot, sharpDot, pass) {
  const wantNear = pass === 'near'
  for (const p of dust) {
    if (p.near !== wantNear) continue
    const orbit = (t * 0.012 + progress * 0.35) / (p.r + 0.25)
    const a = p.a0 + orbit
    const rr = (p.r + Math.sin(t * 0.5 + p.wobble) * 0.004) * U
    const par = (p.near ? 10 : 24) * (1 - p.depth)
    const x = cx + px * par + Math.cos(a) * rr
    const y = cy + py * par * 0.8 + Math.sin(a) * rr

    ctx.globalAlpha = p.alpha
    if (p.streak) {
      ctx.strokeStyle = `rgba(${CYAN}, ${p.alpha * 0.5})`
      ctx.lineWidth = Math.max(0.5, p.size * 0.35)
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.arc(cx, cy, rr, a - 0.035 / (p.r + 0.3), a)
      ctx.stroke()
    }
    const s = p.size * (p.near ? 2.2 : 3.2)
    ctx.drawImage(softDot, x - s / 2, y - s / 2, s, s)
    if (p.hot || (p.near && p.alpha > 0.7)) {
      const k = p.size * 1.2
      ctx.drawImage(sharpDot, x - k / 2, y - k / 2, k, k)
    }
  }
  ctx.globalAlpha = 1
}

function makeArcs(n) {
  const rand = mulberry32(3)
  return Array.from({ length: n }, () => ({
    r: 0.09 + rand() * 0.62,
    a0: rand() * Math.PI * 2,
    span: 0.25 + rand() * 1.3,
    alpha: 0.04 + rand() * 0.1,
    w: 0.6 + rand() * 1.1,
    dir: rand() < 0.5 ? -1 : 1,
  }))
}

function drawArcs(ctx, arcs, cx, cy, U, t, progress) {
  ctx.lineCap = 'round'
  for (const a of arcs) {
    const rot = a.a0 + a.dir * (t * 0.01 + progress * 0.3) / (a.r + 0.3)
    ctx.strokeStyle = `rgba(${CYAN}, ${a.alpha})`
    ctx.lineWidth = a.w
    ctx.beginPath()
    ctx.arc(cx, cy, a.r * U, rot, rot + a.span)
    ctx.stroke()
  }
}

/* ------------------------------ hands ----------------------------- */

function computeTime(progress, startHour, startMinute, sweepMinutes, t, reduceMotion) {
  // Real minutes creep in at rest so the hands are never perfectly still.
  const minutes = startHour * 60 + startMinute + progress * sweepMinutes + t / 60
  const minuteAngle = ((minutes % 60) / 60) * Math.PI * 2
  const hourAngle = ((minutes % 720) / 720) * Math.PI * 2

  const d = new Date()
  const sec = d.getSeconds()
  const ms = d.getMilliseconds()
  let tick = 1
  if (!reduceMotion && ms < 220) tick = easeOutBack(ms / 220)
  const secondAngle = ((sec - 1 + tick) / 60) * Math.PI * 2
  return { hourAngle, minuteAngle, secondAngle }
}

function easeOutBack(t) {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

/**
 * Pre-renders each hand once: atmospheric bloom → cyan glow → cyan body →
 * overexposed white core, rounded ends. The frame loop only rotates and
 * blits them, so the expensive shadowBlur never runs per frame.
 */
function buildHands(U, dpr) {
  const make = (length, width, thin) => {
    const bloom = thin ? width * 6 : width * 6
    const pad = bloom * 1.5 + width * 2
    const w = Math.ceil((width * 3 + pad * 2))
    const h = Math.ceil(length * 1.1 + pad * 2)
    const c = document.createElement('canvas')
    c.width = Math.ceil(w * dpr)
    c.height = Math.ceil(h * dpr)
    const g = c.getContext('2d')
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    // Pivot sits at (w/2, h - pad - length*0.06); the hand points up.
    const pivotY = h - pad - length * 0.06
    g.translate(w / 2, pivotY)
    g.lineCap = 'round'
    const from = length * 0.06
    const to = -length
    if (thin) {
      g.shadowColor = `rgba(${CYAN}, 0.9)`
      g.shadowBlur = width * 4
      g.strokeStyle = `rgba(${CYAN}, 0.7)`
      g.lineWidth = width
      line(g, from * 3, to)
    } else {
      g.shadowColor = `rgba(${DEEP}, 1)`
      g.shadowBlur = bloom
      g.strokeStyle = `rgba(${BLUE}, 0.45)`
      g.lineWidth = width * 2.6
      line(g, from, to)
      g.shadowColor = `rgba(${CYAN}, 1)`
      g.shadowBlur = width * 2
      g.strokeStyle = `rgba(${CYAN}, 0.85)`
      g.lineWidth = width * 1.35
      line(g, from, to)
      g.shadowBlur = width * 0.6
      g.strokeStyle = `rgba(${WHITE}, 0.95)`
      g.lineWidth = width
      line(g, from, to)
      g.shadowBlur = 0
      g.strokeStyle = 'rgba(255, 255, 255, 1)'
      g.lineWidth = width * 0.42
      line(g, from * 0.5, to * 0.985)
    }
    return { c, w, h, pivotX: w / 2, pivotY }
  }

  // Core halo sprite.
  const R = U * 0.08
  const size = Math.ceil(R * 2 + U * 0.03)
  const core = document.createElement('canvas')
  core.width = Math.ceil(size * dpr)
  core.height = Math.ceil(size * dpr)
  const g = core.getContext('2d')
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, R)
  grad.addColorStop(0, 'rgba(255, 255, 255, 1)')
  grad.addColorStop(0.1, `rgba(${WHITE}, 0.95)`)
  grad.addColorStop(0.28, `rgba(${CYAN}, 0.6)`)
  grad.addColorStop(0.6, `rgba(${BLUE}, 0.18)`)
  grad.addColorStop(1, `rgba(${DEEP}, 0)`)
  g.fillStyle = grad
  g.fillRect(0, 0, size, size)
  g.shadowColor = 'rgba(255,255,255,1)'
  g.shadowBlur = U * 0.012
  g.fillStyle = '#ffffff'
  g.beginPath()
  g.arc(size / 2, size / 2, U * 0.0075, 0, Math.PI * 2)
  g.fill()

  return {
    hour: make(U * 0.135, U * 0.0115, false),
    minute: make(U * 0.225, U * 0.0100, false),
    second: make(U * 0.2, Math.max(1, U * 0.0018), true),
    core: { c: core, size },
  }
}

function blitHand(ctx, cx, cy, sprite, angle) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(angle)
  ctx.drawImage(sprite.c, -sprite.pivotX, -sprite.pivotY, sprite.w, sprite.h)
  ctx.restore()
}

function drawHands(ctx, cx, cy, hands, { hourAngle, minuteAngle, secondAngle }) {
  blitHand(ctx, cx, cy, hands.hour, hourAngle)
  blitHand(ctx, cx, cy, hands.minute, minuteAngle)
  blitHand(ctx, cx, cy, hands.second, secondAngle)
}

function drawCore(ctx, cx, cy, hands, t) {
  const pulse = 1 + Math.sin(t * 2.1) * 0.05
  const s = hands.core.size * pulse
  ctx.drawImage(hands.core.c, cx - s / 2, cy - s / 2, s, s)
}

function line(ctx, y0, y1) {
  ctx.beginPath()
  ctx.moveTo(0, y0)
  ctx.lineTo(0, y1)
  ctx.stroke()
}
