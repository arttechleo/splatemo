/**
 * Performance Optimizer
 * Adaptive quality controller that monitors FPS and adjusts overlay/effects cost
 * when performance drops, without touching gaussian-splats-3d internals.
 */

export interface PerformanceConfig {
  targetFPS: number // Target FPS (e.g., 30 for mobile, 60 for desktop)
  lowFPSThreshold: number // FPS below this triggers quality reduction
  recoveryFPSThreshold: number // FPS above this allows quality ramp-up
  framesToTrigger: number // N frames below threshold before reducing quality
  framesToRecover: number // N frames above threshold before ramping up
  minQuality: number // Minimum quality multiplier (0-1)
  maxQuality: number // Maximum quality multiplier (0-1)
  rampUpSpeed: number // How fast to ramp quality back up (0-1 per frame)
  rampDownSpeed: number // How fast to reduce quality (0-1 per frame)
}

const DEFAULT_CONFIG: PerformanceConfig = {
  targetFPS: 30, // Mobile-friendly target
  lowFPSThreshold: 25, // Below 25 FPS = reduce quality
  recoveryFPSThreshold: 28, // Above 28 FPS = can ramp up
  framesToTrigger: 10, // 10 frames below threshold
  framesToRecover: 15, // 15 frames above threshold
  minQuality: 0.3, // Can reduce to 30% quality
  maxQuality: 1.0, // Full quality
  rampUpSpeed: 0.02, // 2% per frame
  rampDownSpeed: 0.05, // 5% per frame (faster reduction)
}

export interface QualitySettings {
  overlayUpdateRate: number // 0-1 (1 = every frame, 0.5 = every other frame)
  particleCountMultiplier: number // 0-1 (reduces particle counts)
  overlayResolutionMultiplier: number // 0-1 (reduces overlay DPR/resolution)
  maskRefreshRate: number // 0-1 (throttles expensive mask operations)
  samplingRate: number // 0-1 (throttles pixel sampling)
}

export class PerformanceOptimizer {
  private config: PerformanceConfig = { ...DEFAULT_CONFIG }
  private currentQuality: number = 1.0 // Current quality multiplier (0-1)
  private targetQuality: number = 1.0 // Target quality we're ramping to
  
  // Frame time tracking
  private frameTimes: number[] = []
  private readonly FRAME_TIME_HISTORY = 60 // Track last 60 frames
  private lastFrameTime = performance.now()
  private rafId: number | null = null
  
  // FPS state
  private lowFPSFrameCount = 0
  private highFPSFrameCount = 0
  
  // Quality settings
  private qualitySettings: QualitySettings = {
    overlayUpdateRate: 1.0,
    particleCountMultiplier: 1.0,
    overlayResolutionMultiplier: 1.0,
    maskRefreshRate: 1.0,
    samplingRate: 1.0,
  }
  
  // Callbacks for effects to register
  private qualityChangeCallbacks: Array<(settings: QualitySettings) => void> = []
  
  constructor(config?: Partial<PerformanceConfig>) {
    if (config) {
      this.config = { ...DEFAULT_CONFIG, ...config }
    }
    this.startMonitoring()
  }
  
  /**
   * Start FPS monitoring loop.
   */
  private startMonitoring(): void {
    const monitor = (now: number) => {
      const deltaTime = now - this.lastFrameTime
      this.lastFrameTime = now
      
      if (deltaTime > 0 && deltaTime < 1000) { // Sanity check: 0-1000ms
        // Calculate FPS from frame time
        const fps = 1000 / deltaTime
        
        // Track frame times
        this.frameTimes.push(deltaTime)
        if (this.frameTimes.length > this.FRAME_TIME_HISTORY) {
          this.frameTimes.shift()
        }
        
        // Calculate moving average FPS
        const avgFrameTime = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length
        const avgFPS = 1000 / avgFrameTime
        
        // Update quality based on FPS
        this.updateQuality(avgFPS)
      }
      
      this.rafId = requestAnimationFrame(monitor)
    }
    
    this.rafId = requestAnimationFrame(monitor)
  }
  
  /**
   * Update quality based on current FPS.
   */
  private updateQuality(fps: number): void {
    const wasLowFPS = fps < this.config.lowFPSThreshold
    const isHighFPS = fps >= this.config.recoveryFPSThreshold
    
    if (wasLowFPS) {
      this.lowFPSFrameCount++
      this.highFPSFrameCount = 0
      
      // Trigger quality reduction after N frames
      if (this.lowFPSFrameCount >= this.config.framesToTrigger) {
        this.targetQuality = Math.max(
          this.config.minQuality,
          this.currentQuality - this.config.rampDownSpeed
        )
      }
    } else if (isHighFPS) {
      this.highFPSFrameCount++
      this.lowFPSFrameCount = 0
      
      // Allow quality ramp-up after N frames
      if (this.highFPSFrameCount >= this.config.framesToRecover) {
        this.targetQuality = Math.min(
          this.config.maxQuality,
          this.currentQuality + this.config.rampUpSpeed
        )
      }
    } else {
      // FPS in middle range - maintain current quality
      this.lowFPSFrameCount = 0
      this.highFPSFrameCount = 0
    }
    
    // Smoothly interpolate to target quality
    const qualityDelta = this.targetQuality - this.currentQuality
    if (Math.abs(qualityDelta) > 0.001) {
      this.currentQuality += qualityDelta * 0.1 // Smooth interpolation
      this.currentQuality = Math.max(
        this.config.minQuality,
        Math.min(this.config.maxQuality, this.currentQuality)
      )
      
      // Update quality settings
      this.updateQualitySettings()
    }
  }
  
  /**
   * Update quality settings based on current quality multiplier.
   */
  private updateQualitySettings(): void {
    const q = this.currentQuality
    
    // Overlay update rate: reduce frame rate when quality drops
    // At 0.5 quality, update every other frame (0.5 rate)
    this.qualitySettings.overlayUpdateRate = Math.max(0.3, q)
    
    // Particle count: reduce particle counts proportionally
    this.qualitySettings.particleCountMultiplier = q
    
    // Overlay resolution: reduce DPR/resolution
    // At 0.5 quality, use 0.5x resolution
    this.qualitySettings.overlayResolutionMultiplier = Math.max(0.5, q)
    
    // Mask refresh rate: throttle expensive mask operations
    // At 0.5 quality, refresh every other frame
    this.qualitySettings.maskRefreshRate = Math.max(0.2, q)
    
    // Sampling rate: throttle pixel sampling
    // At 0.5 quality, sample every other frame
    this.qualitySettings.samplingRate = Math.max(0.3, q)
    
    // Notify registered callbacks
    for (const callback of this.qualityChangeCallbacks) {
      callback(this.qualitySettings)
    }
  }
  
  /**
   * Register a callback to be notified when quality settings change.
   */
  onQualityChange(callback: (settings: QualitySettings) => void): void {
    this.qualityChangeCallbacks.push(callback)
    // Immediately notify with current settings
    callback(this.qualitySettings)
  }
  
  /**
   * Get current quality settings.
   */
  getQualitySettings(): QualitySettings {
    return { ...this.qualitySettings }
  }
  
  /**
   * Get current quality multiplier (0-1).
   */
  getCurrentQuality(): number {
    return this.currentQuality
  }
  
  /**
   * Get current average FPS.
   */
  getCurrentFPS(): number {
    if (this.frameTimes.length === 0) return 60
    const avgFrameTime = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length
    return 1000 / avgFrameTime
  }
  
  /**
   * Pause monitoring (e.g., during transitions).
   */
  pause(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
  }
  
  /**
   * Resume monitoring.
   */
  resume(): void {
    if (!this.rafId) {
      this.lastFrameTime = performance.now()
      this.startMonitoring()
    }
  }
  
  /**
   * Stop monitoring and cleanup.
   */
  destroy(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    this.qualityChangeCallbacks = []
  }
}
