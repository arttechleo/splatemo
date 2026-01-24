/**
 * Depth Drift Effect
 * Creates volumetric depth motion illusion by animating random depth slices.
 * Overlay-only, no modification to splat rendering internals.
 */

import * as THREE from 'three'

export interface DepthDriftConfig {
  enabled: boolean
  intensity: number // 0-1
  bandCount: number // Number of depth bands (3-6)
  bandLifetime: number // ms (how long bands persist before reshuffle)
  nearDisplacement: number // pixels (near bands move more)
  farDisplacement: number // pixels (far bands move less)
  nearSpeed: number // speed multiplier for near bands
  farSpeed: number // speed multiplier for far bands
  wispSize: number // pixels (soft wisps, not dots)
  wispAlpha: number // 0-1
  tapExciteDuration: number // ms (500-800ms)
  tapExciteIntensity: number // multiplier for tap excitement
}

const DEFAULT_CONFIG: DepthDriftConfig = {
  enabled: false, // OFF by default
  intensity: 0.4,
  bandCount: 4,
  bandLifetime: 4000, // 4 seconds
  nearDisplacement: 8,
  farDisplacement: 2,
  nearSpeed: 1.2,
  farSpeed: 0.6,
  wispSize: 12,
  wispAlpha: 0.15,
  tapExciteDuration: 650,
  tapExciteIntensity: 2.5,
}

interface DepthBand {
  id: number
  depthMin: number // 0-1 (camera space)
  depthMax: number // 0-1
  phase: number // Animation phase
  speed: number // Animation speed
  displacement: number // Max displacement
  age: number // ms since creation
  excited: boolean // Tap excitement state
  exciteStartTime: number
}

interface Wisp {
  x: number
  y: number
  depth: number // 0-1 (camera space)
  r: number
  g: number
  b: number
  baseX: number // Original position
  baseY: number
  phase: number // Individual animation phase
  size: number
  alpha: number
}

export class DepthDrift {
  private overlay: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private sourceCanvas: HTMLCanvasElement | null = null
  private camera: THREE.PerspectiveCamera | null = null
  private controls: { target?: THREE.Vector3 } | null = null
  private config: DepthDriftConfig = { ...DEFAULT_CONFIG }
  private isActive = false
  private rafId: number | null = null
  private isPaused = false
  
  // Depth bands
  private bands: DepthBand[] = []
  private nextBandId = 0
  private lastReshuffleTime = 0
  
  // Sampled wisps
  private wisps: Wisp[] = []
  private readonly MAX_WISPS = 800 // Mobile-safe cap
  private lastSampleTime = 0
  private readonly SAMPLE_INTERVAL = 2000 // Resample every 2 seconds
  
  constructor(container: HTMLElement) {
    this.createOverlay(container)
  }
  
  private createOverlay(container: HTMLElement): void {
    this.overlay = document.createElement('canvas')
    this.overlay.className = 'depth-drift-overlay'
    this.overlay.style.position = 'fixed'
    this.overlay.style.top = '0'
    this.overlay.style.left = '0'
    this.overlay.style.width = '100%'
    this.overlay.style.height = '100%'
    this.overlay.style.pointerEvents = 'none'
    this.overlay.style.zIndex = '9' // Above filmic overlays, below UI
    this.overlay.style.opacity = '1'
    
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    this.overlay.width = window.innerWidth * dpr
    this.overlay.height = window.innerHeight * dpr
    
    this.ctx = this.overlay.getContext('2d', { alpha: true })
    if (this.ctx) {
      this.ctx.scale(dpr, dpr)
    }
    
    container.appendChild(this.overlay)
    window.addEventListener('resize', () => this.resize())
  }
  
  private resize(): void {
    if (!this.overlay || !this.ctx) return
    
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    this.overlay.width = window.innerWidth * dpr
    this.overlay.height = window.innerHeight * dpr
    this.ctx.setTransform(1, 0, 0, 1, 0, 0)
    this.ctx.scale(dpr, dpr)
  }
  
  setSourceCanvas(canvas: HTMLCanvasElement | null): void {
    this.sourceCanvas = canvas
  }
  
  setCamera(camera: THREE.PerspectiveCamera | null, controls: { target?: THREE.Vector3 } | null): void {
    this.camera = camera
    this.controls = controls
  }
  
  setConfig(config: Partial<DepthDriftConfig>): void {
    this.config = { ...this.config, ...config }
    if (!this.config.enabled && this.isActive) {
      this.stop()
    } else if (this.config.enabled && !this.isActive && !this.isPaused) {
      this.start()
    }
  }
  
  /**
   * Start depth drift effect.
   */
  start(): void {
    if (this.isActive || !this.config.enabled) return
    
    this.isActive = true
    this.lastReshuffleTime = performance.now()
    this.createBands()
    this.sampleWisps()
    this.animate()
  }
  
  /**
   * Stop depth drift effect.
   */
  stop(): void {
    this.isActive = false
    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    this.bands = []
    this.wisps = []
    if (this.ctx && this.overlay) {
      this.ctx.clearRect(0, 0, this.overlay.width, this.overlay.height)
    }
  }
  
  /**
   * Pause during transitions.
   */
  pause(): void {
    this.isPaused = true
  }
  
  /**
   * Resume after transitions.
   */
  resume(): void {
    this.isPaused = false
    if (this.config.enabled && !this.isActive) {
      this.start()
    }
  }
  
  /**
   * Excite nearest depth band on tap.
   */
  exciteNearestBand(): void {
    if (!this.isActive || this.bands.length === 0) return
    
    // Find nearest band (lowest depth value = nearest)
    let nearestBand: DepthBand | null = null
    let minDepth = Infinity
    
    for (const band of this.bands) {
      const centerDepth = (band.depthMin + band.depthMax) / 2
      if (centerDepth < minDepth) {
        minDepth = centerDepth
        nearestBand = band
      }
    }
    
    if (nearestBand) {
      nearestBand.excited = true
      nearestBand.exciteStartTime = performance.now()
    }
  }
  
  /**
   * Create random depth bands.
   * Bands persist for a few seconds, then reshuffle for organic feel.
   */
  private createBands(): void {
    this.bands = []
    
    // Create bands that span the depth range
    const depthStep = 1.0 / this.config.bandCount
    const bandOverlap = 0.1 // Slight overlap for smooth transitions
    
    for (let i = 0; i < this.config.bandCount; i++) {
      // Distribute bands across depth range
      const baseDepth = (i + 0.5) / this.config.bandCount
      const depthMin = Math.max(0, baseDepth - depthStep / 2 - bandOverlap / 2)
      const depthMax = Math.min(1, baseDepth + depthStep / 2 + bandOverlap / 2)
      
      // Add slight randomization for organic feel
      const randomOffset = (Math.random() - 0.5) * 0.15
      const adjustedMin = Math.max(0, Math.min(1, depthMin + randomOffset))
      const adjustedMax = Math.max(adjustedMin, Math.min(1, depthMax + randomOffset))
      
      // Near bands: more displacement, faster
      // Far bands: less displacement, slower
      const depthCenter = (adjustedMin + adjustedMax) / 2
      const nearness = 1 - depthCenter // 1 = near, 0 = far
      
      const displacement = this.config.farDisplacement + 
        (this.config.nearDisplacement - this.config.farDisplacement) * nearness
      const speed = this.config.farSpeed + 
        (this.config.nearSpeed - this.config.farSpeed) * nearness
      
      this.bands.push({
        id: this.nextBandId++,
        depthMin: adjustedMin,
        depthMax: adjustedMax,
        phase: Math.random() * Math.PI * 2,
        speed,
        displacement,
        age: 0,
        excited: false,
        exciteStartTime: 0,
      })
    }
  }
  
  /**
   * Sample wisps from rendered splat canvas.
   */
  private sampleWisps(): void {
    if (!this.sourceCanvas || !this.ctx) return
    
    this.wisps = []
    const W = window.innerWidth
    const H = window.innerHeight
    
    try {
      // Create downsampled canvas for performance
      const sampleScale = 0.5
      const sampleW = Math.floor(W * sampleScale)
      const sampleH = Math.floor(H * sampleScale)
      
      const tempCanvas = document.createElement('canvas')
      tempCanvas.width = sampleW
      tempCanvas.height = sampleH
      const tempCtx = tempCanvas.getContext('2d')
      
      if (!tempCtx) return
      
      // Draw source canvas scaled down
      tempCtx.drawImage(this.sourceCanvas, 0, 0, sampleW, sampleH)
      const imageData = tempCtx.getImageData(0, 0, sampleW, sampleH)
      const data = imageData.data
      
      // Sample pixels with alpha threshold
      const ALPHA_THRESHOLD = 30
      const sampleStep = 2 // Sample every 2 pixels
      const targetCount = Math.min(this.MAX_WISPS, Math.floor((sampleW * sampleH) / (sampleStep * sampleStep)))
      
      let sampled = 0
      for (let y = 0; y < sampleH && sampled < targetCount; y += sampleStep) {
        for (let x = 0; x < sampleW && sampled < targetCount; x += sampleStep) {
          const idx = (y * sampleW + x) * 4
          const alpha = data[idx + 3]
          
          if (alpha > ALPHA_THRESHOLD) {
            // Calculate pseudo-depth from camera space
            // Strategy: Use brightness and position as depth proxies
            // Brighter pixels tend to be nearer, darker pixels tend to be farther
            // Also consider distance from center (center = near, edges = far)
            const centerX = sampleW / 2
            const centerY = sampleH / 2
            const distX = Math.abs(x - centerX) / centerX
            const distY = Math.abs(y - centerY) / centerY
            const distFromCenter = Math.sqrt(distX * distX + distY * distY)
            
            // Brightness-based depth (brighter = nearer)
            const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) / (3 * 255)
            const brightnessDepth = 1 - brightness // Invert: bright = near (0), dark = far (1)
            
            // Position-based depth (center = near, edges = far)
            const positionDepth = Math.min(1, distFromCenter)
            
            // Combine both signals (weighted average)
            const depth = (brightnessDepth * 0.6 + positionDepth * 0.4)
            
            // Add some noise for organic feel
            const depthNoise = (Math.random() - 0.5) * 0.15
            const finalDepth = Math.max(0, Math.min(1, depth + depthNoise))
            
            this.wisps.push({
              x: (x / sampleScale) + (Math.random() - 0.5) * 4, // Add slight jitter
              y: (y / sampleScale) + (Math.random() - 0.5) * 4,
              depth: finalDepth,
              r: data[idx],
              g: data[idx + 1],
              b: data[idx + 2],
              baseX: x / sampleScale,
              baseY: y / sampleScale,
              phase: Math.random() * Math.PI * 2,
              size: this.config.wispSize,
              alpha: this.config.wispAlpha,
            })
            sampled++
          }
        }
      }
    } catch (e) {
      console.warn('[DEPTH_DRIFT] Failed to sample wisps:', e)
    }
  }
  
  /**
   * Update bands (reshuffle if needed, update phases).
   */
  private updateBands(now: number): void {
    // Reshuffle bands if lifetime expired (organic feel)
    if (now - this.lastReshuffleTime > this.config.bandLifetime) {
      this.createBands()
      this.lastReshuffleTime = now
    }
    
    // Update band phases and excitement
    for (const band of this.bands) {
      // Update excitement state
      if (band.excited) {
        const exciteElapsed = now - band.exciteStartTime
        if (exciteElapsed > this.config.tapExciteDuration) {
          band.excited = false
        }
      }
      
      // Update animation phase (sine wave + mild noise)
      const speedMultiplier = band.excited ? this.config.tapExciteIntensity : 1.0
      const baseSpeed = 0.02 * band.speed * speedMultiplier
      const noiseSpeed = (Math.random() - 0.5) * 0.002 // Mild noise
      band.phase += baseSpeed + noiseSpeed
      
      if (band.phase > Math.PI * 2) {
        band.phase -= Math.PI * 2
      } else if (band.phase < 0) {
        band.phase += Math.PI * 2
      }
    }
  }
  
  /**
   * Check if wisp belongs to a depth band.
   */
  private getWispBand(wisp: Wisp): DepthBand | null {
    for (const band of this.bands) {
      if (wisp.depth >= band.depthMin && wisp.depth <= band.depthMax) {
        return band
      }
    }
    return null
  }
  
  /**
   * Draw soft wisps (not dots).
   * Uses splat-colored wisps with soft radial gradients for volumetric feel.
   */
  private drawWisp(wisp: Wisp, band: DepthBand | null, now: number): void {
    if (!this.ctx || !band) return
    
    const intensity = this.config.intensity
    const excitement = band.excited 
      ? Math.max(0, 1 - (now - band.exciteStartTime) / this.config.tapExciteDuration)
      : 0
    const excitementMultiplier = 1 + excitement * (this.config.tapExciteIntensity - 1)
    
    // Calculate displacement based on band
    // Near bands move more, far bands move less
    const sineX = Math.sin(wisp.phase + band.phase) * band.displacement * intensity * excitementMultiplier
    const sineY = Math.cos(wisp.phase * 0.7 + band.phase) * band.displacement * 0.6 * intensity * excitementMultiplier
    
    // Add mild noise for organic feel
    const noiseX = (Math.random() - 0.5) * 0.4
    const noiseY = (Math.random() - 0.5) * 0.4
    
    const x = wisp.baseX + sineX + noiseX
    const y = wisp.baseY + sineY + noiseY
    
    // Draw soft wisp (radial gradient for softness, not dots)
    const size = wisp.size * (1 + excitement * 0.3)
    const alpha = wisp.alpha * intensity * (1 + excitement * 0.5)
    
    this.ctx.save()
    this.ctx.globalAlpha = alpha
    this.ctx.globalCompositeOperation = 'screen' // Additive blending for soft glow
    
    // Soft radial gradient (splat-colored)
    const gradient = this.ctx.createRadialGradient(x, y, 0, x, y, size)
    gradient.addColorStop(0, `rgba(${wisp.r}, ${wisp.g}, ${wisp.b}, 0.8)`)
    gradient.addColorStop(0.4, `rgba(${wisp.r}, ${wisp.g}, ${wisp.b}, 0.4)`)
    gradient.addColorStop(0.7, `rgba(${wisp.r}, ${wisp.g}, ${wisp.b}, 0.2)`)
    gradient.addColorStop(1, `rgba(${wisp.r}, ${wisp.g}, ${wisp.b}, 0)`)
    
    this.ctx.fillStyle = gradient
    this.ctx.beginPath()
    this.ctx.arc(x, y, size, 0, Math.PI * 2)
    this.ctx.fill()
    
    this.ctx.restore()
  }
  
  /**
   * Animation loop.
   */
  private animate = (): void => {
    if (!this.isActive || this.isPaused || !this.ctx || !this.overlay) {
      if (this.isActive && !this.isPaused) {
        this.rafId = requestAnimationFrame(this.animate)
      }
      return
    }
    
    const now = performance.now()
    
    // Resample wisps periodically
    if (now - this.lastSampleTime > this.SAMPLE_INTERVAL) {
      this.sampleWisps()
      this.lastSampleTime = now
    }
    
    // Update bands
    this.updateBands(now)
    
    // Clear canvas
    const W = window.innerWidth
    const H = window.innerHeight
    this.ctx.clearRect(0, 0, W, H)
    
    // Draw wisps
    for (const wisp of this.wisps) {
      const band = this.getWispBand(wisp)
      if (band) {
        this.drawWisp(wisp, band, now)
      }
    }
    
    this.rafId = requestAnimationFrame(this.animate)
  }
  
  destroy(): void {
    this.stop()
    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay)
    }
    this.overlay = null
    this.ctx = null
  }
}
