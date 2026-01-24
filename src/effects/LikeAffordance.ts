/**
 * Like Affordance
 * Double tap = like: visual feedback only (heart pulse or subtle confirmation).
 * No backend required - pure visual feedback.
 */

import { SplatTransitionOverlay } from '../transitions/SplatTransitionOverlay'

export class LikeAffordance {
  private overlay: SplatTransitionOverlay // Reserved for future use
  private heartCanvas: HTMLCanvasElement | null = null
  private heartCtx: CanvasRenderingContext2D | null = null
  private heartRafId: number | null = null
  private heartAnimations: Array<{
    x: number
    y: number
    age: number
    lifetime: number
    scale: number
  }> = []
  
  constructor(overlay: SplatTransitionOverlay) {
    this.overlay = overlay
    this.initHeartCanvas()
  }
  
  private initHeartCanvas(): void {
    this.heartCanvas = document.createElement('canvas')
    this.heartCanvas.className = 'like-affordance-heart'
    this.heartCanvas.style.position = 'fixed'
    this.heartCanvas.style.top = '0'
    this.heartCanvas.style.left = '0'
    this.heartCanvas.style.width = '100%'
    this.heartCanvas.style.height = '100%'
    this.heartCanvas.style.pointerEvents = 'none'
    this.heartCanvas.style.zIndex = '16' // Above other overlays, below UI (HUD is ~20)
    this.heartCanvas.style.opacity = '1'
    
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    this.heartCanvas.width = window.innerWidth * dpr
    this.heartCanvas.height = window.innerHeight * dpr
    
    this.heartCtx = this.heartCanvas.getContext('2d', { alpha: true })
    if (this.heartCtx) {
      this.heartCtx.scale(dpr, dpr)
    }
    
    document.body.appendChild(this.heartCanvas)
    
    window.addEventListener('resize', () => this.resize())
  }
  
  private resize(): void {
    if (!this.heartCanvas || !this.heartCtx) return
    
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    this.heartCanvas.width = window.innerWidth * dpr
    this.heartCanvas.height = window.innerHeight * dpr
    this.heartCtx.scale(dpr, dpr)
  }
  
  setSourceCanvas(_canvas: HTMLCanvasElement | null): void {
    // Not used - like affordance is UI-only (no particles)
    void this.overlay // Suppress unused warning
  }
  
  /**
   * Trigger like affordance at tap location.
   */
  trigger(x: number, y: number): void {
    // Add heart animation
    this.heartAnimations.push({
      x,
      y,
      age: 0,
      lifetime: 600, // 600ms animation
      scale: 0,
    })
    
    // Start animation loop if not already running
    if (!this.heartRafId) {
      this.animate()
    }
    
    // No particle burst - UI-only heart animation
  }
  
  private animate = (): void => {
    if (!this.heartCanvas || !this.heartCtx) {
      this.heartRafId = null
      return
    }
    
    const W = window.innerWidth
    const H = window.innerHeight
    
    // Clear canvas
    this.heartCtx.clearRect(0, 0, W, H)
    
    // Update and draw hearts
    for (let i = this.heartAnimations.length - 1; i >= 0; i--) {
      const heart = this.heartAnimations[i]
      heart.age += 16 // ~60fps
      
      if (heart.age >= heart.lifetime) {
        this.heartAnimations.splice(i, 1)
        continue
      }
      
      const progress = heart.age / heart.lifetime
      
      // Scale: 0 → 1.2 → 1.0 (pop then settle)
      if (progress < 0.3) {
        heart.scale = (progress / 0.3) * 1.2
      } else {
        heart.scale = 1.2 - ((progress - 0.3) / 0.7) * 0.2
      }
      
      // Alpha: fade out
      const alpha = 1 - progress
      
      // Draw heart
      this.drawHeart(heart.x, heart.y, heart.scale, alpha)
    }
    
    if (this.heartAnimations.length > 0) {
      this.heartRafId = requestAnimationFrame(this.animate)
    } else {
      this.heartRafId = null
    }
  }
  
  private drawHeart(x: number, y: number, scale: number, alpha: number): void {
    if (!this.heartCtx) return
    
    const size = 40 * scale
    
    this.heartCtx.save()
    this.heartCtx.globalAlpha = alpha
    this.heartCtx.translate(x, y)
    this.heartCtx.scale(scale, scale)
    
    // Draw heart shape (simple filled path)
    this.heartCtx.fillStyle = '#ff3366' // Instagram-like pink-red
    this.heartCtx.beginPath()
    
    // Heart shape: two circles + triangle
    const heartSize = size / 2
    this.heartCtx.arc(-heartSize * 0.3, -heartSize * 0.3, heartSize * 0.5, 0, Math.PI * 2)
    this.heartCtx.arc(heartSize * 0.3, -heartSize * 0.3, heartSize * 0.5, 0, Math.PI * 2)
    this.heartCtx.moveTo(0, heartSize * 0.2)
    this.heartCtx.lineTo(-heartSize * 0.6, -heartSize * 0.4)
    this.heartCtx.lineTo(heartSize * 0.6, -heartSize * 0.4)
    this.heartCtx.closePath()
    this.heartCtx.fill()
    
    // Add subtle glow
    this.heartCtx.shadowBlur = 20
    this.heartCtx.shadowColor = 'rgba(255, 51, 102, 0.6)'
    this.heartCtx.fill()
    
    this.heartCtx.restore()
  }
  
  destroy(): void {
    if (this.heartRafId) {
      cancelAnimationFrame(this.heartRafId)
      this.heartRafId = null
    }
    if (this.heartCanvas && this.heartCanvas.parentNode) {
      this.heartCanvas.parentNode.removeChild(this.heartCanvas)
    }
    this.heartCanvas = null
    this.heartCtx = null
  }
}
