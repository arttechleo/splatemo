/**
 * Transition overlay derived from the current splat.
 * Prefers real point data (projected to screen space), falls back to pixel sampling.
 * No preserveDrawingBuffer; fallback to fade if capture fails.
 */

import * as THREE from 'three'

export const DEBUG_TRANSITION_OVERLAY = true
export const DEBUG_SHOW_BAND_REGION = false

type SplatMeshLike = {
  getSplatCount: () => number
  getSplatCenter: (index: number, out: THREE.Vector3) => void
}

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
const BAND_RATIO = 0.33
const SAMPLE_STRIDE = 8
const ALPHA_THRESHOLD = 15
const VY_BASE = 5.5
const VX_SPREAD = 1.8
const FALLOFF = 0.985
const VELOCITY_DAMP = 0.995
const JITTER_AMOUNT = 0.8
const JITTER_DECAY = 0.92
const TAIL_DURATION_MS = 250

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
    sourceCanvas: HTMLCanvasElement | null,
    splatMesh: SplatMeshLike | null = null,
    camera: THREE.PerspectiveCamera | null = null
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

    if (!sourceCanvas || !this.ctx || !this.overlay) return

    requestAnimationFrame(() => {
      if (token !== this.transitionToken) return

      const usedRealData = this.tryRealPointData(splatMesh, camera, direction)
      if (!usedRealData) {
        this.captureAndSample(sourceCanvas)
      }

      if (this.particles.length === 0 && !this.fallbackImage) return
      if (this.overlay) this.overlay.style.opacity = '1'
      this.startTime = performance.now()
      this.animate()
    })
  }

  private tryRealPointData(
    splatMesh: SplatMeshLike | null,
    camera: THREE.PerspectiveCamera | null,
    direction: 'up' | 'down'
  ): boolean {
    if (!splatMesh || !camera) return false

    const total = splatMesh.getSplatCount()
    if (total === 0) return false

    const W = window.innerWidth
    const H = window.innerHeight
    const bandTop = 0
    const bandBottom = H * BAND_RATIO
    const bandTopBottom = H * (1 - BAND_RATIO)
    const bandBottomBottom = H

    const targetCount = Math.min(Math.floor(W / 3), 2000)
    const stride = Math.max(1, Math.floor(total / targetCount))
    const temp = new THREE.Vector3()
    const screenPos = new THREE.Vector3()

    const vySign = direction === 'up' ? -1 : 1
    const bandMin = direction === 'up' ? bandTop : bandTopBottom
    const bandMax = direction === 'up' ? bandBottom : bandBottomBottom

    let sampled = 0
    for (let i = 0; i < total; i += stride) {
      splatMesh.getSplatCenter(i, temp)
      screenPos.copy(temp)
      screenPos.project(camera)

      const screenY = (-screenPos.y * 0.5 + 0.5) * H
      if (screenY < bandMin || screenY >= bandMax) continue

      const screenX = (screenPos.x * 0.5 + 0.5) * W
      if (screenX < 0 || screenX >= W) continue

      const depth = screenPos.z
      if (depth > 1 || depth < -1) continue

      const brightness = Math.max(0.3, 1 - Math.abs(depth))
      const size = 1.2 + Math.random() * 2.5 + (1 - brightness) * 1.5

      this.particles.push({
        x: screenX + (Math.random() - 0.5) * JITTER_AMOUNT,
        y: screenY + (Math.random() - 0.5) * JITTER_AMOUNT,
        vx: (Math.random() - 0.5) * VX_SPREAD * 2,
        vy: (Math.random() * 0.4 + 0.6) * VY_BASE * vySign,
        r: Math.floor(200 + Math.random() * 55),
        g: Math.floor(200 + Math.random() * 55),
        b: Math.floor(200 + Math.random() * 55),
        a: 0.7 + Math.random() * 0.3,
        size,
      })
      sampled++
    }

    return sampled > 50
  }

  private captureAndSample(source: HTMLCanvasElement): void {
    const w = source.width
    const h = source.height
    if (w < 4 || h < 4) return

    const bandH = Math.max(4, Math.floor(h * BAND_RATIO))
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
    const bandHScreen = H * BAND_RATIO
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
    const bandHScreen = H * BAND_RATIO
    const f = document.createElement('canvas')
    f.width = W
    f.height = bandHScreen
    const fc = f.getContext('2d', { alpha: true })
    if (!fc) return
    fc.drawImage(bandCanvas, 0, 0, bandCanvas.width, bandH, 0, 0, W, bandHScreen)
    this.fallbackImage = f
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

    if (DEBUG_SHOW_BAND_REGION) {
      const bandH = H * BAND_RATIO
      const y = this.direction === 'up' ? 0 : H - bandH
      this.ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)'
      this.ctx.lineWidth = 2
      this.ctx.strokeRect(0, y, W, bandH)
    }

    if (this.isFallback && this.fallbackImage) {
      const bandH = this.fallbackImage.height
      const y = this.direction === 'up' ? 0 : H - bandH
      this.ctx.globalAlpha = this.overlayOpacity * fade
      this.ctx.drawImage(this.fallbackImage, 0, 0, W, bandH, 0, y, W, bandH)
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
