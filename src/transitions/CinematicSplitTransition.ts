/**
 * Cinematic Split Reveal Transition
 * Instagram-style screen split transitions with smooth easing and highlight edges.
 * Overlay-only, no modification to splat rendering.
 */

export type SplitDirection = 'up' | 'down' | 'left' | 'right' | 'diagonal-up' | 'diagonal-down'

export interface CinematicSplitConfig {
  duration: number // ms (600-800ms)
  easing: string // CSS cubic-bezier or easing function
  highlightIntensity: number // 0-1
  highlightWidth: number // pixels
  enableLightLeaks: boolean
  lightLeakIntensity: number // 0-1
}

const DEFAULT_CONFIG: CinematicSplitConfig = {
  duration: 700, // 700ms for cinematic feel
  easing: 'cubic-bezier(0.22, 1.0, 0.36, 1.0)', // Filmic easing
  highlightIntensity: 0.4,
  highlightWidth: 3,
  enableLightLeaks: true,
  lightLeakIntensity: 0.15,
}

export class CinematicSplitTransition {
  private overlay: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private isActive = false
  private startTime = 0
  private direction: SplitDirection = 'down'
  private config: CinematicSplitConfig = { ...DEFAULT_CONFIG }
  private rafId: number | null = null
  private sourceCanvas: HTMLCanvasElement | null = null
  private capturedFrame: ImageData | null = null
  
  constructor(container: HTMLElement) {
    this.overlay = document.createElement('canvas')
    this.overlay.className = 'cinematic-split-transition'
    this.overlay.style.position = 'fixed'
    this.overlay.style.top = '0'
    this.overlay.style.left = '0'
    this.overlay.style.width = '100%'
    this.overlay.style.height = '100%'
    this.overlay.style.pointerEvents = 'none'
    this.overlay.style.zIndex = '6' // Above transition overlay (5), below UI
    this.overlay.style.opacity = '1'
    
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    this.overlay.width = window.innerWidth * dpr
    this.overlay.height = window.innerHeight * dpr
    
    this.ctx = this.overlay.getContext('2d', { alpha: true })
    if (this.ctx) {
      this.ctx.scale(dpr, dpr)
    }
    
    container.appendChild(this.overlay)
    window.addEventListener('resize', () => this.resize())
  }
  
  private resize(): void {
    if (!this.overlay || !this.ctx) return
    
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    this.overlay.width = window.innerWidth * dpr
    this.overlay.height = window.innerHeight * dpr
    this.ctx.setTransform(1, 0, 0, 1, 0, 0)
    this.ctx.scale(dpr, dpr)
  }
  
  setConfig(config: Partial<CinematicSplitConfig>): void {
    this.config = { ...this.config, ...config }
  }
  
  /**
   * Start split reveal transition.
   */
  startTransition(
    direction: SplitDirection,
    sourceCanvas: HTMLCanvasElement | null
  ): void {
    this.stop()
    
    if (!sourceCanvas) {
      console.warn('[CINEMATIC] No source canvas for split transition')
      return
    }
    
    this.direction = direction
    this.sourceCanvas = sourceCanvas
    
    // Capture current frame (scaled to overlay size for performance)
    try {
      const W = window.innerWidth
      const H = window.innerHeight
      const tempCanvas = document.createElement('canvas')
      tempCanvas.width = W
      tempCanvas.height = H
      const tempCtx = tempCanvas.getContext('2d')
      if (tempCtx) {
        // Draw source canvas scaled to overlay size
        tempCtx.drawImage(sourceCanvas, 0, 0, W, H)
        this.capturedFrame = tempCtx.getImageData(0, 0, W, H)
      }
    } catch (e) {
      console.warn('[CINEMATIC] Failed to capture frame:', e)
      return
    }
    
    this.isActive = true
    this.startTime = performance.now()
    this.animate()
  }
  
  /**
   * Stop transition immediately.
   */
  stop(): void {
    this.isActive = false
    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    this.capturedFrame = null
    if (this.ctx && this.overlay) {
      this.ctx.clearRect(0, 0, this.overlay.width, this.overlay.height)
    }
  }
  
  /**
   * Easing function: cubic-bezier(0.22, 1.0, 0.36, 1.0)
   * Approximated with a polynomial for JavaScript
   */
  private easeInOutCubic(t: number): number {
    // Approximate cubic-bezier(0.22, 1.0, 0.36, 1.0)
    // This is a smooth ease-in-out with slight anticipation
    return t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2
  }
  
  /**
   * Get progress with cinematic easing.
   */
  private getProgress(): number {
    const elapsed = performance.now() - this.startTime
    const rawProgress = Math.min(1, elapsed / this.config.duration)
    return this.easeInOutCubic(rawProgress)
  }
  
  /**
   * Calculate split position based on direction and progress.
   */
  private getSplitPosition(progress: number): { x: number; y: number; angle: number } {
    const W = window.innerWidth
    const H = window.innerHeight
    
    switch (this.direction) {
      case 'down':
        return { x: 0, y: H * progress, angle: 0 }
      case 'up':
        return { x: 0, y: H * (1 - progress), angle: 0 }
      case 'right':
        return { x: W * progress, y: 0, angle: Math.PI / 2 }
      case 'left':
        return { x: W * (1 - progress), y: 0, angle: Math.PI / 2 }
      case 'diagonal-down':
        return {
          x: W * progress,
          y: H * progress,
          angle: Math.atan2(H, W),
        }
      case 'diagonal-up':
        return {
          x: W * progress,
          y: H * (1 - progress),
          angle: -Math.atan2(H, W),
        }
      default:
        return { x: 0, y: H * progress, angle: 0 }
    }
  }
  
  /**
   * Draw highlight edge traveling along transition axis.
   */
  private drawHighlightEdge(
    splitPos: { x: number; y: number; angle: number },
    progress: number
  ): void {
    if (!this.ctx) return
    
    const W = window.innerWidth
    const H = window.innerHeight
    const intensity = this.config.highlightIntensity * (1 - Math.abs(progress - 0.5) * 2) // Peak at midpoint
    
    // Create gradient along split line
    const gradient = this.ctx.createLinearGradient(
      splitPos.x - Math.cos(splitPos.angle) * W,
      splitPos.y - Math.sin(splitPos.angle) * H,
      splitPos.x + Math.cos(splitPos.angle) * W,
      splitPos.y + Math.sin(splitPos.angle) * H
    )
    
    // Highlight fades from center
    const centerPos = 0.5
    gradient.addColorStop(0, `rgba(255, 255, 255, 0)`)
    gradient.addColorStop(Math.max(0, centerPos - 0.1), `rgba(255, 255, 255, ${intensity * 0.3})`)
    gradient.addColorStop(centerPos, `rgba(255, 255, 255, ${intensity})`)
    gradient.addColorStop(Math.min(1, centerPos + 0.1), `rgba(255, 255, 255, ${intensity * 0.3})`)
    gradient.addColorStop(1, `rgba(255, 255, 255, 0)`)
    
    this.ctx.save()
    this.ctx.strokeStyle = gradient
    this.ctx.lineWidth = this.config.highlightWidth
    this.ctx.beginPath()
    
    // Draw line along split axis
    if (Math.abs(splitPos.angle) < 0.01) {
      // Horizontal line
      this.ctx.moveTo(0, splitPos.y)
      this.ctx.lineTo(W, splitPos.y)
    } else if (Math.abs(splitPos.angle - Math.PI / 2) < 0.01) {
      // Vertical line
      this.ctx.moveTo(splitPos.x, 0)
      this.ctx.lineTo(splitPos.x, H)
    } else {
      // Diagonal line
      const length = Math.sqrt(W * W + H * H)
      this.ctx.moveTo(
        splitPos.x - Math.cos(splitPos.angle) * length,
        splitPos.y - Math.sin(splitPos.angle) * length
      )
      this.ctx.lineTo(
        splitPos.x + Math.cos(splitPos.angle) * length,
        splitPos.y + Math.sin(splitPos.angle) * length
      )
    }
    
    this.ctx.stroke()
    this.ctx.restore()
  }
  
  /**
   * Draw light leaks (subtle animated highlights).
   */
  private drawLightLeaks(
    splitPos: { x: number; y: number; angle: number },
    progress: number
  ): void {
    if (!this.ctx || !this.config.enableLightLeaks) return
    
    const W = window.innerWidth
    const H = window.innerHeight
    const intensity = this.config.lightLeakIntensity * (1 - Math.abs(progress - 0.5) * 2)
    
    // Create radial gradients at split edges
    const leakCount = 3
    for (let i = 0; i < leakCount; i++) {
      const offset = (i - 1) * (W / leakCount)
      const leakX = splitPos.x + Math.cos(splitPos.angle + Math.PI / 2) * offset
      const leakY = splitPos.y + Math.sin(splitPos.angle + Math.PI / 2) * offset
      
      const gradient = this.ctx.createRadialGradient(leakX, leakY, 0, leakX, leakY, W * 0.3)
      gradient.addColorStop(0, `rgba(255, 255, 255, ${intensity * 0.2})`)
      gradient.addColorStop(0.5, `rgba(255, 255, 255, ${intensity * 0.1})`)
      gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
      
      this.ctx.save()
      this.ctx.globalAlpha = intensity
      this.ctx.fillStyle = gradient
      this.ctx.fillRect(0, 0, W, H)
      this.ctx.restore()
    }
  }
  
  /**
   * Draw split mask revealing/hiding content.
   */
  private drawSplitMask(
    splitPos: { x: number; y: number; angle: number },
    progress: number
  ): void {
    if (!this.ctx || !this.capturedFrame) return
    
    const W = window.innerWidth
    const H = window.innerHeight
    
    // Clear canvas
    this.ctx.clearRect(0, 0, W, H)
    
    // Draw captured frame (already at correct size)
    const tempCanvas = document.createElement('canvas')
    tempCanvas.width = this.capturedFrame.width
    tempCanvas.height = this.capturedFrame.height
    const tempCtx = tempCanvas.getContext('2d')
    if (tempCtx) {
      tempCtx.putImageData(this.capturedFrame, 0, 0)
      this.ctx.drawImage(tempCanvas, 0, 0, W, H)
    }
    
    // Apply split mask
    this.ctx.save()
    this.ctx.globalCompositeOperation = 'destination-out'
    
    // Create clipping path for split
    this.ctx.beginPath()
    
    if (Math.abs(splitPos.angle) < 0.01) {
      // Horizontal split
      if (this.direction === 'down') {
        this.ctx.rect(0, 0, W, splitPos.y)
      } else {
        this.ctx.rect(0, splitPos.y, W, H - splitPos.y)
      }
    } else if (Math.abs(splitPos.angle - Math.PI / 2) < 0.01) {
      // Vertical split
      if (this.direction === 'right') {
        this.ctx.rect(0, 0, splitPos.x, H)
      } else {
        this.ctx.rect(splitPos.x, 0, W - splitPos.x, H)
      }
    } else {
      // Diagonal split - use polygon
      const length = Math.sqrt(W * W + H * H)
      const perpAngle = splitPos.angle + Math.PI / 2
      const perpX = Math.cos(perpAngle) * length
      const perpY = Math.sin(perpAngle) * length
      
      this.ctx.moveTo(splitPos.x - perpX, splitPos.y - perpY)
      this.ctx.lineTo(splitPos.x + perpX, splitPos.y + perpY)
      this.ctx.lineTo(W, H)
      this.ctx.lineTo(0, H)
      this.ctx.lineTo(0, 0)
      this.ctx.closePath()
    }
    
    this.ctx.fill()
    this.ctx.restore()
    
    // Draw highlight edge
    this.drawHighlightEdge(splitPos, progress)
    
    // Draw light leaks
    this.drawLightLeaks(splitPos, progress)
  }
  
  /**
   * Animation loop.
   */
  private animate = (): void => {
    if (!this.isActive) return
    
    const progress = this.getProgress()
    const splitPos = this.getSplitPosition(progress)
    
    this.drawSplitMask(splitPos, progress)
    
    if (progress >= 1) {
      this.stop()
      return
    }
    
    this.rafId = requestAnimationFrame(this.animate)
  }
  
  /**
   * Check if transition is active.
   */
  isTransitioning(): boolean {
    return this.isActive
  }
  
  destroy(): void {
    this.stop()
    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay)
    }
    this.overlay = null
    this.ctx = null
  }
}
