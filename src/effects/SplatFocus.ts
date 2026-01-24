/**
 * Splat Focus
 * Tap = focus: gently recenters splat and boosts clarity briefly.
 * Overlay-only effect that enhances visibility without modifying rendering.
 */

import { SplatTransitionOverlay } from '../transitions/SplatTransitionOverlay'

export class SplatFocus {
  private overlay: SplatTransitionOverlay // Reserved for future use
  private isActive = false
  private focusStartTime = 0
  private readonly FOCUS_DURATION = 800 // ms
  private focusRafId: number | null = null
  
  constructor(overlay: SplatTransitionOverlay) {
    this.overlay = overlay
  }
  
  setSourceCanvas(_canvas: HTMLCanvasElement | null): void {
    // Not used - clean demo uses CSS animations instead
    void this.overlay // Suppress unused warning
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
    if (!this.isActive) {
      return
    }
    
    const now = performance.now()
    const elapsed = now - this.focusStartTime
    const progress = Math.min(1, elapsed / this.FOCUS_DURATION)
    
    // Clean clarity boost: subtle scale settle (no particles)
    // Effect is handled via CSS transform on canvas element in main.ts
    
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
