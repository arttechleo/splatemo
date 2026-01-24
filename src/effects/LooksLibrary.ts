/**
 * Looks Library
 * Curated set of 4-6 "Looks" that can be toggled from Effects UI.
 * Subtle, tasteful overlays that don't reduce readability or dim the splat.
 */

export type LookType = 'clean' | 'film-grain' | 'bloom-hint' | 'chromatic-whisper' | 'light-leak-sweep' | 'vhs-soft'

export interface LookConfig {
  type: LookType
  intensity: number // 0-1
  enabled: boolean
}

const DEFAULT_LOOK: LookConfig = {
  type: 'clean',
  intensity: 0,
  enabled: false,
}

export class LooksLibrary {
  private container: HTMLElement
  private currentLook: LookConfig = { ...DEFAULT_LOOK }
  
  // Overlay canvases
  private grainCanvas: HTMLCanvasElement | null = null
  private grainCtx: CanvasRenderingContext2D | null = null
  private grainRafId: number | null = null
  
  private bloomCanvas: HTMLCanvasElement | null = null
  private bloomCtx: CanvasRenderingContext2D | null = null
  private bloomRafId: number | null = null
  
  private chromaticCanvas: HTMLCanvasElement | null = null
  private chromaticCtx: CanvasRenderingContext2D | null = null
  private chromaticRafId: number | null = null
  
  private lightLeakCanvas: HTMLCanvasElement | null = null
  private lightLeakCtx: CanvasRenderingContext2D | null = null
  private lightLeakActive = false
  private lightLeakStartTime = 0
  private lightLeakDirection: 'up' | 'down' = 'down'
  
  private vhsCanvas: HTMLCanvasElement | null = null
  private vhsCtx: CanvasRenderingContext2D | null = null
  private vhsRafId: number | null = null
  
  // Source canvas for effects that need it
  private sourceCanvas: HTMLCanvasElement | null = null
  
  constructor(container: HTMLElement) {
    this.container = container
    this.createOverlays()
  }
  
  private createOverlays(): void {
    // Film Grain overlay
    this.createGrainOverlay()
    
    // Bloom Hint overlay
    this.createBloomOverlay()
    
    // Chromatic Whisper overlay
    this.createChromaticOverlay()
    
    // Light Leak Sweep overlay
    this.createLightLeakOverlay()
    
    // VHS Soft overlay
    this.createVHSOverlay()
  }
  
  private createGrainOverlay(): void {
    this.grainCanvas = document.createElement('canvas')
    this.grainCanvas.className = 'look-grain'
    this.grainCanvas.style.position = 'fixed'
    this.grainCanvas.style.top = '0'
    this.grainCanvas.style.left = '0'
    this.grainCanvas.style.width = '100%'
    this.grainCanvas.style.height = '100%'
    this.grainCanvas.style.pointerEvents = 'none'
    this.grainCanvas.style.zIndex = '11' // Above depth drift
    this.grainCanvas.style.opacity = '1'
    this.grainCanvas.style.mixBlendMode = 'overlay'
    
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    this.grainCanvas.width = window.innerWidth * dpr
    this.grainCanvas.height = window.innerHeight * dpr
    
    this.grainCtx = this.grainCanvas.getContext('2d', { alpha: true })
    if (this.grainCtx) {
      this.grainCtx.scale(dpr, dpr)
    }
    
    this.container.appendChild(this.grainCanvas)
    window.addEventListener('resize', () => this.resizeGrain())
  }
  
  private createBloomOverlay(): void {
    this.bloomCanvas = document.createElement('canvas')
    this.bloomCanvas.className = 'look-bloom'
    this.bloomCanvas.style.position = 'fixed'
    this.bloomCanvas.style.top = '0'
    this.bloomCanvas.style.left = '0'
    this.bloomCanvas.style.width = '100%'
    this.bloomCanvas.style.height = '100%'
    this.bloomCanvas.style.pointerEvents = 'none'
    this.bloomCanvas.style.zIndex = '11'
    this.bloomCanvas.style.opacity = '1'
    this.bloomCanvas.style.mixBlendMode = 'screen'
    
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    this.bloomCanvas.width = window.innerWidth * dpr
    this.bloomCanvas.height = window.innerHeight * dpr
    
    this.bloomCtx = this.bloomCanvas.getContext('2d', { alpha: true })
    if (this.bloomCtx) {
      this.bloomCtx.scale(dpr, dpr)
    }
    
    this.container.appendChild(this.bloomCanvas)
    window.addEventListener('resize', () => this.resizeBloom())
  }
  
  private createChromaticOverlay(): void {
    this.chromaticCanvas = document.createElement('canvas')
    this.chromaticCanvas.className = 'look-chromatic'
    this.chromaticCanvas.style.position = 'fixed'
    this.chromaticCanvas.style.top = '0'
    this.chromaticCanvas.style.left = '0'
    this.chromaticCanvas.style.width = '100%'
    this.chromaticCanvas.style.height = '100%'
    this.chromaticCanvas.style.pointerEvents = 'none'
    this.chromaticCanvas.style.zIndex = '11'
    this.chromaticCanvas.style.opacity = '1'
    
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    this.chromaticCanvas.width = window.innerWidth * dpr
    this.chromaticCanvas.height = window.innerHeight * dpr
    
    this.chromaticCtx = this.chromaticCanvas.getContext('2d', { alpha: true })
    if (this.chromaticCtx) {
      this.chromaticCtx.scale(dpr, dpr)
    }
    
    this.container.appendChild(this.chromaticCanvas)
    window.addEventListener('resize', () => this.resizeChromatic())
  }
  
  private createLightLeakOverlay(): void {
    this.lightLeakCanvas = document.createElement('canvas')
    this.lightLeakCanvas.className = 'look-light-leak'
    this.lightLeakCanvas.style.position = 'fixed'
    this.lightLeakCanvas.style.top = '0'
    this.lightLeakCanvas.style.left = '0'
    this.lightLeakCanvas.style.width = '100%'
    this.lightLeakCanvas.style.height = '100%'
    this.lightLeakCanvas.style.pointerEvents = 'none'
    this.lightLeakCanvas.style.zIndex = '11'
    this.lightLeakCanvas.style.opacity = '1'
    this.lightLeakCanvas.style.mixBlendMode = 'screen'
    
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    this.lightLeakCanvas.width = window.innerWidth * dpr
    this.lightLeakCanvas.height = window.innerHeight * dpr
    
    this.lightLeakCtx = this.lightLeakCanvas.getContext('2d', { alpha: true })
    if (this.lightLeakCtx) {
      this.lightLeakCtx.scale(dpr, dpr)
    }
    
    this.container.appendChild(this.lightLeakCanvas)
    window.addEventListener('resize', () => this.resizeLightLeak())
  }
  
  private createVHSOverlay(): void {
    this.vhsCanvas = document.createElement('canvas')
    this.vhsCanvas.className = 'look-vhs'
    this.vhsCanvas.style.position = 'fixed'
    this.vhsCanvas.style.top = '0'
    this.vhsCanvas.style.left = '0'
    this.vhsCanvas.style.width = '100%'
    this.vhsCanvas.style.height = '100%'
    this.vhsCanvas.style.pointerEvents = 'none'
    this.vhsCanvas.style.zIndex = '11'
    this.vhsCanvas.style.opacity = '1'
    
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    this.vhsCanvas.width = window.innerWidth * dpr
    this.vhsCanvas.height = window.innerHeight * dpr
    
    this.vhsCtx = this.vhsCanvas.getContext('2d', { alpha: true })
    if (this.vhsCtx) {
      this.vhsCtx.scale(dpr, dpr)
    }
    
    this.container.appendChild(this.vhsCanvas)
    window.addEventListener('resize', () => this.resizeVHS())
  }
  
  private resizeGrain(): void {
    if (!this.grainCanvas || !this.grainCtx) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    this.grainCanvas.width = window.innerWidth * dpr
    this.grainCanvas.height = window.innerHeight * dpr
    this.grainCtx.setTransform(1, 0, 0, 1, 0, 0)
    this.grainCtx.scale(dpr, dpr)
  }
  
  private resizeBloom(): void {
    if (!this.bloomCanvas || !this.bloomCtx) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    this.bloomCanvas.width = window.innerWidth * dpr
    this.bloomCanvas.height = window.innerHeight * dpr
    this.bloomCtx.setTransform(1, 0, 0, 1, 0, 0)
    this.bloomCtx.scale(dpr, dpr)
  }
  
  private resizeChromatic(): void {
    if (!this.chromaticCanvas || !this.chromaticCtx) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    this.chromaticCanvas.width = window.innerWidth * dpr
    this.chromaticCanvas.height = window.innerHeight * dpr
    this.chromaticCtx.setTransform(1, 0, 0, 1, 0, 0)
    this.chromaticCtx.scale(dpr, dpr)
  }
  
  private resizeLightLeak(): void {
    if (!this.lightLeakCanvas || !this.lightLeakCtx) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    this.lightLeakCanvas.width = window.innerWidth * dpr
    this.lightLeakCanvas.height = window.innerHeight * dpr
    this.lightLeakCtx.setTransform(1, 0, 0, 1, 0, 0)
    this.lightLeakCtx.scale(dpr, dpr)
  }
  
  private resizeVHS(): void {
    if (!this.vhsCanvas || !this.vhsCtx) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    this.vhsCanvas.width = window.innerWidth * dpr
    this.vhsCanvas.height = window.innerHeight * dpr
    this.vhsCtx.setTransform(1, 0, 0, 1, 0, 0)
    this.vhsCtx.scale(dpr, dpr)
  }
  
  setSourceCanvas(canvas: HTMLCanvasElement | null): void {
    this.sourceCanvas = canvas
  }
  
  setLook(look: LookConfig): void {
    this.currentLook = { ...look }
    this.updateLook()
  }
  
  getCurrentLook(): LookConfig {
    return { ...this.currentLook }
  }
  
  private updateLook(): void {
    // Stop all animations
    this.stopAll()
    
    if (!this.currentLook.enabled || this.currentLook.type === 'clean') {
      return
    }
    
    // Start selected look
    switch (this.currentLook.type) {
      case 'film-grain':
        this.startGrain()
        break
      case 'bloom-hint':
        this.startBloom()
        break
      case 'chromatic-whisper':
        this.startChromatic()
        break
      case 'light-leak-sweep':
        // Light leak is triggered on transitions, not continuous
        break
      case 'vhs-soft':
        this.startVHS()
        break
    }
  }
  
  private stopAll(): void {
    if (this.grainRafId) {
      cancelAnimationFrame(this.grainRafId)
      this.grainRafId = null
    }
    if (this.bloomRafId) {
      cancelAnimationFrame(this.bloomRafId)
      this.bloomRafId = null
    }
    if (this.chromaticRafId) {
      cancelAnimationFrame(this.chromaticRafId)
      this.chromaticRafId = null
    }
    if (this.vhsRafId) {
      cancelAnimationFrame(this.vhsRafId)
      this.vhsRafId = null
    }
    
    // Clear all canvases
    if (this.grainCtx && this.grainCanvas) {
      this.grainCtx.clearRect(0, 0, this.grainCanvas.width, this.grainCanvas.height)
    }
    if (this.bloomCtx && this.bloomCanvas) {
      this.bloomCtx.clearRect(0, 0, this.bloomCanvas.width, this.bloomCanvas.height)
    }
    if (this.chromaticCtx && this.chromaticCanvas) {
      this.chromaticCtx.clearRect(0, 0, this.chromaticCanvas.width, this.chromaticCanvas.height)
    }
    if (this.lightLeakCtx && this.lightLeakCanvas) {
      this.lightLeakCtx.clearRect(0, 0, this.lightLeakCanvas.width, this.lightLeakCanvas.height)
    }
    if (this.vhsCtx && this.vhsCanvas) {
      this.vhsCtx.clearRect(0, 0, this.vhsCanvas.width, this.vhsCanvas.height)
    }
  }
  
  /**
   * Film Grain: subtle animated grain (very low intensity).
   * Throttled to 12-20fps for performance.
   */
  private startGrain(): void {
    if (!this.grainCtx || !this.grainCanvas) return
    
    const intensity = this.currentLook.intensity * 0.1 // Very low intensity
    let lastUpdate = 0
    const targetFPS = 15 // Throttle to 15fps (between 12-20fps range)
    const targetFrameTime = 1000 / targetFPS
    
    const animate = () => {
      if (this.currentLook.type !== 'film-grain' || !this.currentLook.enabled) {
        this.grainRafId = null
        return
      }
      
      const now = performance.now()
      const elapsed = now - lastUpdate
      
      // Throttle: only update at target FPS (12-20fps range)
      if (elapsed < targetFrameTime) {
        this.grainRafId = requestAnimationFrame(animate)
        return
      }
      
      lastUpdate = now
      
      const W = window.innerWidth
      const H = window.innerHeight
      
      this.grainCtx!.clearRect(0, 0, W, H)
      
      // Create grain pattern
      const imageData = this.grainCtx!.createImageData(W, H)
      const data = imageData.data
      
      for (let i = 0; i < data.length; i += 4) {
        const value = Math.random() * 255
        const alpha = intensity * 0.15 // Very subtle
        data[i] = value // R
        data[i + 1] = value // G
        data[i + 2] = value // B
        data[i + 3] = alpha * 255 // A
      }
      
      this.grainCtx!.putImageData(imageData, 0, 0)
      this.grainRafId = requestAnimationFrame(animate)
    }
    
    animate()
  }
  
  /**
   * Bloom Hint: soft highlight lift on bright areas (fake bloom via overlay).
   */
  private startBloom(): void {
    if (!this.bloomCtx || !this.bloomCanvas) return
    
    const intensity = this.currentLook.intensity * 0.2
    
    const animate = () => {
      if (this.currentLook.type !== 'bloom-hint' || !this.currentLook.enabled) {
        this.bloomRafId = null
        return
      }
      
      const W = window.innerWidth
      const H = window.innerHeight
      
      if (!this.sourceCanvas) {
        this.bloomRafId = requestAnimationFrame(animate)
        return
      }
      
      try {
        // Sample bright areas from source canvas
        const tempCanvas = document.createElement('canvas')
        tempCanvas.width = W * 0.5 // Downsampled
        tempCanvas.height = H * 0.5
        const tempCtx = tempCanvas.getContext('2d')
        
        if (tempCtx) {
          tempCtx.drawImage(this.sourceCanvas, 0, 0, W * 0.5, H * 0.5)
          const imageData = tempCtx.getImageData(0, 0, W * 0.5, H * 0.5)
          const data = imageData.data
          
          this.bloomCtx!.clearRect(0, 0, W, H)
          
          // Create radial gradients at bright points
          for (let i = 0; i < data.length; i += 16) { // Sample every 4 pixels
            const r = data[i]
            const g = data[i + 1]
            const b = data[i + 2]
            const brightness = (r + g + b) / 3
            
            if (brightness > 200) { // Bright pixels only
              const px = ((i / 4) % (W * 0.5)) * 2
              const py = Math.floor((i / 4) / (W * 0.5)) * 2
              
              const gradient = this.bloomCtx!.createRadialGradient(px, py, 0, px, py, 40)
              gradient.addColorStop(0, `rgba(255, 255, 255, ${intensity * 0.3})`)
              gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
              
              this.bloomCtx!.fillStyle = gradient
              this.bloomCtx!.fillRect(px - 40, py - 40, 80, 80)
            }
          }
        }
      } catch {
        // Fallback: skip bloom if sampling fails
      }
      
      this.bloomRafId = requestAnimationFrame(animate)
    }
    
    // Lower frequency for performance
    const interval = setInterval(() => {
      animate()
    }, 100) // 10 FPS
  }
  
  /**
   * Chromatic Whisper: extremely subtle RGB split at edges during motion only.
   */
  private startChromatic(): void {
    if (!this.chromaticCtx || !this.chromaticCanvas) return
    
    // Chromatic is motion-based, so we'll only show it during transitions
    // For now, keep it disabled when idle (as per requirements)
    // This will be triggered externally during feed transitions
  }
  
  /**
   * Trigger chromatic aberration during motion.
   */
  triggerChromatic(direction: 'up' | 'down', duration: number = 700): void {
    if (this.currentLook.type !== 'chromatic-whisper' || !this.currentLook.enabled) return
    if (!this.chromaticCtx || !this.chromaticCanvas) return
    
    const intensity = this.currentLook.intensity * 0.08 // Extremely subtle
    const W = window.innerWidth
    const H = window.innerHeight
    const startTime = performance.now()
    
    const animate = () => {
      const elapsed = performance.now() - startTime
      if (elapsed > duration) {
        this.chromaticCtx!.clearRect(0, 0, W, H)
        return
      }
      
      const progress = elapsed / duration
      const eased = 1 - Math.pow(1 - progress, 3) // Ease out
      
      this.chromaticCtx!.clearRect(0, 0, W, H)
      
      // Subtle RGB split at edges only
      const offset = intensity * 2 * (1 - eased) // Fade out
      
      // Left edge: red shift
      this.chromaticCtx!.save()
      this.chromaticCtx!.globalCompositeOperation = 'screen'
      this.chromaticCtx!.fillStyle = `rgba(255, 0, 0, ${intensity * (1 - eased)})`
      this.chromaticCtx!.fillRect(0, 0, W * 0.1, H) // Left 10%
      this.chromaticCtx!.restore()
      
      // Right edge: blue shift
      this.chromaticCtx!.save()
      this.chromaticCtx!.globalCompositeOperation = 'screen'
      this.chromaticCtx!.fillStyle = `rgba(0, 0, 255, ${intensity * (1 - eased)})`
      this.chromaticCtx!.fillRect(W * 0.9, 0, W * 0.1, H) // Right 10%
      this.chromaticCtx!.restore()
      
      requestAnimationFrame(animate)
    }
    
    animate()
  }
  
  /**
   * Trigger light leak sweep during feed transition.
   * Throttled to 12-20fps for performance.
   */
  triggerLightLeak(direction: 'up' | 'down'): void {
    if (this.currentLook.type !== 'light-leak-sweep' || !this.currentLook.enabled) return
    if (!this.lightLeakCtx || !this.lightLeakCanvas) return
    
    this.lightLeakActive = true
    this.lightLeakDirection = direction
    this.lightLeakStartTime = performance.now()
    
    const W = window.innerWidth
    const H = window.innerHeight
    const duration = 700
    const targetFPS = 15 // Throttle to 15fps (between 12-20fps range)
    const targetFrameTime = 1000 / targetFPS
    let lastUpdate = performance.now()
    
    const animate = () => {
      const now = performance.now()
      const elapsed = now - this.lightLeakStartTime
      
      if (elapsed > duration || !this.lightLeakActive) {
        this.lightLeakCtx!.clearRect(0, 0, W, H)
        this.lightLeakActive = false
        return
      }
      
      // Throttle: only update at target FPS (12-20fps range)
      if (now - lastUpdate < targetFrameTime) {
        requestAnimationFrame(animate)
        return
      }
      lastUpdate = now
      
      const progress = elapsed / duration
      const eased = 1 - Math.pow(1 - progress, 2) // Ease out
      
      this.lightLeakCtx!.clearRect(0, 0, W, H)
      
      // Light leak sweep from edge
      const intensity = this.currentLook.intensity * 0.15
      const leakY = direction === 'down' ? H * eased : H * (1 - eased)
      const leakWidth = W * 0.3
      const leakHeight = H * 0.2
      
      const gradient = this.lightLeakCtx!.createLinearGradient(
        W / 2 - leakWidth / 2, leakY,
        W / 2 + leakWidth / 2, leakY
      )
      gradient.addColorStop(0, `rgba(255, 255, 200, 0)`)
      gradient.addColorStop(0.5, `rgba(255, 255, 200, ${intensity})`)
      gradient.addColorStop(1, `rgba(255, 255, 200, 0)`)
      
      this.lightLeakCtx!.fillStyle = gradient
      this.lightLeakCtx!.fillRect(W / 2 - leakWidth / 2, leakY - leakHeight / 2, leakWidth, leakHeight)
      
      requestAnimationFrame(animate)
    }
    
    animate()
  }
  
  /**
   * VHS Soft: tiny scanline + softness, but keep it clean.
   */
  private startVHS(): void {
    if (!this.vhsCtx || !this.vhsCanvas) return
    
    const intensity = this.currentLook.intensity * 0.12
    const W = window.innerWidth
    const H = window.innerHeight
    
    const animate = () => {
      if (this.currentLook.type !== 'vhs-soft' || !this.currentLook.enabled) {
        this.vhsRafId = null
        return
      }
      
      this.vhsCtx!.clearRect(0, 0, W, H)
      
      // Subtle scanlines (every 4 pixels)
      this.vhsCtx!.save()
      this.vhsCtx!.globalAlpha = intensity
      this.vhsCtx!.strokeStyle = 'rgba(0, 0, 0, 0.1)'
      this.vhsCtx!.lineWidth = 1
      
      for (let y = 0; y < H; y += 4) {
        this.vhsCtx!.beginPath()
        this.vhsCtx!.moveTo(0, y)
        this.vhsCtx!.lineTo(W, y)
        this.vhsCtx!.stroke()
      }
      
      this.vhsCtx!.restore()
      
      this.vhsRafId = requestAnimationFrame(animate)
    }
    
    animate()
  }
  
  destroy(): void {
    this.stopAll()
    
    const canvases = [
      this.grainCanvas,
      this.bloomCanvas,
      this.chromaticCanvas,
      this.lightLeakCanvas,
      this.vhsCanvas,
    ]
    
    canvases.forEach(canvas => {
      if (canvas && canvas.parentNode) {
        canvas.parentNode.removeChild(canvas)
      }
    })
    
    this.grainCanvas = null
    this.grainCtx = null
    this.bloomCanvas = null
    this.bloomCtx = null
    this.chromaticCanvas = null
    this.chromaticCtx = null
    this.lightLeakCanvas = null
    this.lightLeakCtx = null
    this.vhsCanvas = null
    this.vhsCtx = null
  }
}
