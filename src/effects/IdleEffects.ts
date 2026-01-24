/**
 * Idle Effects
 * Very subtle effects that activate when user is idle.
 * Phase 3: Breathing Presence only (shimmer disabled).
 */

import { EffectGovernor, type ActiveEffect } from './EffectGovernor'
import { SplatTransitionOverlay } from '../transitions/SplatTransitionOverlay'

export class IdleEffects {
  private overlay: SplatTransitionOverlay // Reserved for future particle effects
  private governor: EffectGovernor
  private rafId: number | null = null
  private isActive = false
  
  // Idle detection
  private lastInteractionTime = 0
  private readonly IDLE_THRESHOLD = 3000 // 3 seconds for subtle magic (Phase 3)
  private isIdle = false
  
  // Breathing effect
  private breathingPhase = 0
  private breathingSpeed = 0.002 // Slow for subtle presence
  private breathingBaseIntensity = 0.08 // Very subtle for Phase 3
  
  constructor(overlay: SplatTransitionOverlay, governor: EffectGovernor) {
    this.overlay = overlay // Reserved for future use
    void this.overlay // Suppress unused warning
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
  
  setSourceCanvas(_canvas: HTMLCanvasElement | null): void {
    // Source canvas not needed for breathing (overlay-only particle system)
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
  }
  
  private animate = (): void => {
    if (!this.isActive) return
    
    const now = performance.now()
    const timeSinceInteraction = now - this.lastInteractionTime
    
    // Check if idle
    const wasIdle = this.isIdle
    this.isIdle = timeSinceInteraction >= this.IDLE_THRESHOLD
    
    if (this.isIdle && !wasIdle) {
      // Just became idle, activate breathing
      this.activateBreathing()
    } else if (!this.isIdle && wasIdle) {
      // Just became active, deactivate effects
      this.deactivateBreathing()
    }
    
    // Update breathing phase
    if (this.isIdle) {
      this.breathingPhase += this.breathingSpeed
      
      // Update breathing intensity (very subtle for Phase 3)
      const breathingIntensity = this.breathingBaseIntensity + Math.sin(this.breathingPhase) * 0.02 // 0.06-0.10 range
      this.governor.updateIntensity('idle-breathing', breathingIntensity)
    }
    
    this.rafId = requestAnimationFrame(this.animate)
  }
  
  private activateBreathing(): void {
    const effect: ActiveEffect = {
      id: 'idle-breathing',
      type: 'secondary',
      priority: 'idle',
      intensity: this.breathingBaseIntensity,
      startTime: performance.now(),
      userTriggered: false,
    }
    this.governor.registerEffect(effect)
  }
  
  private deactivateBreathing(): void {
    this.governor.unregisterEffect('idle-breathing')
  }
  
  destroy(): void {
    this.stop()
  }
}
