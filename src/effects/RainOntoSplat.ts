/**
 * Rain Onto Splat Effect
 * Rain droplets falling from viewer perspective toward the Gaussian splat.
 * Pseudo-3D depth simulation with impact detection on splat silhouette.
 */

export const DEBUG_RAIN_ONTO_SPLAT = false

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
  private readonly MASK_DOWNSAMPLE = 4 // Downsample factor for performance
  
  // Spawn timing
  private lastSpawnTime = 0
  private spawnInterval = 300 // Base spawn interval (ms) - fewer, hero droplets
  
  // Performance caps
  private readonly MAX_DROPLETS = 25 // Fewer, hero droplets
  private readonly MAX_STREAKS = 40
  
  // Physics constants
  private readonly GRAVITY = 0.08 // Subtle gravity
  private readonly BASE_FORWARD_SPEED = 0.12 // Speed toward splat (z increase)
  private readonly WIND_STRENGTH = 0.04
  private readonly DEPTH_SCALE = 8.0 // How z maps to perspective
  
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
    
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    this.canvas.width = window.innerWidth * dpr
    this.canvas.height = window.innerHeight * dpr
    
    this.ctx = this.canvas.getContext('2d', { alpha: true })
    if (this.ctx) {
      this.ctx.scale(dpr, dpr)
    }
    
    document.body.appendChild(this.canvas)
    
    window.addEventListener('resize', () => this.resize())
  }
  
  private resize(): void {
    if (!this.canvas || !this.ctx) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    this.canvas.width = window.innerWidth * dpr
    this.canvas.height = window.innerHeight * dpr
    this.ctx.setTransform(1, 0, 0, 1, 0, 0)
    this.ctx.scale(dpr, dpr)
    // Invalidate mask on resize
    this.splatMask = null
  }
  
  setSourceCanvas(canvas: HTMLCanvasElement | null): void {
    this.sourceCanvas = canvas
    this.splatMask = null // Invalidate mask
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
      
      // Downsample for performance
      const maskW = Math.floor(sourceW / this.MASK_DOWNSAMPLE)
      const maskH = Math.floor(sourceH / this.MASK_DOWNSAMPLE)
      
      // Sample downsampled region
      const sampleW = Math.min(maskW * this.MASK_DOWNSAMPLE, sourceW)
      const sampleH = Math.min(maskH * this.MASK_DOWNSAMPLE, sourceH)
      
      const imageData = ctx.getImageData(0, 0, sampleW, sampleH)
      const data = imageData.data
      
      // Build binary mask (threshold on alpha/brightness)
      const maskData = new Uint8Array(maskW * maskH)
      const ALPHA_THRESHOLD = 20
      const BRIGHTNESS_THRESHOLD = 10
      
      for (let my = 0; my < maskH; my++) {
        for (let mx = 0; mx < maskW; mx++) {
          const sx = mx * this.MASK_DOWNSAMPLE
          const sy = my * this.MASK_DOWNSAMPLE
          const si = (sy * sampleW + sx) << 2
          
          const r = data[si]
          const g = data[si + 1]
          const b = data[si + 2]
          const a = data[si + 3]
          
          // Check if pixel is part of splat (has alpha or brightness)
          const brightness = (r + g + b) / 3
          const isSplat = a > ALPHA_THRESHOLD || brightness > BRIGHTNESS_THRESHOLD
          
          maskData[my * maskW + mx] = isSplat ? 1 : 0
        }
      }
      
      this.splatMask = {
        data: maskData,
        width: maskW,
        height: maskH,
        scale: this.MASK_DOWNSAMPLE,
      }
      
      this.lastMaskUpdate = now
      return this.splatMask
    } catch {
      return null
    }
  }
  
  /**
   * Check if a screen position hits the splat mask.
   */
  private checkImpact(x: number, y: number): boolean {
    if (!this.splatMask) return false
    
    const W = window.innerWidth
    const H = window.innerHeight
    
    // Convert screen coords to mask coords
    const maskX = Math.floor((x / W) * this.splatMask.width)
    const maskY = Math.floor((y / H) * this.splatMask.height)
    
    if (maskX < 0 || maskX >= this.splatMask.width || maskY < 0 || maskY >= this.splatMask.height) {
      return false
    }
    
    // Check mask (with small radius for tolerance)
    const radius = 1
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
   */
  private sampleSplatColor(x: number, y: number): { r: number; g: number; b: number } {
    if (!this.sourceCanvas) return { r: 255, g: 255, b: 255 }
    
    try {
      const ctx = this.sourceCanvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return { r: 255, g: 255, b: 255 }
      
      const W = window.innerWidth
      const H = window.innerHeight
      const canvasX = Math.floor((x / W) * this.sourceCanvas.width)
      const canvasY = Math.floor((y / H) * this.sourceCanvas.height)
      
      const imageData = ctx.getImageData(canvasX, canvasY, 1, 1)
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
      
      // Check impact
      if (mask && this.checkImpact(projected.screenX, projected.screenY)) {
        // Impact detected!
        droplet.hasImpacted = true
        droplet.impactX = projected.screenX
        droplet.impactY = projected.screenY
        droplet.impactTime = now
        
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
  
  private animate = (): void => {
    if (!this.isActive || !this.config.enabled || !this.ctx || !this.canvas) {
      return
    }
    
    const deltaTime = 16.67 // ~60fps
    
    // Clear canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    
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
    
    if (DEBUG_RAIN_ONTO_SPLAT) {
      this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
      this.ctx.fillRect(10, 10, 250, 100)
      this.ctx.fillStyle = '#fff'
      this.ctx.font = '12px monospace'
      this.ctx.fillText(`Droplets: ${this.droplets.length}`, 15, 30)
      this.ctx.fillText(`Streaks: ${this.impactStreaks.length}`, 15, 50)
      this.ctx.fillText(`Mask: ${this.splatMask ? 'OK' : 'NULL'}`, 15, 70)
      this.ctx.fillText(`Intensity: ${this.config.intensity.toFixed(2)}`, 15, 90)
    }
    
    this.rafId = requestAnimationFrame(this.animate)
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
