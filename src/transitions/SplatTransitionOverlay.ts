/**
 * Transition overlay derived from the current splat canvas.
 * Samples a top/bottom band, creates particles from pixels, animates in swipe direction.
 * No preserveDrawingBuffer; fallback to fade if capture fails.
 */

export const DEBUG_TRANSITION_OVERLAY = true

type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  g: number
  b: number
  a: number
  size: number
}

const BAND_FRAC = 0.3
const SAMPLE_STRIDE = 8
const ALPHA_THRESHOLD = 15
const VY_BASE = 4
const VX_SPREAD = 1.2
const DURATION_MS = 1200
const FALLOFF = 0.97

export class SplatTransitionOverlay {
  private overlay: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private particles: Particle[] = []
  private fallbackImage: HTMLCanvasElement | null = null
  private rafId: number | null = null
  private startTime = 0
  private isActive = false
  private isFallback = false
  private direction: 'up' | 'down' = 'up'
  private overlayOpacity = 1
  private endTimeout: ReturnType<typeof setTimeout> | null = null

  constructor(container: HTMLElement) {
    this.overlay = document.createElement('canvas')
    this.overlay.style.position = 'fixed'
    this.overlay.style.inset = '0'
    this.overlay.style.width = '100%'
    this.overlay.style.height = '100%'
    this.overlay.style.pointerEvents = 'none'
    this.overlay.style.zIndex = '5'
    this.overlay.style.opacity = '0'
    container.appendChild(this.overlay)
    this.ctx = this.overlay.getContext('2d', { alpha: true })
    this.resize()
    window.addEventListener('resize', () => this.resize())
  }

  private resize() {
    if (!this.overlay) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    this.overlay.width = window.innerWidth * dpr
    this.overlay.height = window.innerHeight * dpr
    if (this.ctx) {
      this.ctx.setTransform(1, 0, 0, 1, 0, 0)
      this.ctx.scale(dpr, dpr)
    }
  }

  startTransition(direction: 'up' | 'down', sourceCanvas: HTMLCanvasElement | null): void {
    this.stop()
    if (!DEBUG_TRANSITION_OVERLAY) return

    this.direction = direction
    this.isActive = true
    this.isFallback = false
    this.overlayOpacity = 1
    this.particles = []
    this.fallbackImage = null

    if (!sourceCanvas || !this.ctx || !this.overlay) return

    requestAnimationFrame(() => {
      this.captureAndSample(sourceCanvas)
      if (this.particles.length === 0 && !this.fallbackImage) return
      if (this.overlay) this.overlay.style.opacity = '1'
      this.startTime = performance.now()
      this.animate()
    })
  }

  private captureAndSample(source: HTMLCanvasElement): void {
    const w = source.width
    const h = source.height
    if (w < 4 || h < 4) return

    const bandH = Math.max(4, Math.floor(h * BAND_FRAC))
    const sy = this.direction === 'up' ? 0 : h - bandH

    const off = document.createElement('canvas')
    off.width = w
    off.height = bandH
    const offCtx = off.getContext('2d', { alpha: true, willReadFrequently: true })
    if (!offCtx) return

    try {
      offCtx.drawImage(source, 0, sy, w, bandH, 0, 0, w, bandH)
    } catch {
      return
    }

    let data: ImageData
    try {
      data = offCtx.getImageData(0, 0, w, bandH)
    } catch {
      this.initFallback(off, bandH)
      return
    }

    const { data: d } = data
    const W = window.innerWidth
    const H = window.innerHeight
    const bandHScreen = H * BAND_FRAC
    const baseY = this.direction === 'up' ? 0 : H - bandHScreen
    const vySign = this.direction === 'up' ? -1 : 1

    let sampled = 0
    for (let py = 0; py < bandH; py += SAMPLE_STRIDE) {
      for (let px = 0; px < w; px += SAMPLE_STRIDE) {
        const i = (py * w + px) << 2
        const r = d[i]
        const g = d[i + 1]
        const b = d[i + 2]
        const a = d[i + 3]
        if (a < ALPHA_THRESHOLD) continue

        const x = (px / w) * W
        const y = baseY + (py / bandH) * bandHScreen
        this.particles.push({
          x,
          y,
          vx: (Math.random() - 0.5) * VX_SPREAD * 2,
          vy: (Math.random() * 0.5 + 0.5) * VY_BASE * vySign,
          r,
          g,
          b,
          a: a / 255,
          size: 1.5 + Math.random() * 1.5,
        })
        sampled++
      }
    }

    if (sampled < 20) {
      this.particles = []
      this.initFallback(off, bandH)
    }
  }

  private initFallback(bandCanvas: HTMLCanvasElement, bandH: number): void {
    this.isFallback = true
    const W = window.innerWidth
    const H = window.innerHeight
    const bandHScreen = H * BAND_FRAC
    const f = document.createElement('canvas')
    f.width = W
    f.height = bandHScreen
    const fc = f.getContext('2d', { alpha: true })
    if (!fc) return
    fc.drawImage(bandCanvas, 0, 0, bandCanvas.width, bandH, 0, 0, W, bandHScreen)
    this.fallbackImage = f
  }

  private animate = (): void => {
    if (!this.isActive || !this.ctx || !this.overlay) return

    const W = window.innerWidth
    const H = window.innerHeight
    this.ctx.clearRect(0, 0, W, H)

    const elapsed = performance.now() - this.startTime
    const t = Math.min(1, elapsed / DURATION_MS)
    const fade = 1 - t

    if (this.isFallback && this.fallbackImage) {
      const bandH = this.fallbackImage.height
      const y = this.direction === 'up' ? 0 : H - bandH
      this.ctx.globalAlpha = this.overlayOpacity * fade
      this.ctx.drawImage(this.fallbackImage, 0, 0, W, bandH, 0, y, W, bandH)
      this.ctx.globalAlpha = 1
    } else {
      for (const p of this.particles) {
        p.x += p.vx
        p.y += p.vy
        p.a *= FALLOFF
        p.vx *= 0.99
        p.vy *= 0.99
        if (p.a < 0.02) continue

        this.ctx.fillStyle = `rgba(${p.r},${p.g},${p.b},${p.a * this.overlayOpacity * fade})`
        this.ctx.beginPath()
        this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        this.ctx.fill()
      }
    }

    this.rafId = requestAnimationFrame(this.animate)
  }

  endTransition(): void {
    if (!this.overlay) return
    this.isActive = false
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    this.overlay.style.transition = 'opacity 0.25s ease'
    this.overlay.style.opacity = '0'
    if (this.endTimeout) clearTimeout(this.endTimeout)
    this.endTimeout = setTimeout(() => {
      this.endTimeout = null
      this.stop()
      if (this.overlay) this.overlay.style.transition = ''
    }, 280)
  }

  stop(): void {
    this.isActive = false
    if (this.endTimeout) {
      clearTimeout(this.endTimeout)
      this.endTimeout = null
    }
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    this.particles = []
    this.fallbackImage = null
    if (this.overlay) {
      this.overlay.style.opacity = '0'
      this.overlay.style.transition = ''
    }
  }

  destroy(): void {
    this.stop()
    if (this.overlay?.parentElement) {
      this.overlay.parentElement.removeChild(this.overlay)
    }
    this.overlay = null
    this.ctx = null
  }
}
