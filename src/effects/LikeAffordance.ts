/**
 * Like Affordance
 * Double tap = like: visual feedback only (UI-only, no canvas particles/dots).
 * UI interactions must never spawn particles or dots. This is intentional for product polish.
 * No backend required - pure visual feedback.
 */

import { SplatTransitionOverlay } from '../transitions/SplatTransitionOverlay'

export class LikeAffordance {
  private overlay: SplatTransitionOverlay // Reserved for future use
  
  constructor(overlay: SplatTransitionOverlay) {
    this.overlay = overlay
    // UI interactions must never spawn particles or dots. This is intentional for product polish.
    // All visual feedback is handled via UI button animations (scale/opacity/glow) only.
  }
  
  setSourceCanvas(_canvas: HTMLCanvasElement | null): void {
    // Not used - like affordance is UI-only (no particles, no canvas drawing)
    void this.overlay // Suppress unused warning
  }
  
  /**
   * Trigger like affordance at tap location.
   * UI interactions must never spawn particles or dots. This is intentional for product polish.
   * This method is intentionally empty - all feedback is handled via UI button animations.
   */
  trigger(_x: number, _y: number): void {
    // UI interactions must never spawn particles or dots. This is intentional for product polish.
    // Like feedback is handled via UI button animations (scale/opacity/glow) in the HUD.
    // No canvas drawing, no particles, no dots, no circles, no ripples.
  }
  
  destroy(): void {
    // No cleanup needed - no canvas elements
  }
}
