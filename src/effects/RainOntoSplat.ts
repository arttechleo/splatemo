/**
 * Rain Onto Splat Effect
 * Rain droplets falling from viewer perspective toward the Gaussian splat.
 * Pseudo-3D depth simulation with impact detection on splat silhouette.
 */

export const DEBUG_RAIN_ONTO_SPLAT = true // Enable for debugging

type Droplet = {
  x: number // Screen X
  y: number // Screen Y
  z: number // Pseudo-3D depth (0 = near camera, increases toward splat)
  vx: number // Horizontal drift
  vy: number // Vertical drift (gravity)
  vz: number // Forward velocity (toward splat)
  size: number // Base size
  age: number // Age in ms
  hasImpacted: boolean // Whether droplet has hit splat
  impactX: number // Impact screen X
  impactY: number // Impact screen Y
  impactTime: number // Time of impact
  highlightX: number // Highlight offset
  highlightY: number
  tintR: number // Splat color tint
  tintG: number
  tintB: number
  hasTint: boolean
}

type ImpactStreak = {
  x: number
  y: number
  startY: number // Original impact Y
  length: number // Streak length
  age: number // Age in ms
  lifetime: number // Total lifetime
  tintR: number
  tintG: number
  tintB: number
  alpha: number
}

type SplatMask = {
  data: Uint8Array // Downsampled mask data (1 = splat present, 0 = empty)
  width: number
  height: number
  scale: number // Downsample scale factor
}

export interface RainOntoSplatConfig {
  intensity: number // 0-1: spawn rate + count
  depthTravel: number // 0-1: how far droplets travel / perspective strength
  decay: number // 0-1: impact streak lifetime
  wind: number // 0-1: horizontal drift
  enabled: boolean
}

export class RainOntoSplat {
  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private rafId: number | null = null
  private isActive = false
  private config: RainOntoSplatConfig = {
    intensity: 0.7,
    depthTravel: 0.6,
    decay: 0.7,
    wind: 0.2,
    enabled: false,
  }
  
  private droplets: Droplet[] = []
  private impactStreaks: ImpactStreak[] = []
  private sourceCanvas: HTMLCanvasElement | null = null
  
  // Splat mask for impact detection
  private splatMask: SplatMask | null = null
  private lastMaskUpdate = 0
  private readonly MASK_REFRESH_FPS = 10 // Update mask at 10 FPS
  private maskDownsample = 4 // Adaptive downsampling (starts at 4×)
  
  // Debug stats
  private debugStats = {
    maskCoverage: 0,
    maskNonZeroCount: 0,
    maskTotalPixels: 0,
    impactsThisSecond: 0,
    lastImpactCountTime: 0,
    impactsPerSecond: 0,
    maskBounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
  }
  
  // Spawn timing
  private lastSpawnTime = 0
  private spawnInterval = 200 // Base spawn interval (ms) - increased for visibility
  
  // Performance caps
  private readonly MAX_DROPLETS = 25 // Fewer, hero droplets
  private readonly MAX_STREAKS = 40
  
  // Physics constants
  private readonly GRAVITY = 0.08 // Subtle gravity
  private readonly BASE_FORWARD_SPEED = 0.25 // Speed toward splat (z increase) - increased for visibility
  private readonly WIND_STRENGTH = 0.04
  private readonly DEPTH_SCALE = 8.0 // How z maps to perspective
  private readonly Z_IMPACT_THRESHOLD = 0.6 // Droplet must reach this z to impact
  
  // Visual constants
  private readonly BASE_SIZE = 4.5 // Larger hero droplets
  private readonly SIZE_VARIANCE = 2.0
  private readonly HIGHLIGHT_SIZE = 0.5
  private readonly STREAK_WIDTH = 2.5
  private readonly STREAK_MIN_LIFETIME = 2000
  private readonly STREAK_MAX_LIFETIME = 6000
  
  constructor() {
    this.initCanvas()
  }
  
  private initCanvas(): void {
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'rain-onto-splat-overlay'
    this.canvas.style.position = 'fixed'
    this.canvas.style.top = '0'
    this.canvas.style.left = '0'
    this.canvas.style.width = '100%'
    this.canvas.style.height = '100%'
    this.canvas.style.pointerEvents = 'none'
    this.canvas.style.zIndex = '10'
    this.canvas.style.opacity = '1'
    
    this.resize()
    
    document.body.appendChild(this.canvas)
    
    window.addEventListener('resize', () => this.resize())
  }
  
  private resize(): void {
    if (!this.canvas) return
    
    // Match source canvas pixel dimensions if available, otherwise use window size
    let targetWidth = window.innerWidth
    let targetHeight = window.innerHeight
    
    if (this.sourceCanvas) {
      // Use actual pixel buffer size from source canvas
      targetWidth = this.sourceCanvas.width
      targetHeight = this.sourceCanvas.height
    } else {
      // Fallback: use window size with DPR
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      targetWidth = window.innerWidth * dpr
      targetHeight = window.innerHeight * dpr
    }
    
    this.canvas.width = targetWidth
    this.canvas.height = targetHeight
    
    // CSS size matches window (for proper overlay positioning)
    this.canvas.style.width = `${window.innerWidth}px`
    this.canvas.style.height = `${window.innerHeight}px`
    
    this.ctx = this.canvas.getContext('2d', { alpha: true })
    if (this.ctx) {
      // Scale context to match pixel dimensions
      const scaleX = targetWidth / window.innerWidth
      const scaleY = targetHeight / window.innerHeight
      this.ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0)
    }
    
    // Invalidate mask on resize
    this.splatMask = null
  }
  
  setSourceCanvas(canvas: HTMLCanvasElement | null): void {
    this.sourceCanvas = canvas
    this.splatMask = null // Invalidate mask
    // Resize overlay to match source canvas dimensions
    if (this.canvas) {
      this.resize()
    }
  }
  
  setConfig(config: Partial<RainOntoSplatConfig>): void {
    this.config = { ...this.config, ...config }
    if (!this.config.enabled) {
      this.stop()
    } else {
      this.start()
    }
  }
  
  getConfig(): RainOntoSplatConfig {
    return { ...this.config }
  }
  
  pause(): void {
    this.isActive = false
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
  }
  
  resume(): void {
    if (this.config.enabled && !this.isActive) {
      this.start()
    }
  }
  
  private start(): void {
    if (this.isActive || !this.config.enabled) return
    this.isActive = true
    this.lastSpawnTime = performance.now()
    this.animate()
  }
  
  private stop(): void {
    this.isActive = false
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    this.droplets = []
    this.impactStreaks = []
    if (this.ctx && this.canvas) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    }
  }
  
  /**
   * Build a downsampled splat mask for impact detection.
   * Returns a binary mask (1 = splat present, 0 = empty).
   * Uses adaptive threshold and downsampling for robustness.
   */
  private buildSplatMask(): SplatMask | null {
    if (!this.sourceCanvas) return null
    
    const now = performance.now()
    const maskInterval = 1000 / this.MASK_REFRESH_FPS
    
    // Reuse cached mask if recent
    if (this.splatMask && now - this.lastMaskUpdate < maskInterval) {
      return this.splatMask
    }
    
    try {
      const ctx = this.sourceCanvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return null
      
      const sourceW = this.sourceCanvas.width
      const sourceH = this.sourceCanvas.height
      
      if (sourceW < 4 || sourceH < 4) return null
      
      // Adaptive downsampling: start with current value, reduce if coverage too low
      let currentDownsample = this.maskDownsample
      let maskData: Uint8Array | null = null
      let maskW = 0
      let maskH = 0
      let coverage = 0
      
      // Try building mask with adaptive threshold
      for (let attempt = 0; attempt < 3; attempt++) {
        maskW = Math.floor(sourceW / currentDownsample)
        maskH = Math.floor(sourceH / currentDownsample)
        
        if (maskW < 4 || maskH < 4) break
        
        const sampleW = Math.min(maskW * currentDownsample, sourceW)
        const sampleH = Math.min(maskH * currentDownsample, sourceH)
        
        const imageData = ctx.getImageData(0, 0, sampleW, sampleH)
        const data = imageData.data
        
        // Compute adaptive threshold from histogram
        const alphaValues: number[] = []
        const brightnessValues: number[] = []
        
        for (let i = 0; i < data.length; i += 4) {
          const a = data[i + 3]
          const r = data[i]
          const g = data[i + 1]
          const b = data[i + 2]
          const brightness = (r + g + b) / 3
          
          if (a > 0) alphaValues.push(a)
          if (brightness > 0) brightnessValues.push(brightness)
        }
        
        // Compute mean and std for adaptive threshold
        const alphaMean = alphaValues.length > 0 
          ? alphaValues.reduce((a, b) => a + b, 0) / alphaValues.length 
          : 0
        const brightnessMean = brightnessValues.length > 0
          ? brightnessValues.reduce((a, b) => a + b, 0) / brightnessValues.length
          : 0
        
        // Adaptive threshold: mean - std, clamped to reasonable range
        const alphaStd = alphaValues.length > 0
          ? Math.sqrt(alphaValues.reduce((sum, val) => sum + Math.pow(val - alphaMean, 2), 0) / alphaValues.length)
          : 0
        const brightnessStd = brightnessValues.length > 0
          ? Math.sqrt(brightnessValues.reduce((sum, val) => sum + Math.pow(val - brightnessMean, 2), 0) / brightnessValues.length)
          : 0
        
        let alphaThreshold = Math.max(5, Math.min(30, alphaMean - alphaStd * 0.5))
        let brightnessThreshold = Math.max(3, Math.min(20, brightnessMean - brightnessStd * 0.5))
        
        // Build mask
        maskData = new Uint8Array(maskW * maskH)
        let nonZeroCount = 0
        let minX = maskW
        let maxX = 0
        let minY = maskH
        let maxY = 0
        
        for (let my = 0; my < maskH; my++) {
          for (let mx = 0; mx < maskW; mx++) {
            const sx = mx * currentDownsample
            const sy = my * currentDownsample
            const si = (sy * sampleW + sx) << 2
            
            const r = data[si]
            const g = data[si + 1]
            const b = data[si + 2]
            const a = data[si + 3]
            
            const brightness = (r + g + b) / 3
            const isSplat = a > alphaThreshold || brightness > brightnessThreshold
            
            if (isSplat) {
              maskData[my * maskW + mx] = 1
              nonZeroCount++
              minX = Math.min(minX, mx)
              maxX = Math.max(maxX, mx)
              minY = Math.min(minY, my)
              maxY = Math.max(maxY, my)
            } else {
              maskData[my * maskW + mx] = 0
            }
          }
        }
        
        coverage = nonZeroCount / (maskW * maskH)
        
        // If coverage is reasonable, use this mask
        if (coverage > 0.01 && coverage < 0.95) {
          break
        }
        
        // If coverage too low, reduce downsampling and try again
        if (coverage < 0.01 && currentDownsample > 2) {
          currentDownsample = Math.max(2, currentDownsample - 1)
          continue
        }
        
        // If coverage too high, increase threshold slightly
        if (coverage >= 0.95) {
          alphaThreshold = Math.min(50, alphaThreshold + 5)
          brightnessThreshold = Math.min(30, brightnessThreshold + 3)
          // Rebuild with new threshold
          nonZeroCount = 0
          minX = maskW
          maxX = 0
          minY = maskH
          maxY = 0
          
          for (let my = 0; my < maskH; my++) {
            for (let mx = 0; mx < maskW; mx++) {
              const sx = mx * currentDownsample
              const sy = my * currentDownsample
              const si = (sy * sampleW + sx) << 2
              
              const r = data[si]
              const g = data[si + 1]
              const b = data[si + 2]
              const a = data[si + 3]
              
              const brightness = (r + g + b) / 3
              const isSplat = a > alphaThreshold || brightness > brightnessThreshold
              
              if (isSplat) {
                maskData![my * maskW + mx] = 1
                nonZeroCount++
                minX = Math.min(minX, mx)
                maxX = Math.max(maxX, mx)
                minY = Math.min(minY, my)
                maxY = Math.max(maxY, my)
              } else {
                maskData![my * maskW + mx] = 0
              }
            }
          }
          coverage = nonZeroCount / (maskW * maskH)
          break
        }
      }
      
      if (!maskData || coverage < 0.001) {
        return null
      }
      
      // Count non-zero pixels and compute bounds
      let nonZeroCount = 0
      let minX = maskW
      let maxX = 0
      let minY = maskH
      let maxY = 0
      
      for (let i = 0; i < maskData.length; i++) {
        if (maskData[i] === 1) {
          nonZeroCount++
          const mx = i % maskW
          const my = Math.floor(i / maskW)
          minX = Math.min(minX, mx)
          maxX = Math.max(maxX, mx)
          minY = Math.min(minY, my)
          maxY = Math.max(maxY, my)
        }
      }
      
      // Update debug stats
      this.debugStats.maskCoverage = coverage
      this.debugStats.maskNonZeroCount = nonZeroCount
      this.debugStats.maskTotalPixels = maskW * maskH
      this.debugStats.maskBounds = nonZeroCount > 0 
        ? { minX, maxX, minY, maxY }
        : { minX: 0, maxX: 0, minY: 0, maxY: 0 }
      this.maskDownsample = currentDownsample
      
      this.splatMask = {
        data: maskData,
        width: maskW,
        height: maskH,
        scale: currentDownsample,
      }
      
      this.lastMaskUpdate = now
      return this.splatMask
    } catch (error) {
      console.warn('[RAIN_ONTO_SPLAT] Mask build error', error)
      return null
    }
  }
  
  /**
   * Check if a screen position hits the splat mask.
   * Uses pixel coordinates matching source canvas dimensions.
   */
  private checkImpact(x: number, y: number, z: number): boolean {
    if (!this.splatMask || !this.sourceCanvas) return false
    
    // Droplet must have progressed far enough in z-space
    if (z < this.Z_IMPACT_THRESHOLD) return false
    
    // Convert screen coordinates (CSS pixels) to source canvas pixel coordinates
    const W = window.innerWidth
    const H = window.innerHeight
    const sourceW = this.sourceCanvas.width
    const sourceH = this.sourceCanvas.height
    
    // Map screen coords to source canvas pixel coords
    const canvasX = (x / W) * sourceW
    const canvasY = (y / H) * sourceH
    
    // Convert to mask coordinates (accounting for downsampling)
    const maskX = Math.floor(canvasX / this.splatMask.scale)
    const maskY = Math.floor(canvasY / this.splatMask.scale)
    
    if (maskX < 0 || maskX >= this.splatMask.width || maskY < 0 || maskY >= this.splatMask.height) {
      return false
    }
    
    // Check mask with increased tolerance radius (especially for downsampled masks)
    const radius = Math.max(2, Math.ceil(this.splatMask.scale / 2)) // Larger radius for downsampled masks
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const mx = maskX + dx
        const my = maskY + dy
        if (mx >= 0 && mx < this.splatMask.width && my >= 0 && my < this.splatMask.height) {
          if (this.splatMask.data[my * this.splatMask.width + mx] === 1) {
            return true
          }
        }
      }
    }
    
    return false
  }
  
  /**
   * Sample splat color at impact position for tinting.
   * Uses correct coordinate mapping from screen to canvas pixels.
   */
  private sampleSplatColor(x: number, y: number): { r: number; g: number; b: number } {
    if (!this.sourceCanvas) return { r: 255, g: 255, b: 255 }
    
    try {
      const ctx = this.sourceCanvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return { r: 255, g: 255, b: 255 }
      
      const W = window.innerWidth
      const H = window.innerHeight
      const sourceW = this.sourceCanvas.width
      const sourceH = this.sourceCanvas.height
      
      // Map screen coords to source canvas pixel coords
      const canvasX = Math.floor((x / W) * sourceW)
      const canvasY = Math.floor((y / H) * sourceH)
      
      // Clamp to valid range
      const clampedX = Math.max(0, Math.min(sourceW - 1, canvasX))
      const clampedY = Math.max(0, Math.min(sourceH - 1, canvasY))
      
      const imageData = ctx.getImageData(clampedX, clampedY, 1, 1)
      const data = imageData.data
      
      if (data[3] > 10) {
        return { r: data[0], g: data[1], b: data[2] }
      }
    } catch {
      // Fallback
    }
    
    return { r: 255, g: 255, b: 255 }
  }
  
  /**
   * Create impact effect (streak that slides down splat).
   */
  private createImpactStreak(x: number, y: number, tint: { r: number; g: number; b: number }): void {
    if (this.impactStreaks.length >= this.MAX_STREAKS) {
      // Remove oldest streak
      this.impactStreaks.shift()
    }
    
    const lifetime = this.STREAK_MIN_LIFETIME + 
      (this.STREAK_MAX_LIFETIME - this.STREAK_MIN_LIFETIME) * (0.3 + this.config.decay * 0.7)
    
    const streak: ImpactStreak = {
      x,
      y,
      startY: y,
      length: 0,
      age: 0,
      lifetime,
      tintR: tint.r,
      tintG: tint.g,
      tintB: tint.b,
      alpha: 1.0,
    }
    
    this.impactStreaks.push(streak)
  }
  
  private spawnTestDroplet(): void {
    if (this.droplets.length >= this.MAX_DROPLETS) return
    
    const W = window.innerWidth
    const H = window.innerHeight
    
    // Spawn at center of screen for testing
    const x = W / 2
    const y = H * 0.2 // Near top
    
    const z = 0.1 // Start near camera
    
    const size = this.BASE_SIZE + this.SIZE_VARIANCE
    
    const forwardSpeed = this.BASE_FORWARD_SPEED
    const vz = forwardSpeed * (0.5 + this.config.depthTravel * 0.5)
    
    const highlightX = size * 0.25
    const highlightY = -size * 0.25
    
    const droplet: Droplet = {
      x,
      y,
      z,
      vx: 0,
      vy: this.GRAVITY,
      vz,
      size,
      age: 0,
      hasImpacted: false,
      impactX: 0,
      impactY: 0,
      impactTime: 0,
      highlightX,
      highlightY,
      tintR: 255,
      tintG: 255,
      tintB: 255,
      hasTint: false,
    }
    
    this.droplets.push(droplet)
  }
  
  private spawnDroplet(): void {
    if (this.droplets.length >= this.MAX_DROPLETS) return
    
    const W = window.innerWidth
    
    // Spawn near top with horizontal variance
    const x = (Math.random() * 0.8 + 0.1) * W
    const y = -20 - Math.random() * 30 // Start above viewport
    
    // Start near camera (z = 0), will increase toward splat
    const z = Math.random() * 0.5 // Start slightly forward
    
    // Size variation (hero droplets)
    const size = this.BASE_SIZE + Math.random() * this.SIZE_VARIANCE
    
    // Velocities
    const forwardSpeed = this.BASE_FORWARD_SPEED * (0.8 + Math.random() * 0.4)
    const windDrift = (Math.random() - 0.5) * this.WIND_STRENGTH * (0.5 + this.config.wind * 0.5)
    const gravity = this.GRAVITY * (0.7 + Math.random() * 0.3)
    
    // Depth travel affects forward speed
    const depthMultiplier = 0.5 + this.config.depthTravel * 0.5
    const vz = forwardSpeed * depthMultiplier
    
    // Highlight position
    const highlightX = size * (0.2 + Math.random() * 0.1)
    const highlightY = -size * (0.2 + Math.random() * 0.1)
    
    const droplet: Droplet = {
      x,
      y,
      z,
      vx: windDrift,
      vy: gravity,
      vz,
      size,
      age: 0,
      hasImpacted: false,
      impactX: 0,
      impactY: 0,
      impactTime: 0,
      highlightX,
      highlightY,
      tintR: 255,
      tintG: 255,
      tintB: 255,
      hasTint: false,
    }
    
    this.droplets.push(droplet)
  }
  
  /**
   * Project pseudo-3D position to screen space.
   * As z increases (toward splat), droplet appears smaller and more intense.
   */
  private projectToScreen(droplet: Droplet): { screenX: number; screenY: number; screenSize: number; intensity: number } {
    // Perspective scale: as z increases, size decreases (further away)
    const perspectiveScale = 1.0 / (1.0 + droplet.z * this.DEPTH_SCALE)
    const screenSize = droplet.size * perspectiveScale
    
    // Intensity increases as droplet gets closer to splat (z increases)
    const intensity = 0.6 + droplet.z * 0.4
    
    return {
      screenX: droplet.x,
      screenY: droplet.y,
      screenSize,
      intensity,
    }
  }
  
  private updateDroplets(deltaTime: number): void {
    const W = window.innerWidth
    
    // Update splat mask
    const mask = this.buildSplatMask()
    
    // Spawn new droplets
    const now = performance.now()
    const intensitySpawnRate = 0.3 + this.config.intensity * 0.7
    const spawnInterval = this.spawnInterval / intensitySpawnRate
    
    if (now - this.lastSpawnTime >= spawnInterval) {
      this.spawnDroplet()
      this.lastSpawnTime = now
      
      // Spawn test droplet in debug mode (center of screen)
      if (DEBUG_RAIN_ONTO_SPLAT && Math.random() < 0.1) {
        this.spawnTestDroplet()
      }
    }
    
    // Update impact counter (reset every second)
    if (now - this.debugStats.lastImpactCountTime >= 1000) {
      this.debugStats.impactsPerSecond = this.debugStats.impactsThisSecond
      this.debugStats.impactsThisSecond = 0
      this.debugStats.lastImpactCountTime = now
    }
    
    // Update existing droplets
    const activeDroplets: Droplet[] = []
    
    for (const droplet of this.droplets) {
      droplet.age += deltaTime
      
      // Skip if already impacted
      if (droplet.hasImpacted) {
        continue
      }
      
      // Update position (forward toward splat)
      droplet.z += droplet.vz * (deltaTime / 16.67)
      droplet.y += droplet.vy * (deltaTime / 16.67)
      droplet.x += droplet.vx * (deltaTime / 16.67)
      
      // Apply gravity
      droplet.vy += this.GRAVITY * (deltaTime / 16.67)
      
      // Apply wind
      const windFactor = 0.5 + this.config.wind * 0.5
      droplet.vx += (Math.random() - 0.5) * this.WIND_STRENGTH * windFactor * 0.05
      droplet.vx *= 0.99
      
      // Project to screen for impact check
      const projected = this.projectToScreen(droplet)
      
      // Check impact (temporarily remove z-gating for validation)
      // TODO: Re-enable z-gating once hits are confirmed: droplet.z >= this.Z_IMPACT_THRESHOLD &&
      if (mask && this.checkImpact(projected.screenX, projected.screenY, droplet.z)) {
        // Impact detected!
        droplet.hasImpacted = true
        droplet.impactX = projected.screenX
        droplet.impactY = projected.screenY
        droplet.impactTime = now
        
        // Update impact counter for debug
        this.debugStats.impactsThisSecond++
        
        // Sample splat color for tinting
        const tint = this.sampleSplatColor(projected.screenX, projected.screenY)
        droplet.tintR = tint.r
        droplet.tintG = tint.g
        droplet.tintB = tint.b
        droplet.hasTint = true
        
        // Create impact streak
        this.createImpactStreak(projected.screenX, projected.screenY, tint)
      }
      
      // Remove if out of bounds or too far forward
      const H = window.innerHeight
      if (droplet.y > H + 100 || droplet.z > 2.0) {
        continue
      }
      
      // Wrap horizontally
      if (droplet.x < -50) droplet.x = W + 50
      if (droplet.x > W + 50) droplet.x = -50
      
      activeDroplets.push(droplet)
    }
    
    this.droplets = activeDroplets
  }
  
  private updateStreaks(deltaTime: number): void {
    const activeStreaks: ImpactStreak[] = []
    
    for (const streak of this.impactStreaks) {
      streak.age += deltaTime
      
      // Streak slides down (increases Y)
      const slideSpeed = 0.8 + Math.random() * 0.4
      streak.y += slideSpeed * (deltaTime / 16.67)
      streak.length += slideSpeed * (deltaTime / 16.67)
      
      // Fade over lifetime
      const ageRatio = streak.age / streak.lifetime
      streak.alpha = 1.0 - ageRatio
      
      // Remove if expired
      if (streak.age >= streak.lifetime || streak.alpha < 0.01) {
        continue
      }
      
      activeStreaks.push(streak)
    }
    
    this.impactStreaks = activeStreaks
  }
  
  private drawDroplet(droplet: Droplet): void {
    if (!this.ctx || droplet.hasImpacted) return
    
    const projected = this.projectToScreen(droplet)
    
    // Calculate alpha based on age and intensity
    const ageFade = Math.min(1.0, droplet.age / 2000) // Fade in over 2 seconds
    const alpha = (0.8 + this.config.intensity * 0.2) * projected.intensity * (1 - ageFade * 0.3)
    
    if (alpha < 0.01) return
    
    const x = projected.screenX
    const y = projected.screenY
    const size = projected.screenSize
    
    // Draw shadow/outline
    this.ctx.save()
    this.ctx.globalAlpha = alpha * 0.6
    this.ctx.fillStyle = `rgba(0, 0, 0, ${alpha * 0.5})`
    this.ctx.beginPath()
    this.ctx.arc(x, y, size * 1.2, 0, Math.PI * 2)
    this.ctx.fill()
    this.ctx.restore()
    
    // Draw main droplet (bright, hero style)
    this.ctx.save()
    this.ctx.globalAlpha = alpha
    
    if (droplet.hasTint) {
      // Use tint but keep it bright
      const brighten = 1.4
      this.ctx.fillStyle = `rgba(${Math.min(255, droplet.tintR * brighten)}, ${Math.min(255, droplet.tintG * brighten)}, ${Math.min(255, droplet.tintB * brighten)}, ${alpha})`
    } else {
      this.ctx.fillStyle = `rgba(220, 240, 255, ${alpha * 0.95})`
    }
    
    this.ctx.beginPath()
    this.ctx.arc(x, y, size, 0, Math.PI * 2)
    this.ctx.fill()
    this.ctx.restore()
    
    // Draw highlight (bright, hero style)
    this.ctx.save()
    this.ctx.globalAlpha = alpha * 0.9
    const highlightGradient = this.ctx.createRadialGradient(
      x + droplet.highlightX,
      y + droplet.highlightY,
      0,
      x + droplet.highlightX,
      y + droplet.highlightY,
      size * this.HIGHLIGHT_SIZE
    )
    highlightGradient.addColorStop(0, `rgba(255, 255, 255, ${alpha})`)
    highlightGradient.addColorStop(1, `rgba(255, 255, 255, 0)`)
    this.ctx.fillStyle = highlightGradient
    this.ctx.beginPath()
    this.ctx.arc(x + droplet.highlightX, y + droplet.highlightY, size * this.HIGHLIGHT_SIZE, 0, Math.PI * 2)
    this.ctx.fill()
    this.ctx.restore()
    
    // Draw bright outline
    this.ctx.save()
    this.ctx.globalAlpha = alpha * 0.8
    this.ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.6})`
    this.ctx.lineWidth = 1.0
    this.ctx.beginPath()
    this.ctx.arc(x, y, size, 0, Math.PI * 2)
    this.ctx.stroke()
    this.ctx.restore()
  }
  
  private drawStreak(streak: ImpactStreak): void {
    if (!this.ctx) return
    
    if (streak.alpha < 0.01) return
    
    const x = streak.x
    const startY = streak.startY
    const endY = streak.y
    const length = streak.length
    
    if (length < 2) return
    
    // Draw streak as gradient line
    this.ctx.save()
    this.ctx.globalAlpha = streak.alpha * (0.7 + this.config.decay * 0.3)
    
    // Create gradient from impact point downward
    const gradient = this.ctx.createLinearGradient(x, startY, x, endY)
    gradient.addColorStop(0, `rgba(${streak.tintR}, ${streak.tintG}, ${streak.tintB}, ${streak.alpha * 0.9})`)
    gradient.addColorStop(0.5, `rgba(${streak.tintR}, ${streak.tintG}, ${streak.tintB}, ${streak.alpha * 0.7})`)
    gradient.addColorStop(1, `rgba(${streak.tintR}, ${streak.tintG}, ${streak.tintB}, 0)`)
    
    this.ctx.strokeStyle = gradient
    this.ctx.lineWidth = this.STREAK_WIDTH
    this.ctx.lineCap = 'round'
    this.ctx.beginPath()
    this.ctx.moveTo(x, startY)
    this.ctx.lineTo(x, endY)
    this.ctx.stroke()
    
    // Add subtle glow
    this.ctx.shadowBlur = 4
    this.ctx.shadowColor = `rgba(${streak.tintR}, ${streak.tintG}, ${streak.tintB}, ${streak.alpha * 0.3})`
    this.ctx.stroke()
    this.ctx.shadowBlur = 0
    
    this.ctx.restore()
  }
  
  private drawDebugVisualization(): void {
    if (!this.ctx || !this.canvas) return
    
    const W = window.innerWidth
    const H = window.innerHeight
    
    // Draw mask overlay
    if (this.splatMask) {
      const maskScale = this.splatMask.scale
      const sourceW = this.sourceCanvas?.width || W
      const sourceH = this.sourceCanvas?.height || H
      
      // Draw mask as semi-transparent green overlay
      this.ctx.save()
      this.ctx.globalAlpha = 0.3
      this.ctx.fillStyle = 'rgba(0, 255, 0, 0.5)'
      
      for (let my = 0; my < this.splatMask.height; my++) {
        for (let mx = 0; mx < this.splatMask.width; mx++) {
          if (this.splatMask.data[my * this.splatMask.width + mx] === 1) {
            // Convert mask coords to screen coords
            const screenX = (mx * maskScale / sourceW) * W
            const screenY = (my * maskScale / sourceH) * H
            const pixelSize = (maskScale / sourceW) * W
            
            this.ctx.fillRect(screenX, screenY, pixelSize, pixelSize)
          }
        }
      }
      this.ctx.restore()
      
      // Draw bounding box
      if (this.debugStats.maskBounds.maxX > this.debugStats.maskBounds.minX) {
        this.ctx.save()
        this.ctx.strokeStyle = 'rgba(255, 255, 0, 0.8)'
        this.ctx.lineWidth = 2
        const minX = (this.debugStats.maskBounds.minX * maskScale / sourceW) * W
        const maxX = (this.debugStats.maskBounds.maxX * maskScale / sourceW) * W
        const minY = (this.debugStats.maskBounds.minY * maskScale / sourceH) * H
        const maxY = (this.debugStats.maskBounds.maxY * maskScale / sourceH) * H
        this.ctx.strokeRect(minX, minY, maxX - minX, maxY - minY)
        this.ctx.restore()
      }
    }
    
    // Draw droplet crosshairs
    for (const droplet of this.droplets) {
      const projected = this.projectToScreen(droplet)
      const x = projected.screenX
      const y = projected.screenY
      
      // Check if this droplet would hit
      const wouldHit = this.splatMask && droplet.z >= this.Z_IMPACT_THRESHOLD && 
        this.checkImpact(x, y, droplet.z)
      
      this.ctx.save()
      this.ctx.strokeStyle = wouldHit ? 'rgba(255, 0, 0, 0.8)' : 'rgba(255, 255, 255, 0.6)'
      this.ctx.lineWidth = 1
      const crossSize = 4
      this.ctx.beginPath()
      this.ctx.moveTo(x - crossSize, y)
      this.ctx.lineTo(x + crossSize, y)
      this.ctx.moveTo(x, y - crossSize)
      this.ctx.lineTo(x, y + crossSize)
      this.ctx.stroke()
      this.ctx.restore()
    }
    
    // Draw HUD stats
    this.ctx.save()
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.8)'
    this.ctx.fillRect(10, 10, 280, 140)
    this.ctx.fillStyle = '#fff'
    this.ctx.font = '12px monospace'
    let yPos = 28
    this.ctx.fillText(`Mask Coverage: ${(this.debugStats.maskCoverage * 100).toFixed(2)}% (LIVE)`, 15, yPos)
    yPos += 18
    this.ctx.fillText(`Mask Pixels: ${this.debugStats.maskNonZeroCount}/${this.debugStats.maskTotalPixels}`, 15, yPos)
    yPos += 18
    this.ctx.fillText(`Downsample: ${this.maskDownsample}×`, 15, yPos)
    yPos += 18
    this.ctx.fillText(`Droplets: ${this.droplets.length}`, 15, yPos)
    yPos += 18
    this.ctx.fillText(`Impacts/sec: ${this.debugStats.impactsPerSecond}`, 15, yPos)
    yPos += 18
    this.ctx.fillText(`Streaks: ${this.impactStreaks.length}`, 15, yPos)
    yPos += 18
    this.ctx.fillText(`Mask: ${this.splatMask ? 'OK' : 'NULL'}`, 15, yPos)
    this.ctx.restore()
  }
  
  private animate = (): void => {
    if (!this.isActive || !this.config.enabled || !this.ctx || !this.canvas) {
      return
    }
    
    const deltaTime = 16.67 // ~60fps
    
    // Clear canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    
    // SANITY CHECK 1: Prove overlay renders at all
    this.drawSanityCheckOverlay()
    
    // SANITY CHECK 2: Prove we have source canvas
    this.drawSourceCanvasDebug()
    
    // SANITY CHECK 3: Prove snapshot sampling works
    this.drawSnapshotPreview()
    
    // Update droplets and streaks
    this.updateDroplets(deltaTime)
    this.updateStreaks(deltaTime)
    
    // Draw streaks first (behind droplets)
    for (const streak of this.impactStreaks) {
      this.drawStreak(streak)
    }
    
    // Draw droplets
    for (const droplet of this.droplets) {
      this.drawDroplet(droplet)
    }
    
    // Debug visualization
    if (DEBUG_RAIN_ONTO_SPLAT) {
      this.drawDebugVisualization()
    }
    
    this.rafId = requestAnimationFrame(this.animate)
  }
  
  private debugCircleX = 0
  private debugCircleDirection = 1
  
  private drawSanityCheckOverlay(): void {
    if (!this.ctx) return
    
    const W = window.innerWidth
    const H = window.innerHeight
    
    // Draw "RAIN OVERLAY ACTIVE" text at top-left
    this.ctx.save()
    this.ctx.fillStyle = 'rgba(255, 0, 0, 0.9)'
    this.ctx.font = 'bold 24px monospace'
    this.ctx.fillText('RAIN OVERLAY ACTIVE', 20, 40)
    this.ctx.restore()
    
    // Draw animated circle moving across screen
    this.debugCircleX += 2 * this.debugCircleDirection
    if (this.debugCircleX > W - 50) {
      this.debugCircleX = W - 50
      this.debugCircleDirection = -1
    } else if (this.debugCircleX < 50) {
      this.debugCircleX = 50
      this.debugCircleDirection = 1
    }
    
    this.ctx.save()
    this.ctx.fillStyle = 'rgba(0, 255, 255, 0.8)'
    this.ctx.beginPath()
    this.ctx.arc(this.debugCircleX, H / 2, 30, 0, Math.PI * 2)
    this.ctx.fill()
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 1)'
    this.ctx.lineWidth = 3
    this.ctx.stroke()
    this.ctx.restore()
  }
  
  private lastSourceCanvasLog = 0
  
  private drawSourceCanvasDebug(): void {
    if (!this.ctx) return
    
    const now = performance.now()
    if (now - this.lastSourceCanvasLog < 1000) return // Log once per second
    this.lastSourceCanvasLog = now
    
    // Log to console
    if (this.sourceCanvas) {
      console.log('[RAIN_ONTO_SPLAT] Source canvas:', {
        width: this.sourceCanvas.width,
        height: this.sourceCanvas.height,
        tagName: this.sourceCanvas.tagName,
        className: this.sourceCanvas.className,
        isWebGLCanvas: this.sourceCanvas.tagName === 'CANVAS',
      })
    } else {
      console.warn('[RAIN_ONTO_SPLAT] Source canvas is NULL')
    }
    
    // Draw debug panel
    const W = window.innerWidth
    this.ctx.save()
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.8)'
    this.ctx.fillRect(W - 250, 10, 240, 80)
    this.ctx.fillStyle = '#fff'
    this.ctx.font = '11px monospace'
    
    if (this.sourceCanvas) {
      this.ctx.fillText(`Canvas: ${this.sourceCanvas.width}×${this.sourceCanvas.height}`, W - 245, 28)
      this.ctx.fillText(`Type: ${this.sourceCanvas.tagName}`, W - 245, 46)
      this.ctx.fillText(`WebGL: ${this.sourceCanvas.tagName === 'CANVAS' ? 'YES' : 'NO'}`, W - 245, 64)
    } else {
      this.ctx.fillText('Canvas: NULL', W - 245, 28)
    }
    this.ctx.restore()
  }
  
  private snapshotThumbnail: HTMLCanvasElement | null = null
  private lastSnapshotCapture = 0
  
  private drawSnapshotPreview(): void {
    if (!this.ctx || !this.sourceCanvas) return
    
    const now = performance.now()
    const SNAPSHOT_INTERVAL = 200 // Capture every 200ms
    
    // Capture snapshot if needed
    if (now - this.lastSnapshotCapture >= SNAPSHOT_INTERVAL) {
      try {
        const thumbW = 120
        const thumbH = 80
        const sourceW = this.sourceCanvas.width
        const sourceH = this.sourceCanvas.height
        
        if (sourceW > 0 && sourceH > 0) {
          this.snapshotThumbnail = document.createElement('canvas')
          this.snapshotThumbnail.width = thumbW
          this.snapshotThumbnail.height = thumbH
          const thumbCtx = this.snapshotThumbnail.getContext('2d', { alpha: true })
          
          if (thumbCtx) {
            // Try to draw source canvas to thumbnail
            try {
              thumbCtx.drawImage(this.sourceCanvas, 0, 0, sourceW, sourceH, 0, 0, thumbW, thumbH)
            } catch (error) {
              console.warn('[RAIN_ONTO_SPLAT] Snapshot capture failed (tainted?):', error)
              // Draw error indicator
              thumbCtx.fillStyle = 'rgba(255, 0, 0, 0.5)'
              thumbCtx.fillRect(0, 0, thumbW, thumbH)
              thumbCtx.fillStyle = '#fff'
              thumbCtx.font = '10px monospace'
              thumbCtx.fillText('CAPTURE FAILED', 5, thumbH / 2)
            }
          }
        }
        
        this.lastSnapshotCapture = now
      } catch (error) {
        console.warn('[RAIN_ONTO_SPLAT] Snapshot creation error:', error)
      }
    }
    
    // Draw thumbnail preview
    if (this.snapshotThumbnail) {
      const W = window.innerWidth
      const H = window.innerHeight
      const thumbW = 120
      const thumbH = 80
      
      // Draw border
      this.ctx.save()
      this.ctx.strokeStyle = 'rgba(255, 255, 0, 0.8)'
      this.ctx.lineWidth = 2
      this.ctx.strokeRect(W - thumbW - 20, H - thumbH - 20, thumbW, thumbH)
      
      // Draw thumbnail
      this.ctx.drawImage(this.snapshotThumbnail, W - thumbW - 20, H - thumbH - 20, thumbW, thumbH)
      
      // Draw label
      this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
      this.ctx.fillRect(W - thumbW - 20, H - thumbH - 40, thumbW, 18)
      this.ctx.fillStyle = '#fff'
      this.ctx.font = '10px monospace'
      this.ctx.fillText('Snapshot Preview', W - thumbW - 18, H - thumbH - 26)
      this.ctx.restore()
    }
  }
  
  destroy(): void {
    this.stop()
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas)
    }
    this.canvas = null
    this.ctx = null
    this.splatMask = null
  }
}
