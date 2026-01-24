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
  glow?: number // Optional glow alpha for hero particles
}

const TRANSITION_DURATION_MS = 1200
const TAIL_DURATION_MS = 250
const MIN_PARTICLES = 1500
const MAX_PARTICLES = 4000
const ALPHA_THRESHOLD = 15
const VY_BASE = 6.5 // Increased from 5.5 for more visible motion
const VX_SPREAD = 2.2 // Increased from 1.8 for wider spread
const FALLOFF = 0.982 // Slower falloff (was 0.985) for longer tail
const VELOCITY_DAMP = 0.992 // Less damping (was 0.995) for longer motion
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
    const overlayDpr = Math.min(2, window.devicePixelRatio || 1)
    this.overlay.width = window.innerWidth * overlayDpr
    this.overlay.height = window.innerHeight * overlayDpr
    if (this.ctx) {
      this.ctx.setTransform(1, 0, 0, 1, 0, 0)
      this.ctx.scale(overlayDpr, overlayDpr)
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

  /**
   * Start an audio pulse: samples particles from a specific band and animates them.
   * Multiple pulses can coexist (additive particles).
   */
  startAudioPulse(params: {
    bandCenterY: number
    bandHeight: number
    direction: 'up' | 'down'
    intensity: number
    durationMs: number
    sourceCanvas: HTMLCanvasElement | null
    intensityMultiplier?: number // Global intensity boost (default 1.0)
  }): void {
    if (!DEBUG_TRANSITION_OVERLAY || !params.sourceCanvas || !this.ctx || !this.overlay) return

    // Ensure overlay is visible
    if (this.overlay) {
      this.overlay.style.opacity = '1'
    }

    // Apply intensity multiplier for visibility boost
    const intensityMultiplier = params.intensityMultiplier || 1.0
    const effectiveIntensity = Math.min(1.0, params.intensity * intensityMultiplier)
    
    // Sample particles from the specified band
    const pulseParticles = this.captureBandSample(
      params.sourceCanvas,
      params.bandCenterY,
      params.bandHeight,
      params.direction,
      effectiveIntensity,
      intensityMultiplier
    )

    if (pulseParticles.length === 0) return

    // Add particles to the active set (additive)
    if (!this.isActive) {
      this.isActive = true
      this.startTime = performance.now()
      this.particles = []
      this.animate()
    }

    // Tag particles with their pulse lifetime
    const pulseStartTime = performance.now()
    const pulseDuration = params.durationMs
    for (const p of pulseParticles) {
      ;(p as Particle & { pulseStartTime: number; pulseDuration: number }).pulseStartTime = pulseStartTime
      ;(p as Particle & { pulseStartTime: number; pulseDuration: number }).pulseDuration = pulseDuration
      this.particles.push(p)
    }
  }

  /**
   * Sample particles from a specific band region of the canvas.
   * Used for audio pulses that target a moving band.
   */
  private captureBandSample(
    source: HTMLCanvasElement,
    bandCenterY: number,
    bandHeight: number,
    direction: 'up' | 'down',
    intensity: number,
    intensityMultiplier: number = 1.0
  ): Particle[] {
    const w = source.width
    const h = source.height
    if (w < 4 || h < 4) return []

    const W = window.innerWidth
    const H = window.innerHeight

    // Convert screen-space Y to canvas-space Y
    const canvasBandCenterY = (bandCenterY / H) * h
    const canvasBandHeight = (bandHeight / H) * h
    const bandTop = Math.max(0, canvasBandCenterY - canvasBandHeight / 2)
    const bandBottom = Math.min(h, canvasBandCenterY + canvasBandHeight / 2)

    const off = document.createElement('canvas')
    off.width = w
    off.height = h
    const offCtx = off.getContext('2d', { alpha: true, willReadFrequently: true })
    if (!offCtx) return []

    try {
      offCtx.drawImage(source, 0, 0, w, h, 0, 0, w, h)
    } catch {
      return []
    }

    let data: ImageData
    try {
      data = offCtx.getImageData(0, 0, w, h)
    } catch {
      return []
    }

    const { data: d } = data
    const vySign = direction === 'up' ? -1 : 1

    // Scale particle count by intensity and multiplier (3× more particles for visibility)
    const baseParticleCount = Math.floor((W * bandHeight) / 200)
    const particleCountMultiplier = 1.0 + (intensityMultiplier - 1.0) * 2.5 // Scale up particle count
    const targetParticleCount = Math.max(
      Math.floor(baseParticleCount * 0.3),
      Math.min(
        Math.floor(baseParticleCount * intensity * particleCountMultiplier),
        MAX_PARTICLES / 2 // Allow more particles per band
      )
    )

    const bandPixels = w * canvasBandHeight
    const pixelsPerParticle = bandPixels / targetParticleCount
    const stride = Math.max(1, Math.floor(Math.sqrt(pixelsPerParticle)))

    const particles: Particle[] = []
    let sampled = 0

    for (let py = Math.floor(bandTop); py < Math.ceil(bandBottom); py += stride) {
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
        
        // Increase particle size range (allow larger "hero" particles)
        const baseSize = 1.5 + Math.random() * 2.5 + (1 - brightness) * 1.2
        const heroChance = intensityMultiplier > 2.0 ? 0.15 : 0.05 // More hero particles at high intensity
        const isHero = Math.random() < heroChance
        const size = isHero 
          ? baseSize * (2.5 + Math.random() * 2.0) // Hero particles: 2.5-4.5× larger
          : baseSize * (1.0 + (intensityMultiplier - 1.0) * 0.6) // Regular particles: slightly larger

        // Scale velocity by intensity (slightly faster for visibility)
        const velocityScale = (0.6 + intensity * 0.7) * (1.0 + (intensityMultiplier - 1.0) * 0.3)

        // Increase alpha for visibility (with glow effect for hero particles)
        const baseAlpha = a / 255
        const alphaBoost = 0.3 + (intensityMultiplier - 1.0) * 0.4 // Boost alpha by up to 70%
        const particleAlpha = Math.min(1.0, baseAlpha * (1.0 + alphaBoost))
        const glowAlpha = isHero ? particleAlpha * 1.4 : particleAlpha // Hero particles get extra glow

        particles.push({
          x: x + (Math.random() - 0.5) * JITTER_AMOUNT,
          y: y + (Math.random() - 0.5) * JITTER_AMOUNT,
          vx: (Math.random() - 0.5) * VX_SPREAD * 2.2, // Slightly wider spread
          vy: (Math.random() * 0.4 + 0.6) * VY_BASE * vySign * velocityScale,
          r,
          g,
          b,
          a: particleAlpha,
          size,
          glow: isHero ? glowAlpha : 0, // Store glow for rendering
        } as Particle & { glow?: number })
        sampled++

        if (sampled >= targetParticleCount) break
      }
      if (sampled >= targetParticleCount) break
    }

    return particles
  }

  private captureAndSample(source: HTMLCanvasElement): void {
    const w = source.width
    const h = source.height
    if (w < 4 || h < 4) return

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

    // Adaptive particle count based on device capabilities
    const deviceDpr = Math.min(2, window.devicePixelRatio || 1)
    const isMobileDevice = /Mobi|Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
    const adaptiveMax = isMobileDevice 
      ? Math.min(MAX_PARTICLES, Math.floor((W * H) / 350)) // More particles on mobile
      : Math.min(MAX_PARTICLES * 1.2, Math.floor((W * H) / 300)) // Even more on desktop
    
    const targetParticleCount = Math.max(
      MIN_PARTICLES,
      adaptiveMax
    )

    const totalPixels = w * h
    const pixelsPerParticle = totalPixels / targetParticleCount
    // Reduce stride for denser sampling (more particles)
    const stride = Math.max(1, Math.floor(Math.sqrt(pixelsPerParticle) * 0.85))

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
        
        // Increased size range with hero particles
        const heroChance = 0.08 // 8% chance for hero particles
        const isHero = Math.random() < heroChance
        const baseSize = 1.5 + Math.random() * 2.8 + (1 - brightness) * 1.5
        const size = isHero ? baseSize * (2.5 + Math.random() * 2.0) : baseSize
        
        // Increased alpha for visibility
        const baseAlpha = a / 255
        const alphaBoost = 0.4 // 40% alpha boost
        const particleAlpha = Math.min(1.0, baseAlpha * (1.0 + alphaBoost))
        const glowAlpha = isHero ? particleAlpha * 1.5 : 0

        this.particles.push({
          x: x + (Math.random() - 0.5) * JITTER_AMOUNT,
          y: y + (Math.random() - 0.5) * JITTER_AMOUNT,
          vx: (Math.random() - 0.5) * VX_SPREAD * 2.2,
          vy: (Math.random() * 0.4 + 0.6) * VY_BASE * vySign,
          r,
          g,
          b,
          a: particleAlpha,
          size,
          glow: glowAlpha,
        } as Particle)
        
        void brightness // Used in size calculation
        sampled++

        if (sampled >= MAX_PARTICLES) break
      }
      if (sampled >= MAX_PARTICLES) break
    }

    this.debugInfo = {
      mode: 'pixelSnapshot',
      particleCount: sampled,
      dpr: deviceDpr,
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
    const fallbackDpr = Math.min(2, window.devicePixelRatio || 1)
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
      dpr: fallbackDpr,
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
      if (!this.ctx) return
      
      const jitterDecay = Math.pow(JITTER_DECAY, elapsed / 16.67)
      const now = performance.now()
      
      // Filter and update particles (handle pulse lifetimes)
      const activeParticles: Particle[] = []
      
      for (const p of this.particles) {
        const pulseP = p as Particle & { pulseStartTime?: number; pulseDuration?: number }
        
        // If particle has pulse lifetime, check if it's expired
        if (pulseP.pulseStartTime != null && pulseP.pulseDuration != null) {
          const pulseAge = now - pulseP.pulseStartTime
          if (pulseAge >= pulseP.pulseDuration) {
            continue // Skip expired pulse particles
          }
        }

        p.x += p.vx * (1 + jitterDecay * 0.3)
        p.y += p.vy * (1 + jitterDecay * 0.2)
        p.a *= FALLOFF
        p.vx *= VELOCITY_DAMP
        p.vy *= VELOCITY_DAMP
        if (p.a < 0.02) continue

        const finalAlpha = p.a * this.overlayOpacity * fade
        const particle = p as Particle & { glow?: number }
        
        // Draw glow for hero particles (additive-like effect)
        if (particle.glow && particle.glow > 0) {
          const glowAlpha = particle.glow * this.overlayOpacity * fade * 0.4
          const glowSize = p.size * 2.5
          
          // Outer glow (softer)
          const glowGradient = this.ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowSize)
          glowGradient.addColorStop(0, `rgba(${p.r},${p.g},${p.b},${glowAlpha * 0.6})`)
          glowGradient.addColorStop(0.5, `rgba(${p.r},${p.g},${p.b},${glowAlpha * 0.3})`)
          glowGradient.addColorStop(1, `rgba(${p.r},${p.g},${p.b},0)`)
          
          this.ctx.fillStyle = glowGradient
          this.ctx.beginPath()
          this.ctx.arc(p.x, p.y, glowSize, 0, Math.PI * 2)
          this.ctx.fill()
        }
        
        // Draw main particle (brighter for visibility)
        this.ctx.fillStyle = `rgba(${p.r},${p.g},${p.b},${finalAlpha})`
        this.ctx.beginPath()
        this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        this.ctx.fill()
        
        // Add subtle highlight for all particles (increases visibility)
        if (finalAlpha > 0.1) {
          this.ctx.fillStyle = `rgba(255,255,255,${finalAlpha * 0.15})`
          this.ctx.beginPath()
          this.ctx.arc(p.x - p.size * 0.3, p.y - p.size * 0.3, p.size * 0.4, 0, Math.PI * 2)
          this.ctx.fill()
        }
        
        activeParticles.push(p)
      }

      this.particles = activeParticles

      // If no particles remain and not finishing, stop
      if (this.particles.length === 0 && !this.isFinishing && t >= 1) {
        this.stop()
        return
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
