/**
 * MicroFeedback
 * Provides Instagram-style micro-feedback for UI interactions:
 * - Button animations (scale, pulse, glow)
 * - Localized particle bursts near tap points
 * - Consistent easing and timing
 */

import { SplatTransitionOverlay } from '../transitions/SplatTransitionOverlay'

export type FeedbackType = 'like' | 'save' | 'share' | 'comment' | 'recenter'

interface FeedbackConfig {
  animationDuration: number // 200-350ms
  particleBurst: boolean
  particleIntensity: number // 0-1
  hapticType?: 'light' | 'medium' | 'subtle'
}

const FEEDBACK_CONFIGS: Record<FeedbackType, FeedbackConfig> = {
  like: {
    animationDuration: 280,
    particleBurst: true,
    particleIntensity: 0.4,
    hapticType: 'light',
  },
  save: {
    animationDuration: 250,
    particleBurst: true,
    particleIntensity: 0.35,
    hapticType: 'light',
  },
  share: {
    animationDuration: 300,
    particleBurst: true,
    particleIntensity: 0.3,
    hapticType: 'light',
  },
  comment: {
    animationDuration: 300,
    particleBurst: true,
    particleIntensity: 0.3,
    hapticType: 'light',
  },
  recenter: {
    animationDuration: 350,
    particleBurst: true,
    particleIntensity: 0.6,
    hapticType: 'medium',
  },
}

export class MicroFeedback {
  private overlay: SplatTransitionOverlay
  private sourceCanvas: HTMLCanvasElement | null = null
  
  constructor(overlay: SplatTransitionOverlay) {
    this.overlay = overlay
  }
  
  setSourceCanvas(canvas: HTMLCanvasElement | null): void {
    this.sourceCanvas = canvas
  }
  
  /**
   * Trigger micro-feedback for a button interaction.
   */
  trigger(type: FeedbackType, buttonElement: HTMLElement, tapX?: number, tapY?: number): void {
    const config = FEEDBACK_CONFIGS[type]
    
    // Get button position for particle burst
    const rect = buttonElement.getBoundingClientRect()
    const centerX = tapX !== undefined ? tapX : rect.left + rect.width / 2
    const centerY = tapY !== undefined ? tapY : rect.top + rect.height / 2
    
    // Animate button
    this.animateButton(buttonElement, type, config.animationDuration)
    
    // Particle burst
    if (config.particleBurst && this.sourceCanvas) {
      this.triggerParticleBurst(type, centerX, centerY, config.particleIntensity)
    }
    
    // Haptic feedback
    if (config.hapticType) {
      this.triggerHaptic(config.hapticType)
    }
  }
  
  /**
   * Animate button with type-specific animation.
   */
  private animateButton(element: HTMLElement, type: FeedbackType, duration: number): void {
    // Remove any existing animation class
    element.classList.remove('micro-feedback--animating')
    
    // Add animation class
    element.classList.add('micro-feedback--animating')
    element.setAttribute('data-feedback-type', type)
    
    // Remove class after animation
    setTimeout(() => {
      element.classList.remove('micro-feedback--animating')
      element.removeAttribute('data-feedback-type')
    }, duration)
  }
  
  /**
   * Trigger localized particle burst near button.
   */
  private triggerParticleBurst(type: FeedbackType, x: number, y: number, intensity: number): void {
    if (!this.sourceCanvas) return
    
    const H = window.innerHeight
    
    // Create small burst area around button
    const burstRadius = H * 0.08 // 8% of screen height
    const bandCenterY = y
    const bandHeight = burstRadius
    
    // Type-specific burst patterns
    switch (type) {
      case 'like':
        // Heart pop: multiple small bursts in heart pattern
        this.createHeartBurst(x, y, intensity)
        break
      case 'save':
        // Snap: single focused burst with glow
        this.overlay.startAudioPulse({
          bandCenterY,
          bandHeight,
          direction: 'up',
          intensity: intensity * 0.8,
          durationMs: 400,
          sourceCanvas: this.sourceCanvas,
          intensityMultiplier: 1.2,
        })
        break
      case 'recenter':
        // Strong pulse ring: expanding ring
        this.createPulseRing(x, y, intensity)
        break
      default:
        // Default: small sparkle burst
        this.overlay.startAudioPulse({
          bandCenterY,
          bandHeight: bandHeight * 0.6,
          direction: 'up',
          intensity: intensity * 0.7,
          durationMs: 350,
          sourceCanvas: this.sourceCanvas,
          intensityMultiplier: 1.0,
        })
        break
    }
  }
  
  /**
   * Create heart-shaped burst pattern for like button.
   */
  private createHeartBurst(_x: number, y: number, intensity: number): void {
    if (!this.sourceCanvas) return
    
    const H = window.innerHeight
    const burstSize = H * 0.06
    
    // Heart pattern: 5 small bursts
    const offsets = [
      { x: 0, y: -burstSize * 0.3 }, // Top center
      { x: -burstSize * 0.4, y: -burstSize * 0.1 }, // Top left
      { x: burstSize * 0.4, y: -burstSize * 0.1 }, // Top right
      { x: -burstSize * 0.3, y: burstSize * 0.2 }, // Bottom left
      { x: burstSize * 0.3, y: burstSize * 0.2 }, // Bottom right
    ]
    
    offsets.forEach((offset, i) => {
      setTimeout(() => {
        const burstY = y + offset.y
        this.overlay.startAudioPulse({
          bandCenterY: burstY,
          bandHeight: burstSize * 0.4,
          direction: 'up',
          intensity: intensity * 0.5,
          durationMs: 300,
          sourceCanvas: this.sourceCanvas,
          intensityMultiplier: 1.3,
        })
      }, i * 30) // Stagger bursts
    })
  }
  
  /**
   * Create expanding pulse ring for recenter button.
   */
  private createPulseRing(_x: number, y: number, intensity: number): void {
    if (!this.sourceCanvas) return
    
    const H = window.innerHeight
    const ringSizes = [H * 0.04, H * 0.08, H * 0.12]
    
    ringSizes.forEach((size, i) => {
      setTimeout(() => {
        this.overlay.startAudioPulse({
          bandCenterY: y,
          bandHeight: size,
          direction: 'up',
          intensity: intensity * (1.0 - i * 0.25), // Fade out
          durationMs: 500,
          sourceCanvas: this.sourceCanvas,
          intensityMultiplier: 1.5,
        })
      }, i * 80) // Stagger rings
    })
  }
  
  /**
   * Trigger haptic feedback (mobile-safe).
   */
  private triggerHaptic(type: 'light' | 'medium' | 'subtle'): void {
    if (!('vibrate' in navigator)) return
    
    try {
      const patterns: Record<typeof type, number | number[]> = {
        light: 10, // 10ms light tap
        medium: [10, 20, 10], // Medium pulse
        subtle: 5, // 5ms very subtle
      }
      
      const pattern = patterns[type]
      if (Array.isArray(pattern)) {
        navigator.vibrate(pattern)
      } else {
        navigator.vibrate(pattern)
      }
    } catch {
      // Haptics not supported or failed
    }
  }
}
