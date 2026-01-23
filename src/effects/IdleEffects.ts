/**
 * Idle Effects
 * Very subtle effects that activate when user is idle.
 * Breathing Presence and Attention Shimmer.
 */

import { EffectGovernor, type ActiveEffect } from './EffectGovernor'
import { SplatTransitionOverlay } from '../transitions/SplatTransitionOverlay'

export class IdleEffects {
  private overlay: SplatTransitionOverlay
  private sourceCanvas: HTMLCanvasElement | null = null
  private governor: EffectGovernor
  private rafId: number | null = null
  private isActive = false
  
  // Idle detection
  private lastInteractionTime = 0
  private readonly IDLE_THRESHOLD = 1200 // 1.2 seconds of inactivity (reduced for visibility)
  private isIdle = false
  private normalMode = true // Track if in normal mode (reduced effects)
  
  // Breathing effect
  private breathingPhase = 0
  private breathingSpeed = 0.003 // Slightly faster for visibility
  private breathingBaseIntensity = 0.25 // Increased from 0.15
  private breathingNormalIntensity = 0.12 // Reduced intensity for normal mode
  
  // Attention shimmer
  private shimmerPhase = 0
  private shimmerSpeed = 0.005
  private shimmerLastUpdate = 0
  private readonly SHIMMER_INTERVAL = 200 // Update every 200ms (continuous)
  
  constructor(overlay: SplatTransitionOverlay, governor: EffectGovernor) {
    this.overlay = overlay
    this.governor = governor
    this.trackInteractions()
  }
  
  private trackInteractions(): void {
    // Track all user interactions
    const events = ['mousedown', 'touchstart', 'mousemove', 'touchmove', 'wheel', 'keydown']
    events.forEach(event => {
      document.addEventListener(event, () => {
        this.lastInteractionTime = performance.now()
        this.isIdle = false
      }, { passive: true })
    })
  }
  
  setSourceCanvas(canvas: HTMLCanvasElement | null): void {
    this.sourceCanvas = canvas
  }
  
  /**
   * Set normal mode (reduced effects for clean UI feel).
   */
  setNormalMode(enabled: boolean): void {
    this.normalMode = enabled
    // If in normal mode and effects are active, reduce intensity
    if (enabled && this.governor.isActive('idle-breathing')) {
      this.governor.updateIntensity('idle-breathing', this.breathingNormalIntensity)
    }
  }
  
  start(): void {
    if (this.isActive) return
    this.isActive = true
    this.lastInteractionTime = performance.now()
    this.animate()
  }
  
  stop(): void {
    this.isActive = false
    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    // Unregister effects
    this.governor.unregisterEffect('idle-breathing')
    this.governor.unregisterEffect('idle-shimmer')
  }
  
  private animate = (): void => {
    if (!this.isActive) return
    
    const now = performance.now()
    const timeSinceInteraction = now - this.lastInteractionTime
    
    // Check if idle
    const wasIdle = this.isIdle
    this.isIdle = timeSinceInteraction >= this.IDLE_THRESHOLD
    
    if (this.isIdle && !wasIdle) {
      // Just became idle, activate effects
      this.activateBreathing()
      this.activateShimmer()
    } else if (!this.isIdle && wasIdle) {
      // Just became active, deactivate effects
      this.deactivateBreathing()
      this.deactivateShimmer()
    }
    
    // Update breathing phase
    if (this.isIdle) {
      this.breathingPhase += this.breathingSpeed
      this.shimmerPhase += this.shimmerSpeed
      
      // Update breathing intensity (reduced in normal mode for clean UI)
      const baseIntensity = this.normalMode ? this.breathingNormalIntensity : this.breathingBaseIntensity
      const breathingIntensity = baseIntensity + Math.sin(this.breathingPhase) * (this.normalMode ? 0.03 : 0.1)
      this.governor.updateIntensity('idle-breathing', breathingIntensity)
      
      // Update shimmer (continuous, not random)
      this.updateShimmer(now)
    }
    
    this.rafId = requestAnimationFrame(this.animate)
  }
  
  private activateBreathing(): void {
    const initialIntensity = this.normalMode ? this.breathingNormalIntensity : this.breathingBaseIntensity
    const effect: ActiveEffect = {
      id: 'idle-breathing',
      type: 'secondary',
      priority: 'idle',
      intensity: initialIntensity,
      startTime: performance.now(),
      userTriggered: false,
    }
    this.governor.registerEffect(effect)
  }
  
  private deactivateBreathing(): void {
    this.governor.unregisterEffect('idle-breathing')
  }
  
  private activateShimmer(): void {
    const effect: ActiveEffect = {
      id: 'idle-shimmer',
      type: 'secondary',
      priority: 'idle',
      intensity: 0.15,
      startTime: performance.now(),
      userTriggered: false,
    }
    this.governor.registerEffect(effect)
  }
  
  private deactivateShimmer(): void {
    this.governor.unregisterEffect('idle-shimmer')
  }
  
  private updateShimmer(now: number): void {
    if (!this.sourceCanvas || !this.governor.isActive('idle-shimmer')) return
    
    // Continuous low-amplitude shimmer (reduced in normal mode)
    if (now - this.shimmerLastUpdate >= this.SHIMMER_INTERVAL) {
      this.shimmerLastUpdate = now
      
      // Skip shimmer in normal mode for clean UI feel
      if (this.normalMode) return
      
      const H = window.innerHeight
      const centerY = H / 2 + Math.sin(this.shimmerPhase) * (H * 0.05) // Subtle vertical movement
      const bandHeight = H * 0.12
      
      this.overlay.startAudioPulse({
        bandCenterY: centerY,
        bandHeight,
        direction: 'down',
        intensity: 0.2,
        durationMs: 500,
        sourceCanvas: this.sourceCanvas,
        intensityMultiplier: 0.7, // Visible but subtle
      })
    }
  }
  
  destroy(): void {
    this.stop()
  }
}
