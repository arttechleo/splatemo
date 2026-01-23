/**
 * Lens Rain Effect
 * Rain droplets falling on a glass pane in front of the Gaussian splat.
 * Camera-perspective parallax for realistic glass pane feel.
 */

import * as THREE from 'three'

export const DEBUG_LENS_RAIN = false

type Droplet = {
  x: number
  y: number
  vx: number // Horizontal velocity (drift)
  vy: number // Vertical velocity (gravity)
  size: number // Base size
  age: number // Age in ms
  lifetime: number // Total lifetime in ms
  trail: Array<{ x: number; y: number; age: number }> // Trail points
  highlightX: number // Highlight offset X (for light catch)
  highlightY: number // Highlight offset Y
  tintR: number // Sampled tint from splat (optional)
  tintG: number
  tintB: number
  hasTint: boolean
}

export interface LensRainConfig {
  intensity: number // 0-1: spawn rate + visibility
  decay: number // 0-1: trail + droplet lifetime
  wind: number // 0-1: horizontal drift
  enabled: boolean
}

export class LensRain {
  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private rafId: number | null = null
  private isActive = false
  private config: LensRainConfig = {
    intensity: 0.7,
    decay: 0.6,
    wind: 0.3,
    enabled: false,
  }
  
  private droplets: Droplet[] = []
  private sourceCanvas: HTMLCanvasElement | null = null
  private camera: THREE.PerspectiveCamera | null = null
  private controls: { target?: THREE.Vector3; getAzimuthalAngle?: () => number } | null = null
  
  // Camera parallax tracking
  private lastCameraYaw = 0
  private currentParallaxX = 0
  private smoothedParallaxX = 0
  
  // Spawn timing
  private lastSpawnTime = 0
  private spawnInterval = 200 // Base spawn interval (ms)
  
  // Performance caps
  private readonly MAX_DROPLETS = 80
  private readonly MAX_TRAIL_POINTS = 12
  
  // Physics constants
  private readonly GRAVITY = 0.15
  private readonly BASE_FALL_SPEED = 1.2
  private readonly WIND_STRENGTH = 0.08
  private readonly PARALLAX_SCALE = 0.12
  
  // Visual constants
  private readonly BASE_SIZE = 2.5
  private readonly SIZE_VARIANCE = 1.5
  private readonly HIGHLIGHT_SIZE = 0.4
  
  constructor() {
    this.initCanvas()
  }
  
  private initCanvas(): void {
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'lens-rain-overlay'
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
  }
  
  setSourceCanvas(canvas: HTMLCanvasElement | null): void {
    this.sourceCanvas = canvas
  }
  
  setCamera(camera: THREE.PerspectiveCamera | null, controls: { target?: THREE.Vector3; getAzimuthalAngle?: () => number } | null): void {
    this.camera = camera
    this.controls = controls
  }
  
  setConfig(config: Partial<LensRainConfig>): void {
    this.config = { ...this.config, ...config }
    if (!this.config.enabled) {
      this.stop()
    } else {
      this.start()
    }
  }
  
  getConfig(): LensRainConfig {
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
    // Clear droplets on stop
    this.droplets = []
    if (this.ctx && this.canvas) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    }
  }
  
  private updateCameraParallax(): void {
    if (!this.controls || !this.camera) {
      this.currentParallaxX = 0
      this.smoothedParallaxX = 0
      return
    }
    
    // Get camera yaw (azimuthal angle) from controls
    let currentYaw = 0
    if (typeof this.controls.getAzimuthalAngle === 'function') {
      currentYaw = this.controls.getAzimuthalAngle()
    } else {
      // Fallback: estimate from camera position relative to target
      if (this.controls.target) {
        const target = this.controls.target
        const cameraPos = this.camera.position
        const direction = new THREE.Vector3().subVectors(cameraPos, target).normalize()
        currentYaw = Math.atan2(direction.x, direction.z)
      }
    }
    
    // Calculate yaw delta for parallax
    const yawDelta = currentYaw - this.lastCameraYaw
    this.lastCameraYaw = currentYaw
    
    // Apply parallax (smoothed)
    this.currentParallaxX += yawDelta * this.PARALLAX_SCALE
    this.smoothedParallaxX += (this.currentParallaxX - this.smoothedParallaxX) * 0.15
    
    // Decay parallax over time (return to center)
    this.currentParallaxX *= 0.98
  }
  
  private spawnDroplet(): void {
    if (this.droplets.length >= this.MAX_DROPLETS) return
    
    const W = window.innerWidth
    const H = window.innerHeight
    
    // Spawn near top with horizontal variance
    const x = (Math.random() * 0.8 + 0.1) * W + this.smoothedParallaxX * W * 0.1
    const y = -10 - Math.random() * 20 // Start above viewport
    
    // Size variation
    const size = this.BASE_SIZE + Math.random() * this.SIZE_VARIANCE
    
    // Initial velocities
    const baseFallSpeed = this.BASE_FALL_SPEED + Math.random() * 0.4
    const windDrift = (Math.random() - 0.5) * this.WIND_STRENGTH * (0.5 + this.config.wind * 0.5)
    
    // Lifetime based on decay setting (2-6 seconds)
    const minLifetime = 2000
    const maxLifetime = 6000
    const lifetime = minLifetime + (maxLifetime - minLifetime) * (0.3 + this.config.decay * 0.7)
    
    // Highlight position (for light catch)
    const highlightX = size * (0.2 + Math.random() * 0.1)
    const highlightY = -size * (0.2 + Math.random() * 0.1)
    
    // Sample splat color for tinting (optional, low frequency)
    let tintR = 255
    let tintG = 255
    let tintB = 255
    let hasTint = false
    
    if (this.sourceCanvas && Math.random() < 0.15) {
      // Sample color from splat behind droplet position
      try {
        const ctx = this.sourceCanvas.getContext('2d', { willReadFrequently: true })
        if (ctx) {
          const canvasX = Math.floor((x / W) * this.sourceCanvas.width)
          const canvasY = Math.floor((y / H) * this.sourceCanvas.height)
          const imageData = ctx.getImageData(canvasX, canvasY, 1, 1)
          const data = imageData.data
          if (data[3] > 10) {
            // Only use if pixel is visible
            tintR = data[0]
            tintG = data[1]
            tintB = data[2]
            hasTint = true
          }
        }
      } catch {
        // Sampling failed, use default
      }
    }
    
    const droplet: Droplet = {
      x,
      y,
      vx: windDrift,
      vy: baseFallSpeed,
      size,
      age: 0,
      lifetime,
      trail: [],
      highlightX,
      highlightY,
      tintR,
      tintG,
      tintB,
      hasTint,
    }
    
    this.droplets.push(droplet)
  }
  
  private updateDroplets(deltaTime: number): void {
    const W = window.innerWidth
    const H = window.innerHeight
    
    // Update camera parallax
    this.updateCameraParallax()
    
    // Spawn new droplets based on intensity
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
      
      // Remove if expired
      if (droplet.age >= droplet.lifetime) {
        continue
      }
      
      // Apply gravity
      droplet.vy += this.GRAVITY * (deltaTime / 16.67)
      
      // Apply wind drift
      const windFactor = 0.5 + this.config.wind * 0.5
      droplet.vx += (Math.random() - 0.5) * this.WIND_STRENGTH * windFactor * 0.1
      droplet.vx *= 0.99 // Slight damping
      
      // Update position
      droplet.x += droplet.vx * (deltaTime / 16.67)
      droplet.y += droplet.vy * (deltaTime / 16.67)
      
      // Add to trail (for streaking effect)
      droplet.trail.push({
        x: droplet.x,
        y: droplet.y,
        age: 0,
      })
      
      // Limit trail length
      if (droplet.trail.length > this.MAX_TRAIL_POINTS) {
        droplet.trail.shift()
      }
      
      // Age trail points
      for (const trailPoint of droplet.trail) {
        trailPoint.age += deltaTime
      }
      
      // Remove old trail points
      droplet.trail = droplet.trail.filter((p) => p.age < 800) // Keep trail for 800ms
      
      // Apply parallax offset
      const parallaxOffsetX = this.smoothedParallaxX * W * 0.15
      droplet.x += parallaxOffsetX * 0.02 // Subtle parallax response
      
      // Keep in bounds (wrap horizontally, remove if too far below)
      if (droplet.x < -50) droplet.x = W + 50
      if (droplet.x > W + 50) droplet.x = -50
      
      if (droplet.y > H + 100) {
        // Remove if too far below
        continue
      }
      
      activeDroplets.push(droplet)
    }
    
    this.droplets = activeDroplets
  }
  
  private drawDroplet(droplet: Droplet): void {
    if (!this.ctx) return
    
    // Calculate alpha based on age and decay
    const ageRatio = droplet.age / droplet.lifetime
    const decayFactor = 0.3 + this.config.decay * 0.7
    const alpha = (1 - ageRatio * decayFactor) * (0.7 + this.config.intensity * 0.3)
    
    if (alpha < 0.01) return
    
    // Draw trail (streaking effect)
    if (droplet.trail.length > 1) {
      this.ctx.save()
      this.ctx.globalAlpha = alpha * 0.4
      this.ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.3})`
      this.ctx.lineWidth = droplet.size * 0.3
      this.ctx.lineCap = 'round'
      this.ctx.lineJoin = 'round'
      
      this.ctx.beginPath()
      for (let i = 0; i < droplet.trail.length; i++) {
        const point = droplet.trail[i]
        const x = point.x
        const y = point.y
        
        if (i === 0) {
          this.ctx.moveTo(x, y)
        } else {
          this.ctx.lineTo(x, y)
        }
      }
      this.ctx.stroke()
      this.ctx.restore()
    }
    
    // Draw droplet shadow/outline (for visibility on bright splats)
    this.ctx.save()
    this.ctx.globalAlpha = alpha * 0.5
    this.ctx.fillStyle = `rgba(0, 0, 0, ${alpha * 0.4})`
    this.ctx.beginPath()
    this.ctx.arc(droplet.x, droplet.y, droplet.size * 1.15, 0, Math.PI * 2)
    this.ctx.fill()
    this.ctx.restore()
    
    // Draw main droplet body
    this.ctx.save()
    this.ctx.globalAlpha = alpha
    
    // Use tint if available, otherwise white/light blue
    if (droplet.hasTint) {
      // Brighten tint for visibility
      const brighten = 1.3
      this.ctx.fillStyle = `rgba(${Math.min(255, droplet.tintR * brighten)}, ${Math.min(255, droplet.tintG * brighten)}, ${Math.min(255, droplet.tintB * brighten)}, ${alpha})`
    } else {
      this.ctx.fillStyle = `rgba(200, 220, 255, ${alpha * 0.9})`
    }
    
    this.ctx.beginPath()
    this.ctx.arc(droplet.x, droplet.y, droplet.size, 0, Math.PI * 2)
    this.ctx.fill()
    this.ctx.restore()
    
    // Draw highlight (light catch)
    this.ctx.save()
    this.ctx.globalAlpha = alpha * 0.8
    const highlightGradient = this.ctx.createRadialGradient(
      droplet.x + droplet.highlightX,
      droplet.y + droplet.highlightY,
      0,
      droplet.x + droplet.highlightX,
      droplet.y + droplet.highlightY,
      droplet.size * this.HIGHLIGHT_SIZE
    )
    highlightGradient.addColorStop(0, `rgba(255, 255, 255, ${alpha * 0.9})`)
    highlightGradient.addColorStop(1, `rgba(255, 255, 255, 0)`)
    this.ctx.fillStyle = highlightGradient
    this.ctx.beginPath()
    this.ctx.arc(droplet.x + droplet.highlightX, droplet.y + droplet.highlightY, droplet.size * this.HIGHLIGHT_SIZE, 0, Math.PI * 2)
    this.ctx.fill()
    this.ctx.restore()
    
    // Draw subtle outline for definition
    this.ctx.save()
    this.ctx.globalAlpha = alpha * 0.6
    this.ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.3})`
    this.ctx.lineWidth = 0.5
    this.ctx.beginPath()
    this.ctx.arc(droplet.x, droplet.y, droplet.size, 0, Math.PI * 2)
    this.ctx.stroke()
    this.ctx.restore()
  }
  
  private animate = (): void => {
    if (!this.isActive || !this.config.enabled || !this.ctx || !this.canvas) {
      return
    }
    
    const deltaTime = 16.67 // ~60fps
    
    // Clear canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    
    // Update droplets
    this.updateDroplets(deltaTime)
    
    // Draw all droplets
    for (const droplet of this.droplets) {
      this.drawDroplet(droplet)
    }
    
    if (DEBUG_LENS_RAIN) {
      this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
      this.ctx.fillRect(10, 10, 200, 80)
      this.ctx.fillStyle = '#fff'
      this.ctx.font = '12px monospace'
      this.ctx.fillText(`Droplets: ${this.droplets.length}`, 15, 30)
      this.ctx.fillText(`Parallax: ${this.smoothedParallaxX.toFixed(4)}`, 15, 50)
      this.ctx.fillText(`Intensity: ${this.config.intensity.toFixed(2)}`, 15, 70)
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
  }
}
