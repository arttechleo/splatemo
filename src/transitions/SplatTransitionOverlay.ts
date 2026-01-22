/**
 * Full-splat disintegration transition overlay.
 * Samples entire frame from WebGL canvas, generates particles with directional motion.
 * No preserveDrawingBuffer; fallback to fade if capture fails.
 */

export const DEBUG_TRANSITION_OVERLAY = true
export const DEBUG_SHOW_INFO = false

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

const TRANSITION_DURATION_MS = 1200
const TAIL_DURATION_MS = 250
const MIN_PARTICLES = 1500
const MAX_PARTICLES = 4000
const ALPHA_THRESHOLD = 15
const VY_BASE = 5.5
const VX_SPREAD = 1.8
const FALLOFF = 0.985
const VELOCITY_DAMP = 0.995
const JITTER_AMOUNT = 0.8
const JITTER_DECAY = 0.92

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
  private transitionToken = 0
  private isFinishing = false
  private finishStartTime = 0
  private debugInfo: {
    mode: 'pixelSnapshot' | 'fallback'
    particleCount: number
    dpr: number
    snapshotWidth: number
    snapshotHeight: number
  } | null = null

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

  startTransition(
    direction: 'up' | 'down',
    sourceCanvas: HTMLCanvasElement | null
  ): void {
    this.stop()
    if (!DEBUG_TRANSITION_OVERLAY) return

    this.transitionToken++
    const token = this.transitionToken
    this.direction = direction
    this.isActive = true
    this.isFinishing = false
    this.isFallback = false
    this.overlayOpacity = 1
    this.particles = []
    this.fallbackImage = null
    this.debugInfo = null

    if (!sourceCanvas || !this.ctx || !this.overlay) return

    requestAnimationFrame(() => {
      if (token !== this.transitionToken) return

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

    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const W = window.innerWidth
    const H = window.innerHeight

    const off = document.createElement('canvas')
    off.width = w
    off.height = h
    const offCtx = off.getContext('2d', { alpha: true, willReadFrequently: true })
    if (!offCtx) return

    try {
      offCtx.drawImage(source, 0, 0, w, h, 0, 0, w, h)
    } catch {
      this.initFallback(off, w, h)
      return
    }

    let data: ImageData
    try {
      data = offCtx.getImageData(0, 0, w, h)
    } catch {
      this.initFallback(off, w, h)
      return
    }

    const { data: d } = data
    const vySign = this.direction === 'up' ? -1 : 1

    const targetParticleCount = Math.max(
      MIN_PARTICLES,
      Math.min(MAX_PARTICLES, Math.floor((W * H) / 400))
    )

    const totalPixels = w * h
    const pixelsPerParticle = totalPixels / targetParticleCount
    const stride = Math.max(1, Math.floor(Math.sqrt(pixelsPerParticle)))

    let sampled = 0
    for (let py = 0; py < h; py += stride) {
      for (let px = 0; px < w; px += stride) {
        const i = (py * w + px) << 2
        const r = d[i]
        const g = d[i + 1]
        const b = d[i + 2]
        const a = d[i + 3]
        if (a < ALPHA_THRESHOLD) continue

        const x = (px / w) * W
        const y = (py / h) * H
        const brightness = (r + g + b) / (3 * 255)
        const size = 1.2 + Math.random() * 2.3 + (1 - brightness) * 1.2

        this.particles.push({
          x: x + (Math.random() - 0.5) * JITTER_AMOUNT,
          y: y + (Math.random() - 0.5) * JITTER_AMOUNT,
          vx: (Math.random() - 0.5) * VX_SPREAD * 2,
          vy: (Math.random() * 0.4 + 0.6) * VY_BASE * vySign,
          r,
          g,
          b,
          a: a / 255,
          size,
        })
        sampled++

        if (sampled >= MAX_PARTICLES) break
      }
      if (sampled >= MAX_PARTICLES) break
    }

    this.debugInfo = {
      mode: 'pixelSnapshot',
      particleCount: sampled,
      dpr,
      snapshotWidth: w,
      snapshotHeight: h,
    }

    if (sampled < 50) {
      this.particles = []
      this.initFallback(off, w, h)
    }
  }

  private initFallback(fullCanvas: HTMLCanvasElement, w: number, h: number): void {
    this.isFallback = true
    const W = window.innerWidth
    const H = window.innerHeight
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const f = document.createElement('canvas')
    f.width = W
    f.height = H
    const fc = f.getContext('2d', { alpha: true })
    if (!fc) return
    fc.drawImage(fullCanvas, 0, 0, w, h, 0, 0, W, H)
    this.fallbackImage = f

    this.debugInfo = {
      mode: 'fallback',
      particleCount: 0,
      dpr,
      snapshotWidth: w,
      snapshotHeight: h,
    }
  }

  private easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
  }

  private animate = (): void => {
    if (!this.isActive || !this.ctx || !this.overlay) return

    const W = window.innerWidth
    const H = window.innerHeight
    this.ctx.clearRect(0, 0, W, H)

    const elapsed = performance.now() - this.startTime
    let t = Math.min(1, elapsed / TRANSITION_DURATION_MS)

    if (this.isFinishing) {
      const finishElapsed = performance.now() - this.finishStartTime
      const finishT = Math.min(1, finishElapsed / TAIL_DURATION_MS)
      t = 1 - finishT * 0.3
    }

    const eased = this.easeInOutCubic(t)
    const fade = 1 - eased

    if (DEBUG_SHOW_INFO && this.debugInfo) {
      this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
      this.ctx.fillRect(10, 10, 300, 100)
      this.ctx.fillStyle = '#fff'
      this.ctx.font = '12px monospace'
      this.ctx.fillText(`mode: ${this.debugInfo.mode}`, 15, 30)
      this.ctx.fillText(`particles: ${this.debugInfo.particleCount}`, 15, 50)
      this.ctx.fillText(`DPR: ${this.debugInfo.dpr}`, 15, 70)
      this.ctx.fillText(
        `snapshot: ${this.debugInfo.snapshotWidth}x${this.debugInfo.snapshotHeight}`,
        15,
        90
      )
    }

    if (this.isFallback && this.fallbackImage) {
      this.ctx.globalAlpha = this.overlayOpacity * fade
      this.ctx.drawImage(this.fallbackImage, 0, 0, W, H, 0, 0, W, H)
      this.ctx.globalAlpha = 1
    } else {
      const jitterDecay = Math.pow(JITTER_DECAY, elapsed / 16.67)
      for (const p of this.particles) {
        p.x += p.vx * (1 + jitterDecay * 0.3)
        p.y += p.vy * (1 + jitterDecay * 0.2)
        p.a *= FALLOFF
        p.vx *= VELOCITY_DAMP
        p.vy *= VELOCITY_DAMP
        if (p.a < 0.02) continue

        this.ctx.fillStyle = `rgba(${p.r},${p.g},${p.b},${p.a * this.overlayOpacity * fade})`
        this.ctx.beginPath()
        this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        this.ctx.fill()
      }
    }

    if (t >= 1 && !this.isFinishing) {
      this.stop()
      return
    }

    this.rafId = requestAnimationFrame(this.animate)
  }

  endTransition(): void {
    if (!this.overlay || this.isFinishing) return
    this.isFinishing = true
    this.finishStartTime = performance.now()

    const checkFinish = () => {
      const elapsed = performance.now() - this.finishStartTime
      if (elapsed >= TAIL_DURATION_MS) {
        this.stop()
      } else if (this.isActive) {
        requestAnimationFrame(checkFinish)
      }
    }
    requestAnimationFrame(checkFinish)
  }

  stop(): void {
    this.isActive = false
    this.isFinishing = false
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
    this.debugInfo = null
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
