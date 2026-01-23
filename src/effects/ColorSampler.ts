/**
 * Color Sampler for Dynamic UI Styling
 * Samples colors from rendered canvas to create contrast-aware UI elements.
 */

export const DEBUG_COLOR_SAMPLER = false

export class ColorSampler {
  private sourceCanvas: HTMLCanvasElement | null = null
  private rafId: number | null = null
  private isActive = false
  private sampleInterval = 200 // Sample every 200ms (5 FPS)
  private lastSampleTime = 0
  
  // Sampled color data
  private sampledColor = { r: 255, g: 255, b: 255 } // Default to white
  private smoothedColor = { r: 255, g: 255, b: 255 }
  private luminance = 1.0 // 0-1, higher = brighter
  private smoothedLuminance = 1.0
  
  // Smoothing
  private readonly COLOR_SMOOTH = 0.15
  private readonly LUMINANCE_SMOOTH = 0.2
  
  // Callback for color updates
  private onColorUpdate: ((data: {
    r: number
    g: number
    b: number
    luminance: number
    contrastStyle: {
      background: string
      border: string
      color: string
      glow: string
    }
  }) => void) | null = null

  constructor(sourceCanvas: HTMLCanvasElement | null) {
    this.sourceCanvas = sourceCanvas
  }

  setSourceCanvas(canvas: HTMLCanvasElement | null): void {
    this.sourceCanvas = canvas
  }

  setOnColorUpdate(callback: (data: {
    r: number
    g: number
    b: number
    luminance: number
    contrastStyle: {
      background: string
      border: string
      color: string
      glow: string
    }
  }) => void): void {
    this.onColorUpdate = callback
  }

  start(): void {
    if (this.isActive) return
    this.isActive = true
    this.sample()
  }

  stop(): void {
    this.isActive = false
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
  }

  /**
   * Sample a region of the canvas (around button position).
   * Returns average color and luminance.
   */
  private sampleCanvasRegion(x: number, y: number, width: number, height: number): { r: number; g: number; b: number; luminance: number } | null {
    if (!this.sourceCanvas) return null

    try {
      const ctx = this.sourceCanvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return null

      // Convert screen coordinates to canvas coordinates
      const canvasX = Math.floor((x / window.innerWidth) * this.sourceCanvas.width)
      const canvasY = Math.floor((y / window.innerHeight) * this.sourceCanvas.height)
      const canvasW = Math.floor((width / window.innerWidth) * this.sourceCanvas.width)
      const canvasH = Math.floor((height / window.innerHeight) * this.sourceCanvas.height)

      // Sample a small region
      const sampleSize = Math.min(canvasW, canvasH, 40) // Sample up to 40px region
      const sampleX = Math.max(0, canvasX - sampleSize / 2)
      const sampleY = Math.max(0, canvasY - sampleSize / 2)
      const sampleW = Math.min(sampleSize, this.sourceCanvas.width - sampleX)
      const sampleH = Math.min(sampleSize, this.sourceCanvas.height - sampleY)

      if (sampleW <= 0 || sampleH <= 0) return null

      const imageData = ctx.getImageData(sampleX, sampleY, sampleW, sampleH)
      const data = imageData.data

      // Calculate average color
      let rSum = 0
      let gSum = 0
      let bSum = 0
      let count = 0

      // Sample every 4th pixel for performance
      for (let i = 0; i < data.length; i += 16) {
        const r = data[i]
        const g = data[i + 1]
        const b = data[i + 2]
        const a = data[i + 3]

        // Only count visible pixels
        if (a > 10) {
          rSum += r
          gSum += g
          bSum += b
          count++
        }
      }

      if (count === 0) return null

      const r = Math.floor(rSum / count)
      const g = Math.floor(gSum / count)
      const b = Math.floor(bSum / count)

      // Calculate luminance (perceived brightness)
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255

      return { r, g, b, luminance }
    } catch (error) {
      console.warn('[COLOR_SAMPLER] Sampling error', error)
      return null
    }
  }

  /**
   * Compute contrast-aware style based on sampled color.
   * RGB parameters are for future use; currently only luminance is used.
   */
  private computeContrastStyle(_r: number, _g: number, _b: number, luminance: number): {
    background: string
    border: string
    color: string
    glow: string
  } {
    // If background is bright, use dark button; if dark, use light button
    const isBright = luminance > 0.5

    if (isBright) {
      // Dark button with light border
      return {
        background: 'rgba(20, 20, 25, 0.9)',
        border: 'rgba(255, 255, 255, 0.4)',
        color: 'rgba(255, 255, 255, 0.95)',
        glow: '0 0 20px rgba(255, 255, 255, 0.3)',
      }
    } else {
      // Light button with dark border
      return {
        background: 'rgba(255, 255, 255, 0.95)',
        border: 'rgba(0, 0, 0, 0.3)',
        color: 'rgba(0, 0, 0, 0.9)',
        glow: '0 0 20px rgba(255, 255, 255, 0.5)',
      }
    }
  }

  private sample = (): void => {
    if (!this.isActive) return

    const now = performance.now()
    if (now - this.lastSampleTime < this.sampleInterval) {
      this.rafId = requestAnimationFrame(this.sample)
      return
    }
    this.lastSampleTime = now

    // Sample region around bottom center (where Recenter button is)
    const buttonX = window.innerWidth / 2
    const buttonY = window.innerHeight - 100 // Approximate button position
    const sampleWidth = 120
    const sampleHeight = 80

    const sample = this.sampleCanvasRegion(buttonX, buttonY, sampleWidth, sampleHeight)

    if (sample) {
      // Smooth color
      this.smoothedColor.r += (sample.r - this.smoothedColor.r) * this.COLOR_SMOOTH
      this.smoothedColor.g += (sample.g - this.smoothedColor.g) * this.COLOR_SMOOTH
      this.smoothedColor.b += (sample.b - this.smoothedColor.b) * this.COLOR_SMOOTH

      // Smooth luminance
      this.smoothedLuminance += (sample.luminance - this.smoothedLuminance) * this.LUMINANCE_SMOOTH

      this.sampledColor = {
        r: Math.round(this.smoothedColor.r),
        g: Math.round(this.smoothedColor.g),
        b: Math.round(this.smoothedColor.b),
      }
      this.luminance = this.smoothedLuminance

      // Compute contrast style (using luminance, not individual RGB)
      const contrastStyle = this.computeContrastStyle(
        0, // r not used in computeContrastStyle
        0, // g not used in computeContrastStyle
        0, // b not used in computeContrastStyle
        this.luminance
      )

      // Notify callback
      if (this.onColorUpdate) {
        this.onColorUpdate({
          r: this.sampledColor.r,
          g: this.sampledColor.g,
          b: this.sampledColor.b,
          luminance: this.luminance,
          contrastStyle,
        })
      }

      if (DEBUG_COLOR_SAMPLER) {
        let debugEl = document.getElementById('color-sampler-debug')
        if (!debugEl) {
          debugEl = document.createElement('div')
          debugEl.id = 'color-sampler-debug'
          debugEl.style.position = 'fixed'
          debugEl.style.top = '160px'
          debugEl.style.left = '10px'
          debugEl.style.background = 'rgba(0, 0, 0, 0.7)'
          debugEl.style.color = '#fff'
          debugEl.style.padding = '10px'
          debugEl.style.fontFamily = 'monospace'
          debugEl.style.fontSize = '12px'
          debugEl.style.zIndex = '1000'
          debugEl.style.pointerEvents = 'none'
          document.body.appendChild(debugEl)
        }
        debugEl.innerHTML = `
          <div>RGB: ${this.sampledColor.r}, ${this.sampledColor.g}, ${this.sampledColor.b}</div>
          <div>Luminance: ${this.luminance.toFixed(3)}</div>
          <div>Bright: ${this.luminance > 0.5 ? 'YES' : 'NO'}</div>
        `
      }
    }

    this.rafId = requestAnimationFrame(this.sample)
  }

  destroy(): void {
    this.stop()
  }
}
