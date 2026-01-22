// Lightweight particle overlay for mobile transitions
// Independent of Gaussian splat rendering

export class ParticleOverlay {
  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private particles: Array<{
    x: number
    y: number
    vx: number
    vy: number
    size: number
    opacity: number
  }> = []
  private animationId: number | null = null
  private startTime = 0
  private duration = 1000
  private isActive = false

  constructor(container: HTMLElement) {
    this.canvas = document.createElement('canvas')
    this.canvas.style.position = 'fixed'
    this.canvas.style.top = '0'
    this.canvas.style.left = '0'
    this.canvas.style.width = '100%'
    this.canvas.style.height = '100%'
    this.canvas.style.pointerEvents = 'none'
    this.canvas.style.zIndex = '5'
    this.canvas.style.opacity = '0'
    this.canvas.style.transition = 'opacity 0.3s ease'
    container.appendChild(this.canvas)

    this.ctx = this.canvas.getContext('2d', { alpha: true })
    this.resize()
    window.addEventListener('resize', () => this.resize())
  }

  private resize() {
    if (!this.canvas) return
    const dpr = window.devicePixelRatio || 1
    this.canvas.width = window.innerWidth * dpr
    this.canvas.height = window.innerHeight * dpr
    if (this.ctx) {
      this.ctx.scale(dpr, dpr)
    }
  }

  start(direction: 'up' | 'down') {
    this.stop()
    this.isActive = true
    this.startTime = performance.now()
    
    if (!this.canvas || !this.ctx) return

    // Create particles
    const count = 200
    this.particles = []
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        vx: (Math.random() - 0.5) * 2,
        vy: (Math.random() * 0.5 + 0.5) * (direction === 'up' ? -1 : 1) * 3,
        size: Math.random() * 3 + 1,
        opacity: Math.random() * 0.5 + 0.5,
      })
    }

    this.canvas.style.opacity = '1'
    this.animate()
  }

  private animate = () => {
    if (!this.isActive || !this.ctx || !this.canvas) return

    const elapsed = performance.now() - this.startTime
    const progress = Math.min(1, elapsed / this.duration)

    // Clear
    this.ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)

    // Update and draw particles
    this.ctx.fillStyle = '#ffffff'
    for (const p of this.particles) {
      p.x += p.vx
      p.y += p.vy
      p.opacity *= 0.98

      if (p.opacity > 0.01) {
        this.ctx.globalAlpha = p.opacity * (1 - progress)
        this.ctx.beginPath()
        this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        this.ctx.fill()
      }
    }

    if (progress < 1) {
      this.animationId = requestAnimationFrame(this.animate)
    } else {
      this.fadeOut()
    }
  }

  fadeOut() {
    if (!this.canvas) return
    this.canvas.style.opacity = '0'
    setTimeout(() => {
      this.stop()
    }, 300)
  }

  stop() {
    this.isActive = false
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId)
      this.animationId = null
    }
    if (this.canvas) {
      this.canvas.style.opacity = '0'
    }
    this.particles = []
  }

  destroy() {
    this.stop()
    if (this.canvas && this.canvas.parentElement) {
      this.canvas.parentElement.removeChild(this.canvas)
    }
    this.canvas = null
    this.ctx = null
  }
}
