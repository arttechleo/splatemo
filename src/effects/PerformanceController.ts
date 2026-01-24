/**
 * Performance Controller
 * Enhanced performance optimizer with quality tiers (HIGH/MED/LOW) and Effect LOD.
 * Tracks moving average of frame time and adjusts quality tiers accordingly.
 * Quality ramps down quickly under load and ramps up slowly when stable.
 */

import type { QualityTier } from './OverlayCompositor'

export interface PerformanceControllerConfig {
  targetFPS: number // Target FPS (e.g., 30 for mobile, 60 for desktop)
  lowFPSThreshold: number // FPS below this triggers quality reduction
  recoveryFPSThreshold: number // FPS above this allows quality ramp-up
  framesToTrigger: number // N frames below threshold before reducing quality
  framesToRecover: number // N frames above threshold before ramping up
  rampUpDelay: number // Additional frames to wait before ramping up (conservative)
}

const DEFAULT_CONFIG: PerformanceControllerConfig = {
  targetFPS: 30, // Mobile-friendly target
  lowFPSThreshold: 25, // Below 25 FPS = reduce quality
  recoveryFPSThreshold: 28, // Above 28 FPS = can ramp up
  framesToTrigger: 8, // 8 frames below threshold (quick ramp down)
  framesToRecover: 30, // 30 frames above threshold (slow ramp up)
  rampUpDelay: 10, // Additional 10 frames before ramping up (conservative)
}

export class PerformanceController {
  private config: PerformanceControllerConfig = { ...DEFAULT_CONFIG }
  private currentTier: QualityTier = 'HIGH'
  private targetTier: QualityTier = 'HIGH'
  
  // Frame time tracking
  private frameTimes: number[] = []
  private readonly FRAME_TIME_HISTORY = 60 // Track last 60 frames
  private lastFrameTime = performance.now()
  private rafId: number | null = null
  
  // FPS state
  private lowFPSFrameCount = 0
  private highFPSFrameCount = 0
  private rampUpDelayCount = 0
  
  // Callbacks
  private tierChangeCallbacks: Array<(tier: QualityTier) => void> = []
  
  constructor(config?: Partial<PerformanceControllerConfig>) {
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
        // Track frame times
        this.frameTimes.push(deltaTime)
        if (this.frameTimes.length > this.FRAME_TIME_HISTORY) {
          this.frameTimes.shift()
        }
        
        // Calculate moving average FPS
        const avgFrameTime = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length
        const avgFPS = 1000 / avgFrameTime
        
        // Update quality tier based on FPS
        this.updateQualityTier(avgFPS)
      }
      
      this.rafId = requestAnimationFrame(monitor)
    }
    
    this.rafId = requestAnimationFrame(monitor)
  }
  
  /**
   * Update quality tier based on current FPS.
   * Quality ramps down quickly under load and ramps up slowly when stable.
   */
  private updateQualityTier(fps: number): void {
    const wasLowFPS = fps < this.config.lowFPSThreshold
    const isHighFPS = fps >= this.config.recoveryFPSThreshold
    
    if (wasLowFPS) {
      this.lowFPSFrameCount++
      this.highFPSFrameCount = 0
      this.rampUpDelayCount = 0
      
      // Quick ramp down: reduce tier after N frames
      if (this.lowFPSFrameCount >= this.config.framesToTrigger) {
        if (this.currentTier === 'HIGH') {
          this.targetTier = 'MED'
        } else if (this.currentTier === 'MED') {
          this.targetTier = 'LOW'
        }
        // LOW is already lowest, stay there
      }
    } else if (isHighFPS) {
      this.highFPSFrameCount++
      this.lowFPSFrameCount = 0
      
      // Slow ramp up: wait for recovery + delay before increasing tier
      if (this.highFPSFrameCount >= this.config.framesToRecover) {
        this.rampUpDelayCount++
        
        // Additional delay before ramping up (conservative)
        if (this.rampUpDelayCount >= this.config.rampUpDelay) {
          if (this.currentTier === 'LOW') {
            this.targetTier = 'MED'
          } else if (this.currentTier === 'MED') {
            this.targetTier = 'HIGH'
          }
          // HIGH is already highest, stay there
        }
      }
    } else {
      // FPS in middle range - maintain current tier
      this.lowFPSFrameCount = 0
      this.highFPSFrameCount = 0
      this.rampUpDelayCount = 0
    }
    
    // Apply tier change immediately (no interpolation for tiers)
    if (this.currentTier !== this.targetTier) {
      this.currentTier = this.targetTier
      this.notifyTierChange()
    }
  }
  
  /**
   * Notify callbacks of tier change.
   */
  private notifyTierChange(): void {
    for (const callback of this.tierChangeCallbacks) {
      callback(this.currentTier)
    }
  }
  
  /**
   * Register a callback to be notified when quality tier changes.
   */
  onTierChange(callback: (tier: QualityTier) => void): void {
    this.tierChangeCallbacks.push(callback)
    // Immediately notify with current tier
    callback(this.currentTier)
  }
  
  /**
   * Get current quality tier.
   */
  getCurrentTier(): QualityTier {
    return this.currentTier
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
   * Get average frame time (ms).
   */
  getAverageFrameTime(): number {
    if (this.frameTimes.length === 0) return 16.67
    return this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length
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
    this.tierChangeCallbacks = []
  }
}
