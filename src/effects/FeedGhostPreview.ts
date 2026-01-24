/**
 * Feed Ghost Preview
 * Subtly reveals next/previous splat at top/bottom edge during slow scroll.
 * Low opacity hint that more content exists without UI arrows.
 * Overlay-only: renders preview hints on a canvas overlay.
 */

export class FeedGhostPreview {
  private currentIndex = 0
  private totalSplats = 0
  private scrollProgress = 0 // -1 to 1: -1 = fully showing prev, 0 = current, 1 = fully showing next
  private enabled = true
  private previewCanvas: HTMLCanvasElement | null = null
  private previewCtx: CanvasRenderingContext2D | null = null
  private rafId: number | null = null
  
  constructor() {
    this.initCanvas()
  }
  
  private initCanvas(): void {
    this.previewCanvas = document.createElement('canvas')
    this.previewCanvas.className = 'feed-ghost-preview'
    this.previewCanvas.style.position = 'fixed'
    this.previewCanvas.style.top = '0'
    this.previewCanvas.style.left = '0'
    this.previewCanvas.style.width = '100%'
    this.previewCanvas.style.height = '100%'
    this.previewCanvas.style.pointerEvents = 'none'
    this.previewCanvas.style.zIndex = '4' // Below transition overlay (5) but above viewer
    this.previewCanvas.style.opacity = '1'
    
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    this.previewCanvas.width = window.innerWidth * dpr
    this.previewCanvas.height = window.innerHeight * dpr
    
    this.previewCtx = this.previewCanvas.getContext('2d', { alpha: true })
    if (this.previewCtx) {
      this.previewCtx.scale(dpr, dpr)
    }
    
    document.body.appendChild(this.previewCanvas)
    
    window.addEventListener('resize', () => this.resize())
    this.animate()
  }
  
  private resize(): void {
    if (!this.previewCanvas || !this.previewCtx) return
    
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    this.previewCanvas.width = window.innerWidth * dpr
    this.previewCanvas.height = window.innerHeight * dpr
    this.previewCtx.setTransform(1, 0, 0, 1, 0, 0)
    this.previewCtx.scale(dpr, dpr)
  }
  
  setViewer(_viewer: any): void {
    // Viewer reference not needed for ghost preview (overlay-only)
  }
  
  setCurrentIndex(index: number, total: number): void {
    this.currentIndex = index
    this.totalSplats = total
  }
  
  /**
   * Update scroll progress (-1 to 1).
   * Called during swipe gesture.
   */
  updateScrollProgress(progress: number): void {
    if (!this.enabled) return
    this.scrollProgress = Math.max(-1, Math.min(1, progress))
  }
  
  /**
   * Reset scroll progress (when swipe completes or cancels).
   */
  reset(): void {
    this.scrollProgress = 0
  }
  
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled) {
      this.reset()
    }
  }
  
  /**
   * Get preview opacity based on scroll progress.
   * Returns 0 if no preview should be shown.
   */
  private getPreviewOpacity(direction: 'next' | 'prev'): number {
    if (!this.enabled) return 0
    
    if (direction === 'next') {
      // Show next preview when scrolling down (positive progress)
      if (this.scrollProgress > 0 && this.currentIndex < this.totalSplats - 1) {
        return Math.min(0.12, this.scrollProgress * 0.15) // Max 12% opacity (very subtle)
      }
    } else {
      // Show prev preview when scrolling up (negative progress)
      if (this.scrollProgress < 0 && this.currentIndex > 0) {
        return Math.min(0.12, Math.abs(this.scrollProgress) * 0.15) // Max 12% opacity
      }
    }
    
    return 0
  }
  
  /**
   * Animate preview hints.
   */
  private animate = (): void => {
    if (!this.previewCanvas || !this.previewCtx) {
      this.rafId = requestAnimationFrame(this.animate)
      return
    }
    
    const W = window.innerWidth
    const H = window.innerHeight
    
    // Clear canvas
    this.previewCtx.clearRect(0, 0, W, H)
    
    // Draw preview hints if scrolling
    const nextOpacity = this.getPreviewOpacity('next')
    const prevOpacity = this.getPreviewOpacity('prev')
    
    if (nextOpacity > 0) {
      // Hint at bottom edge (next splat)
      const hintHeight = H * 0.15
      const gradient = this.previewCtx.createLinearGradient(0, H - hintHeight, 0, H)
      gradient.addColorStop(0, `rgba(255, 255, 255, 0)`)
      gradient.addColorStop(1, `rgba(255, 255, 255, ${nextOpacity})`)
      
      this.previewCtx.fillStyle = gradient
      this.previewCtx.fillRect(0, H - hintHeight, W, hintHeight)
    }
    
    if (prevOpacity > 0) {
      // Hint at top edge (prev splat)
      const hintHeight = H * 0.15
      const gradient = this.previewCtx.createLinearGradient(0, 0, 0, hintHeight)
      gradient.addColorStop(0, `rgba(255, 255, 255, ${prevOpacity})`)
      gradient.addColorStop(1, `rgba(255, 255, 255, 0)`)
      
      this.previewCtx.fillStyle = gradient
      this.previewCtx.fillRect(0, 0, W, hintHeight)
    }
    
    this.rafId = requestAnimationFrame(this.animate)
  }
  
  destroy(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    if (this.previewCanvas && this.previewCanvas.parentNode) {
      this.previewCanvas.parentNode.removeChild(this.previewCanvas)
    }
    this.previewCanvas = null
    this.previewCtx = null
  }
}
