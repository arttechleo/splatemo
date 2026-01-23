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
  private readonly PULSE_INTERVAL_MIN = 15000 // 15 seconds minimum
  private readonly PULSE_INTERVAL_MAX = 45000 // 45 seconds maximum
  private nextPulseTime = 0
  
  constructor(overlay: SplatTransitionOverlay, governor: EffectGovernor) {
    this.overlay = overlay
    this.governor = governor
    this.scheduleNextPulse()
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
      intensity: 0.7,
      startTime: this.slowTimeStartTime,
      duration: 3000, // 3 seconds
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
  checkRarePulse(): void {
    const now = performance.now()
    
    if (now >= this.nextPulseTime && !this.slowTimeActive) {
      this.triggerRarePulse()
      this.scheduleNextPulse()
    }
  }
  
  private scheduleNextPulse(): void {
    const interval = this.PULSE_INTERVAL_MIN + 
      Math.random() * (this.PULSE_INTERVAL_MAX - this.PULSE_INTERVAL_MIN)
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
      intensity: 0.5,
      startTime: performance.now(),
      duration: pulseDuration,
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
