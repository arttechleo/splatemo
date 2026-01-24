/**
 * Filmic Overlays
 * Optional vignette and grain effects for cinematic feel.
 * No dimming - overlays are additive/subtractive only.
 */

export interface FilmicOverlayConfig {
  vignetteEnabled: boolean
  vignetteIntensity: number // 0-1
  vignetteSize: number // 0-1 (0 = tight, 1 = wide)
  grainEnabled: boolean
  grainIntensity: number // 0-1
  grainSize: number // pixels
}

const DEFAULT_CONFIG: FilmicOverlayConfig = {
  vignetteEnabled: false, // OFF by default
  vignetteIntensity: 0.3,
  vignetteSize: 0.7,
  grainEnabled: false, // OFF by default
  grainIntensity: 0.15,
  grainSize: 1,
}

export class FilmicOverlays {
  private vignetteCanvas: HTMLCanvasElement | null = null
  private vignetteCtx: CanvasRenderingContext2D | null = null
  private grainCanvas: HTMLCanvasElement | null = null
  private grainCtx: CanvasRenderingContext2D | null = null
  private config: FilmicOverlayConfig = { ...DEFAULT_CONFIG }
  private grainRafId: number | null = null
  private grainPattern: CanvasPattern | null = null
  
  constructor(container: HTMLElement) {
    this.createVignetteCanvas(container)
    this.createGrainCanvas(container)
    this.updateGrainPattern()
  }
  
  private createVignetteCanvas(container: HTMLElement): void {
    this.vignetteCanvas = document.createElement('canvas')
    this.vignetteCanvas.className = 'filmic-vignette'
    this.vignetteCanvas.style.position = 'fixed'
    this.vignetteCanvas.style.top = '0'
    this.vignetteCanvas.style.left = '0'
    this.vignetteCanvas.style.width = '100%'
    this.vignetteCanvas.style.height = '100%'
    this.vignetteCanvas.style.pointerEvents = 'none'
    this.vignetteCanvas.style.zIndex = '7' // Above split transition
    this.vignetteCanvas.style.opacity = '1'
    this.vignetteCanvas.style.mixBlendMode = 'multiply' // Darken edges without dimming center
    
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    this.vignetteCanvas.width = window.innerWidth * dpr
    this.vignetteCanvas.height = window.innerHeight * dpr
    
    this.vignetteCtx = this.vignetteCanvas.getContext('2d', { alpha: true })
    if (this.vignetteCtx) {
      this.vignetteCtx.scale(dpr, dpr)
    }
    
    container.appendChild(this.vignetteCanvas)
    window.addEventListener('resize', () => this.resizeVignette())
    this.updateVignette()
  }
  
  private createGrainCanvas(container: HTMLElement): void {
    this.grainCanvas = document.createElement('canvas')
    this.grainCanvas.className = 'filmic-grain'
    this.grainCanvas.style.position = 'fixed'
    this.grainCanvas.style.top = '0'
    this.grainCanvas.style.left = '0'
    this.grainCanvas.style.width = '100%'
    this.grainCanvas.style.height = '100%'
    this.grainCanvas.style.pointerEvents = 'none'
    this.grainCanvas.style.zIndex = '8' // Above vignette
    this.grainCanvas.style.opacity = '1'
    this.grainCanvas.style.mixBlendMode = 'overlay' // Subtle texture overlay
    
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    this.grainCanvas.width = window.innerWidth * dpr
    this.grainCanvas.height = window.innerHeight * dpr
    
    this.grainCtx = this.grainCanvas.getContext('2d', { alpha: true })
    if (this.grainCtx) {
      this.grainCtx.scale(dpr, dpr)
    }
    
    container.appendChild(this.grainCanvas)
    window.addEventListener('resize', () => this.resizeGrain())
    this.animateGrain()
  }
  
  private resizeVignette(): void {
    if (!this.vignetteCanvas || !this.vignetteCtx) return
    
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    this.vignetteCanvas.width = window.innerWidth * dpr
    this.vignetteCanvas.height = window.innerHeight * dpr
    this.vignetteCtx.setTransform(1, 0, 0, 1, 0, 0)
    this.vignetteCtx.scale(dpr, dpr)
    this.updateVignette()
  }
  
  private resizeGrain(): void {
    if (!this.grainCanvas || !this.grainCtx) return
    
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    this.grainCanvas.width = window.innerWidth * dpr
    this.grainCanvas.height = window.innerHeight * dpr
    this.grainCtx.setTransform(1, 0, 0, 1, 0, 0)
    this.grainCtx.scale(dpr, dpr)
    this.updateGrainPattern()
  }
  
  setConfig(config: Partial<FilmicOverlayConfig>): void {
    this.config = { ...this.config, ...config }
    this.updateVignette()
    this.updateGrainPattern()
    
    if (this.config.grainEnabled) {
      if (!this.grainRafId) {
        this.animateGrain()
      }
    } else {
      if (this.grainRafId) {
        cancelAnimationFrame(this.grainRafId)
        this.grainRafId = null
      }
      if (this.grainCtx && this.grainCanvas) {
        this.grainCtx.clearRect(0, 0, this.grainCanvas.width, this.grainCanvas.height)
      }
    }
  }
  
  private updateVignette(): void {
    if (!this.vignetteCtx || !this.vignetteCanvas || !this.config.vignetteEnabled) {
      if (this.vignetteCtx && this.vignetteCanvas) {
        this.vignetteCtx.clearRect(0, 0, this.vignetteCanvas.width, this.vignetteCanvas.height)
      }
      return
    }
    
    const W = window.innerWidth
    const H = window.innerHeight
    const centerX = W / 2
    const centerY = H / 2
    const maxRadius = Math.sqrt(W * W + H * H) / 2
    const radius = maxRadius * (0.5 + this.config.vignetteSize * 0.5)
    
    // Create radial gradient (white to transparent)
    // Using multiply blend mode, so white = no darkening, black = full darkening
    const gradient = this.vignetteCtx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius)
    gradient.addColorStop(0, `rgba(255, 255, 255, 0)`) // Center: no darkening
    gradient.addColorStop(0.7, `rgba(255, 255, 255, ${1 - this.config.vignetteIntensity * 0.5})`) // Gradual
    gradient.addColorStop(1, `rgba(255, 255, 255, ${1 - this.config.vignetteIntensity})`) // Edges: subtle darkening
    
    this.vignetteCtx.clearRect(0, 0, W, H)
    this.vignetteCtx.fillStyle = gradient
    this.vignetteCtx.fillRect(0, 0, W, H)
  }
  
  private updateGrainPattern(): void {
    if (!this.grainCtx) return
    
    // Create grain pattern
    const patternSize = this.config.grainSize * 2
    const patternCanvas = document.createElement('canvas')
    patternCanvas.width = patternSize
    patternCanvas.height = patternSize
    const patternCtx = patternCanvas.getContext('2d')
    
    if (patternCtx) {
      const imageData = patternCtx.createImageData(patternSize, patternSize)
      const data = imageData.data
      
      for (let i = 0; i < data.length; i += 4) {
        const value = Math.random() * 255
        data[i] = value // R
        data[i + 1] = value // G
        data[i + 2] = value // B
        data[i + 3] = 255 // A
      }
      
      patternCtx.putImageData(imageData, 0, 0)
      this.grainPattern = this.grainCtx.createPattern(patternCanvas, 'repeat')
    }
  }
  
  private animateGrain = (): void => {
    if (!this.grainCtx || !this.grainCanvas || !this.config.grainEnabled) {
      this.grainRafId = null
      return
    }
    
    const W = window.innerWidth
    const H = window.innerHeight
    
    // Clear and redraw grain with slight offset for animation
    this.grainCtx.clearRect(0, 0, W, H)
    
    if (this.grainPattern) {
      const offset = (performance.now() * 0.1) % (this.config.grainSize * 2)
      this.grainCtx.save()
      this.grainCtx.translate(offset, offset)
      this.grainCtx.fillStyle = this.grainPattern
      this.grainCtx.globalAlpha = this.config.grainIntensity
      this.grainCtx.fillRect(-offset, -offset, W + offset, H + offset)
      this.grainCtx.restore()
    }
    
    this.grainRafId = requestAnimationFrame(this.animateGrain)
  }
  
  destroy(): void {
    if (this.grainRafId) {
      cancelAnimationFrame(this.grainRafId)
      this.grainRafId = null
    }
    
    if (this.vignetteCanvas && this.vignetteCanvas.parentNode) {
      this.vignetteCanvas.parentNode.removeChild(this.vignetteCanvas)
    }
    if (this.grainCanvas && this.grainCanvas.parentNode) {
      this.grainCanvas.parentNode.removeChild(this.grainCanvas)
    }
    
    this.vignetteCanvas = null
    this.vignetteCtx = null
    this.grainCanvas = null
    this.grainCtx = null
    this.grainPattern = null
  }
}
