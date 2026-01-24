/**
 * Splat Focus
 * Tap = focus: gently recenters splat and boosts clarity briefly.
 * Overlay-only effect that enhances visibility without modifying rendering.
 */

import { SplatTransitionOverlay } from '../transitions/SplatTransitionOverlay'

export class SplatFocus {
  private overlay: SplatTransitionOverlay
  private sourceCanvas: HTMLCanvasElement | null = null
  private isActive = false
  private focusStartTime = 0
  private readonly FOCUS_DURATION = 800 // ms
  private focusRafId: number | null = null
  
  constructor(overlay: SplatTransitionOverlay) {
    this.overlay = overlay
  }
  
  setSourceCanvas(canvas: HTMLCanvasElement | null): void {
    this.sourceCanvas = canvas
  }
  
  /**
   * Trigger focus effect: recenter + clarity boost.
   */
  trigger(): void {
    if (this.isActive) return // Don't interrupt active focus
    
    this.isActive = true
    this.focusStartTime = performance.now()
    
    // Start animation loop
    if (this.focusRafId) {
      cancelAnimationFrame(this.focusRafId)
    }
    this.animate()
  }
  
  private animate = (): void => {
    if (!this.isActive || !this.sourceCanvas) {
      this.isActive = false
      return
    }
    
    const now = performance.now()
    const elapsed = now - this.focusStartTime
    const progress = Math.min(1, elapsed / this.FOCUS_DURATION)
    
    // Clarity boost: subtle particle pulse at center
    if (progress < 0.5) {
      // First half: clarity boost (particle pulse)
      const intensity = (1 - progress * 2) * 0.3 // Fade from 0.3 to 0
      const H = window.innerHeight
      
      this.overlay.startAudioPulse({
        bandCenterY: H / 2,
        bandHeight: H * 0.3,
        direction: 'up',
        intensity,
        durationMs: 100,
        sourceCanvas: this.sourceCanvas,
        intensityMultiplier: 1.2,
      })
    }
    
    if (progress >= 1) {
      this.isActive = false
      return
    }
    
    this.focusRafId = requestAnimationFrame(this.animate)
  }
  
  /**
   * Cancel focus effect.
   */
  cancel(): void {
    this.isActive = false
    if (this.focusRafId) {
      cancelAnimationFrame(this.focusRafId)
      this.focusRafId = null
    }
  }
  
  destroy(): void {
    this.cancel()
  }
}
