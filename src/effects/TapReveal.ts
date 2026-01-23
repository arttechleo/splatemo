/**
 * Tap Reveal Effect
 * Press-and-hold creates a circular reveal/boost effect under finger.
 * Overlay-based, no rendering internals modified.
 */

export class TapReveal {
  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private rafId: number | null = null
  private isActive = false
  private enabled = false
  
  // Touch/mouse state
  private isPressed = false
  private pressX = 0
  private pressY = 0
  
  // Reveal effect
  private revealRadius = 0
  private readonly MAX_RADIUS = 200
  private readonly GROWTH_RATE = 2.5
  private readonly FADE_RATE = 0.95
  
  constructor() {
    this.initCanvas()
    this.setupEventListeners()
  }
  
  private initCanvas(): void {
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'tap-reveal-overlay'
    this.canvas.style.position = 'fixed'
    this.canvas.style.top = '0'
    this.canvas.style.left = '0'
    this.canvas.style.width = '100%'
    this.canvas.style.height = '100%'
    this.canvas.style.pointerEvents = 'none'
    this.canvas.style.zIndex = '15' // Above rain overlay
    this.canvas.style.opacity = '1'
    
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    this.canvas.width = window.innerWidth * dpr
    this.canvas.height = window.innerHeight * dpr
    
    this.ctx = this.canvas.getContext('2d', { alpha: true })
    if (this.ctx) {
      this.ctx.scale(dpr, dpr)
    }
    
    document.body.appendChild(this.canvas)
    
    window.addEventListener('resize', () => this.resize())
  }
  
  private resize(): void {
    if (!this.canvas || !this.ctx) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    this.canvas.width = window.innerWidth * dpr
    this.canvas.height = window.innerHeight * dpr
    this.ctx.setTransform(1, 0, 0, 1, 0, 0)
    this.ctx.scale(dpr, dpr)
  }
  
  private setupEventListeners(): void {
    // Mouse events
    document.addEventListener('mousedown', (e) => this.handlePress(e.clientX, e.clientY))
    document.addEventListener('mouseup', () => this.handleRelease())
    document.addEventListener('mousemove', (e) => {
      if (this.isPressed) {
        this.pressX = e.clientX
        this.pressY = e.clientY
      }
    })
    
    // Touch events
    document.addEventListener('touchstart', (e) => {
      if (e.touches.length > 0) {
        const touch = e.touches[0]
        this.handlePress(touch.clientX, touch.clientY)
      }
    })
    document.addEventListener('touchend', () => this.handleRelease())
    document.addEventListener('touchmove', (e) => {
      if (this.isPressed && e.touches.length > 0) {
        const touch = e.touches[0]
        this.pressX = touch.clientX
        this.pressY = touch.clientY
      }
    })
  }
  
  private handlePress(x: number, y: number): void {
    if (!this.enabled) return
    
    this.isPressed = true
    this.pressX = x
    this.pressY = y
    this.revealRadius = 10 // Start small
    
    if (!this.isActive) {
      this.isActive = true
      this.animate()
    }
  }
  
  private handleRelease(): void {
    if (!this.isPressed) return
    
    this.isPressed = false
  }
  
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled) {
      this.isPressed = false
      this.revealRadius = 0
    }
  }
  
  private animate = (): void => {
    if (!this.isActive || !this.ctx || !this.canvas) {
      return
    }
    
    const W = window.innerWidth
    const H = window.innerHeight
    
    // Clear with fade
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.1)'
    this.ctx.fillRect(0, 0, W, H)
    
    // Update reveal
    if (this.isPressed) {
      // Grow while pressed
      this.revealRadius = Math.min(this.MAX_RADIUS, this.revealRadius + this.GROWTH_RATE)
    } else {
      // Fade when released
      this.revealRadius *= this.FADE_RATE
      if (this.revealRadius < 1) {
        this.revealRadius = 0
        this.isActive = false
        return
      }
    }
    
    // Draw reveal effect
    if (this.revealRadius > 0) {
      const x = this.pressX
      const y = this.pressY
      
      // Create radial gradient
      const gradient = this.ctx.createRadialGradient(x, y, 0, x, y, this.revealRadius)
      gradient.addColorStop(0, 'rgba(255, 255, 255, 0.3)')
      gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.1)')
      gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
      
      this.ctx.fillStyle = gradient
      this.ctx.beginPath()
      this.ctx.arc(x, y, this.revealRadius, 0, Math.PI * 2)
      this.ctx.fill()
      
      // Draw outer ring
      this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)'
      this.ctx.lineWidth = 2
      this.ctx.beginPath()
      this.ctx.arc(x, y, this.revealRadius, 0, Math.PI * 2)
      this.ctx.stroke()
    }
    
    this.rafId = requestAnimationFrame(this.animate)
  }
  
  destroy(): void {
    this.setEnabled(false)
    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas)
    }
    this.canvas = null
    this.ctx = null
  }
}
