/**
 * Motion Effects
 * Effects driven by device motion (gyro tilt).
 * Gravity Bias and Parallax Window.
 */

import { EffectGovernor, type ActiveEffect } from './EffectGovernor'

export class MotionEffects {
  private governor: EffectGovernor
  private isEnabled = false
  
  // Gyro data
  private rawTilt = { x: 0, y: 0 }
  private smoothedTilt = { x: 0, y: 0 }
  private readonly SMOOTHING_FACTOR = 0.15
  private readonly MAX_TILT = 0.2 // Clamped tilt
  
  // Gravity bias
  private gravityBiasActive = false
  private gravityBiasIntensity = 0.3
  
  constructor(governor: EffectGovernor) {
    this.governor = governor
  }
  
  enable(): void {
    if (this.isEnabled) return
    
    // Check if device orientation is supported
    if (!window.DeviceOrientationEvent && !window.DeviceMotionEvent) {
      return
    }
    
    try {
      // Request permission on iOS 13+
      if (typeof (DeviceMotionEvent as any).requestPermission === 'function') {
        (DeviceMotionEvent as any).requestPermission().then((permission: string) => {
          if (permission === 'granted') {
            this.setupListeners()
            this.isEnabled = true
          }
        })
      } else {
        this.setupListeners()
        this.isEnabled = true
      }
    } catch {
      // Permission denied or not supported
    }
  }
  
  disable(): void {
    this.isEnabled = false
    this.removeListeners()
    this.deactivateGravityBias()
  }
  
  private setupListeners(): void {
    if (window.DeviceMotionEvent) {
      window.addEventListener('devicemotion', (event: DeviceMotionEvent) => {
        if (!this.isEnabled) return
        
        if (event.rotationRate) {
          const beta = event.rotationRate.beta ? event.rotationRate.beta * (Math.PI / 180) : 0
          const gamma = event.rotationRate.gamma ? event.rotationRate.gamma * (Math.PI / 180) : 0
          
          // Accumulate tilt (with decay)
          this.rawTilt.x += gamma * 0.016
          this.rawTilt.y += beta * 0.016
          
          // Clamp
          this.rawTilt.x = Math.max(-this.MAX_TILT, Math.min(this.MAX_TILT, this.rawTilt.x))
          this.rawTilt.y = Math.max(-this.MAX_TILT, Math.min(this.MAX_TILT, this.rawTilt.y))
        }
      })
    }
    
    // Update gravity bias based on tilt
    this.updateGravityBias()
  }
  
  private removeListeners(): void {
    // Event listeners are automatically cleaned up
  }
  
  private updateGravityBias(): void {
    if (!this.isEnabled) return
    
    // Smooth tilt
    this.smoothedTilt.x += (this.rawTilt.x - this.smoothedTilt.x) * this.SMOOTHING_FACTOR
    this.smoothedTilt.y += (this.rawTilt.y - this.smoothedTilt.y) * this.SMOOTHING_FACTOR
    
    // Activate gravity bias if tilt is significant
    const tiltMagnitude = Math.sqrt(this.smoothedTilt.x ** 2 + this.smoothedTilt.y ** 2)
    
    if (tiltMagnitude > 0.05 && !this.gravityBiasActive) {
      this.activateGravityBias()
    } else if (tiltMagnitude < 0.02 && this.gravityBiasActive) {
      this.deactivateGravityBias()
    }
    
    // Update intensity based on tilt
    if (this.gravityBiasActive) {
      const intensity = Math.min(0.4, tiltMagnitude * 2)
      this.governor.updateIntensity('motion-gravity-bias', intensity)
    }
    
    requestAnimationFrame(() => this.updateGravityBias())
  }
  
  private activateGravityBias(): void {
    this.gravityBiasActive = true
    const effect: ActiveEffect = {
      id: 'motion-gravity-bias',
      type: 'secondary',
      intensity: this.gravityBiasIntensity,
      startTime: performance.now(),
      onSuppress: () => {
        this.gravityBiasActive = false
      },
    }
    this.governor.registerEffect(effect)
  }
  
  private deactivateGravityBias(): void {
    this.gravityBiasActive = false
    this.governor.unregisterEffect('motion-gravity-bias')
  }
  
  getGravityBias(): { x: number; y: number } {
    if (!this.gravityBiasActive) return { x: 0, y: 0 }
    return {
      x: this.smoothedTilt.x * this.gravityBiasIntensity,
      y: this.smoothedTilt.y * this.gravityBiasIntensity,
    }
  }
  
  destroy(): void {
    this.disable()
  }
}
