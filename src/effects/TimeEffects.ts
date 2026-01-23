/**
 * Time Effects
 * Effects that manipulate time perception.
 * Slow Time and Rare Pulse.
 */

import { EffectGovernor, type ActiveEffect } from './EffectGovernor'
import { SplatTransitionOverlay } from '../transitions/SplatTransitionOverlay'

export class TimeEffects {
  private overlay: SplatTransitionOverlay
  private sourceCanvas: HTMLCanvasElement | null = null
  private governor: EffectGovernor
  
  // Slow time
  private slowTimeActive = false
  private slowTimeFactor = 0.3 // 30% speed
  private slowTimeStartTime = 0
  
  // Rare pulse
  private readonly PULSE_INTERVAL_MIN = 15000 // 15 seconds minimum (normal mode)
  private readonly PULSE_INTERVAL_MAX = 45000 // 45 seconds maximum (normal mode)
  private readonly PULSE_INTERVAL_VIVID_MIN = 6000 // 6 seconds (vivid mode)
  private readonly PULSE_INTERVAL_VIVID_MAX = 12000 // 12 seconds (vivid mode)
  private nextPulseTime = 0
  private interactionCount = 0 // Count user interactions for discovery
  private readonly INTERACTIONS_FOR_PULSE = 3 // Trigger pulse after 3 interactions
  
  constructor(overlay: SplatTransitionOverlay, governor: EffectGovernor) {
    this.overlay = overlay
    this.governor = governor
    this.scheduleNextPulse(false) // Start in normal mode
  }
  
  setSourceCanvas(canvas: HTMLCanvasElement | null): void {
    this.sourceCanvas = canvas
  }
  
  /**
   * Activate slow time (extends particle trails, slows animations).
   */
  activateSlowTime(): void {
    if (this.slowTimeActive) return
    
    this.slowTimeActive = true
    this.slowTimeStartTime = performance.now()
    
    const effect: ActiveEffect = {
      id: 'time-slow',
      type: 'primary',
      priority: 'time',
      intensity: 0.7,
      startTime: this.slowTimeStartTime,
      duration: 3000, // 3 seconds
      userTriggered: true, // User explicitly triggered via long-press
      onSuppress: () => {
        this.slowTimeActive = false
      },
    }
    
    this.governor.registerEffect(effect)
    
    // Auto-deactivate after duration
    setTimeout(() => {
      this.deactivateSlowTime()
    }, effect.duration)
  }
  
  deactivateSlowTime(): void {
    this.slowTimeActive = false
    this.governor.unregisterEffect('time-slow')
  }
  
  /**
   * Get slow time factor (1.0 = normal, <1.0 = slowed).
   */
  getSlowTimeFactor(): number {
    return this.slowTimeActive ? this.slowTimeFactor : 1.0
  }
  
  /**
   * Check for rare pulse trigger.
   */
  checkRarePulse(vividMode: boolean = false): void {
    const now = performance.now()
    
    // In normal mode: trigger after 3 interactions
    if (!vividMode && this.interactionCount >= this.INTERACTIONS_FOR_PULSE && !this.slowTimeActive) {
      this.triggerRarePulse()
      this.interactionCount = 0
      this.scheduleNextPulse(vividMode)
      return
    }
    
    // In vivid mode or after initial pulse: time-based
    if (now >= this.nextPulseTime && !this.slowTimeActive) {
      this.triggerRarePulse()
      this.scheduleNextPulse(vividMode)
    }
  }
  
  /**
   * Record user interaction (for discovery pulse).
   */
  recordInteraction(): void {
    this.interactionCount++
  }
  
  private scheduleNextPulse(vividMode: boolean): void {
    const min = vividMode ? this.PULSE_INTERVAL_VIVID_MIN : this.PULSE_INTERVAL_MIN
    const max = vividMode ? this.PULSE_INTERVAL_VIVID_MAX : this.PULSE_INTERVAL_MAX
    const interval = min + Math.random() * (max - min)
    this.nextPulseTime = performance.now() + interval
  }
  
  private triggerRarePulse(): void {
    if (!this.sourceCanvas) return
    
    const H = window.innerHeight
    
    // Cinematic wave pulse across entire splat
    const waveSpeed = 0.008
    let wavePosition = 0
    
    const pulseDuration = 2000
    const startTime = performance.now()
    
    const animatePulse = () => {
      const elapsed = performance.now() - startTime
      if (elapsed >= pulseDuration) return
      
      wavePosition += waveSpeed
      if (wavePosition > 1) wavePosition = 0
      
      const bandCenterY = wavePosition * H
      const bandHeight = H * 0.2
      
      this.overlay.startAudioPulse({
        bandCenterY,
        bandHeight,
        direction: 'down',
        intensity: 0.6,
        durationMs: 800,
        sourceCanvas: this.sourceCanvas,
        intensityMultiplier: 1.2,
      })
      
      requestAnimationFrame(animatePulse)
    }
    
    animatePulse()
    
    // Register as secondary effect
    const effect: ActiveEffect = {
      id: 'time-rare-pulse',
      type: 'secondary',
      priority: 'time',
      intensity: 0.5,
      startTime: performance.now(),
      duration: pulseDuration,
      userTriggered: false,
    }
    this.governor.registerEffect(effect)
  }
  
  update(): void {
    // Check for rare pulse
    this.checkRarePulse()
    
    // Cleanup expired slow time
    if (this.slowTimeActive) {
      const elapsed = performance.now() - this.slowTimeStartTime
      if (elapsed > 3000) {
        this.deactivateSlowTime()
      }
    }
  }
  
  destroy(): void {
    this.deactivateSlowTime()
  }
}
