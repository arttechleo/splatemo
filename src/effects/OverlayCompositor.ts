/**
 * Overlay Compositor
 * Single compositor that consolidates all non-WebGL effect rendering
 * through one overlay canvas and one requestAnimationFrame loop.
 * Reduces duplicate RAF loops and extra full-screen canvas clears.
 */

export type QualityTier = 'HIGH' | 'MED' | 'LOW'

export interface CompositorConfig {
  qualityTier: QualityTier
  overlayDPR: number // Device pixel ratio cap (1.5 → 1.25 → 1.0)
  particleCountMultiplier: number // 0-1
  maskRefreshRate: number // 0-1 (throttles expensive mask operations)
  samplingRate: number // 0-1 (throttles pixel sampling)
  grainUpdateRate: number // FPS for grain updates (12-20fps)
  lightLeakUpdateRate: number // FPS for light leak updates (12-20fps)
  blurGlowIntensity: number // 0-1 (skip on LOW)
}

export interface EffectLayer {
  id: string
  enabled: boolean
  priority: number // Higher = renders first (background layers)
  render: (ctx: CanvasRenderingContext2D, now: number, config: CompositorConfig) => void
  needsUpdate: (now: number, lastUpdate: number, config: CompositorConfig) => boolean
}

const QUALITY_TIERS: Record<QualityTier, CompositorConfig> = {
  HIGH: {
    qualityTier: 'HIGH',
    overlayDPR: 1.5,
    particleCountMultiplier: 1.0,
    maskRefreshRate: 1.0,
    samplingRate: 1.0,
    grainUpdateRate: 20, // 20fps
    lightLeakUpdateRate: 20, // 20fps
    blurGlowIntensity: 1.0,
  },
  MED: {
    qualityTier: 'MED',
    overlayDPR: 1.25,
    particleCountMultiplier: 0.7,
    maskRefreshRate: 0.6,
    samplingRate: 0.7,
    grainUpdateRate: 15, // 15fps
    lightLeakUpdateRate: 15, // 15fps
    blurGlowIntensity: 0.6,
  },
  LOW: {
    qualityTier: 'LOW',
    overlayDPR: 1.0,
    particleCountMultiplier: 0.4,
    maskRefreshRate: 0.3,
    samplingRate: 0.4,
    grainUpdateRate: 12, // 12fps
    lightLeakUpdateRate: 12, // 12fps
    blurGlowIntensity: 0.0, // Skip blur/glow on LOW
  },
}

export class OverlayCompositor {
  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private container: HTMLElement
  private rafId: number | null = null
  private isActive = false
  private isPaused = false
  
  // Effect layers
  private layers: Map<string, EffectLayer> = new Map()
  private layerUpdateTimes: Map<string, number> = new Map()
  
  // Current config
  private config: CompositorConfig = { ...QUALITY_TIERS.HIGH }
  
  // Performance tracking
  private frameTimes: number[] = []
  private readonly FRAME_TIME_HISTORY = 60
  private lastFrameTime = performance.now()
  
  constructor(container: HTMLElement) {
    this.container = container
    this.createCanvas()
  }
  
  private createCanvas(): void {
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'overlay-compositor'
    this.canvas.style.position = 'fixed'
    this.canvas.style.top = '0'
    this.canvas.style.left = '0'
    this.canvas.style.width = '100%'
    this.canvas.style.height = '100%'
    this.canvas.style.pointerEvents = 'none'
    this.canvas.style.zIndex = '5' // Below UI, above WebGL
    this.canvas.style.opacity = '1'
    
    this.resize()
    this.container.appendChild(this.canvas)
    window.addEventListener('resize', () => this.resize())
  }
  
  private resize(): void {
    if (!this.canvas || !this.ctx) return
    
    const dpr = Math.min(this.config.overlayDPR, window.devicePixelRatio || 1)
    this.canvas.width = window.innerWidth * dpr
    this.canvas.height = window.innerHeight * dpr
    this.ctx.setTransform(1, 0, 0, 1, 0, 0)
    this.ctx.scale(dpr, dpr)
  }
  
  /**
   * Register an effect layer.
   */
  registerLayer(layer: EffectLayer): void {
    this.layers.set(layer.id, layer)
    this.layerUpdateTimes.set(layer.id, 0)
  }
  
  /**
   * Unregister an effect layer.
   */
  unregisterLayer(id: string): void {
    this.layers.delete(id)
    this.layerUpdateTimes.delete(id)
  }
  
  /**
   * Set quality tier (HIGH / MED / LOW).
   */
  setQualityTier(tier: QualityTier): void {
    this.config = { ...QUALITY_TIERS[tier] }
    this.resize() // Update DPR
  }
  
  /**
   * Get current config.
   */
  getConfig(): CompositorConfig {
    return { ...this.config }
  }
  
  /**
   * Start compositor animation loop.
   */
  start(): void {
    if (this.isActive) return
    this.isActive = true
    this.lastFrameTime = performance.now()
    this.animate()
  }
  
  /**
   * Stop compositor animation loop.
   */
  stop(): void {
    if (!this.isActive) return
    this.isActive = false
    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    if (this.ctx && this.canvas) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    }
  }
  
  /**
   * Pause compositor (e.g., during transitions).
   */
  pause(): void {
    this.isPaused = true
  }
  
  /**
   * Resume compositor.
   */
  resume(): void {
    this.isPaused = false
  }
  
  /**
   * Main animation loop - single RAF for all effects.
   */
  private animate = (): void => {
    if (!this.isActive || !this.ctx || !this.canvas) {
      this.rafId = null
      return
    }
    
    const now = performance.now()
    
    // Track frame time for performance monitoring
    const deltaTime = now - this.lastFrameTime
    this.lastFrameTime = now
    if (deltaTime > 0 && deltaTime < 1000) {
      this.frameTimes.push(deltaTime)
      if (this.frameTimes.length > this.FRAME_TIME_HISTORY) {
        this.frameTimes.shift()
      }
    }
    
    // Skip rendering if paused
    if (this.isPaused) {
      this.rafId = requestAnimationFrame(this.animate)
      return
    }
    
    // Single clear for entire compositor
    const W = window.innerWidth
    const H = window.innerHeight
    this.ctx.clearRect(0, 0, W, H)
    
    // Render all enabled layers in priority order (low priority = background, high = foreground)
    const sortedLayers = Array.from(this.layers.values())
      .filter(layer => layer.enabled)
      .sort((a, b) => a.priority - b.priority)
    
    for (const layer of sortedLayers) {
      const lastUpdate = this.layerUpdateTimes.get(layer.id) || 0
      
      // Check if layer needs update (throttling handled by layer.needsUpdate)
      if (layer.needsUpdate(now, lastUpdate, this.config)) {
        this.ctx.save()
        layer.render(this.ctx, now, this.config)
        this.ctx.restore()
        this.layerUpdateTimes.set(layer.id, now)
      }
    }
    
    this.rafId = requestAnimationFrame(this.animate)
  }
  
  /**
   * Get average frame time (ms).
   */
  getAverageFrameTime(): number {
    if (this.frameTimes.length === 0) return 16.67 // 60fps
    return this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length
  }
  
  /**
   * Get current FPS estimate.
   */
  getCurrentFPS(): number {
    const avgFrameTime = this.getAverageFrameTime()
    return 1000 / avgFrameTime
  }
  
  /**
   * Get active layer count.
   */
  getActiveLayerCount(): number {
    return Array.from(this.layers.values()).filter(l => l.enabled).length
  }
  
  /**
   * Destroy compositor.
   */
  destroy(): void {
    this.stop()
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas)
    }
    this.canvas = null
    this.ctx = null
    this.layers.clear()
    this.layerUpdateTimes.clear()
  }
}
