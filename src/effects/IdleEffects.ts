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
  private readonly IDLE_THRESHOLD = 3000 // 3 seconds of inactivity
  private isIdle = false
  
  // Breathing effect
  private breathingPhase = 0
  private breathingSpeed = 0.002 // Slow expansion/contraction
  
  // Attention shimmer
  private shimmerPhase = 0
  private shimmerSpeed = 0.003
  
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
      
      // Update breathing intensity
      const breathingIntensity = 0.15 + Math.sin(this.breathingPhase) * 0.05 // 0.1-0.2
      this.governor.updateIntensity('idle-breathing', breathingIntensity)
      
      // Update shimmer (subtle highlight at center)
      this.updateShimmer()
    }
    
    this.rafId = requestAnimationFrame(this.animate)
  }
  
  private activateBreathing(): void {
    const effect: ActiveEffect = {
      id: 'idle-breathing',
      type: 'secondary',
      intensity: 0.15,
      startTime: performance.now(),
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
      intensity: 0.1,
      startTime: performance.now(),
    }
    this.governor.registerEffect(effect)
  }
  
  private deactivateShimmer(): void {
    this.governor.unregisterEffect('idle-shimmer')
  }
  
  private updateShimmer(): void {
    if (!this.sourceCanvas || !this.governor.isActive('idle-shimmer')) return
    
    // Subtle highlight bias toward view center (very low frequency)
    if (Math.random() < 0.02) { // 2% chance per frame
      const H = window.innerHeight
      const centerY = H / 2
      const bandHeight = H * 0.15
      
      this.overlay.startAudioPulse({
        bandCenterY: centerY,
        bandHeight,
        direction: 'down',
        intensity: 0.15,
        durationMs: 400,
        sourceCanvas: this.sourceCanvas,
        intensityMultiplier: 0.6, // Very subtle
      })
    }
  }
  
  destroy(): void {
    this.stop()
  }
}
