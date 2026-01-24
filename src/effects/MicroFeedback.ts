/**
 * MicroFeedback
 * Provides Instagram-style micro-feedback for UI interactions:
 * - Button animations (scale, pulse, glow) - UI-only
 * - Haptic feedback (mobile)
 * - NO particle bursts or canvas circles
 */

export type FeedbackType = 'like' | 'save' | 'share' | 'comment' | 'recenter'

interface FeedbackConfig {
  animationDuration: number // 200-350ms
  hapticType?: 'light' | 'medium' | 'subtle'
}

const FEEDBACK_CONFIGS: Record<FeedbackType, FeedbackConfig> = {
  like: {
    animationDuration: 280,
    hapticType: 'light',
  },
  save: {
    animationDuration: 250,
    hapticType: 'light',
  },
  share: {
    animationDuration: 300,
    hapticType: 'light',
  },
  comment: {
    animationDuration: 300,
    hapticType: 'light',
  },
  recenter: {
    animationDuration: 350,
    hapticType: 'medium',
  },
}

export class MicroFeedback {
  constructor() {
    // No dependencies needed - UI-only feedback
  }
  
  /**
   * Trigger micro-feedback for a button interaction.
   * UI-only: animations and haptics, no particles.
   */
  trigger(type: FeedbackType, buttonElement: HTMLElement, _tapX?: number, _tapY?: number): void {
    const config = FEEDBACK_CONFIGS[type]
    
    // Animate button (UI-only)
    this.animateButton(buttonElement, type, config.animationDuration)
    
    // Haptic feedback (mobile)
    if (config.hapticType) {
      this.triggerHaptic(config.hapticType)
    }
    
    // NO particle bursts - UI feedback is UI-only
  }
  
  /**
   * Animate button with type-specific animation.
   * UI-only: scale, opacity, glow - no particles.
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
