/**
 * Interpretive Effects
 * Effects that interpret and emphasize splat characteristics.
 * Density Highlight.
 */

import { EffectGovernor, type ActiveEffect } from './EffectGovernor'
import { SplatTransitionOverlay } from '../transitions/SplatTransitionOverlay'

export class InterpretiveEffects {
  private overlay: SplatTransitionOverlay
  private sourceCanvas: HTMLCanvasElement | null = null
  private governor: EffectGovernor
  
  // Density highlight
  private densityHighlightActive = false
  private densityRegions: Array<{ x: number; y: number; density: number }> = []
  
  constructor(overlay: SplatTransitionOverlay, governor: EffectGovernor) {
    this.overlay = overlay
    this.governor = governor
  }
  
  setSourceCanvas(canvas: HTMLCanvasElement | null): void {
    this.sourceCanvas = canvas
  }
  
  /**
   * Activate density highlight (emphasize dense/detail-rich regions).
   */
  activateDensityHighlight(): void {
    if (this.densityHighlightActive || !this.sourceCanvas) return
    
    this.densityHighlightActive = true
    
    // Sample splat to find dense regions
    this.findDenseRegions()
    
    // Highlight dense regions
    for (const region of this.densityRegions.slice(0, 3)) { // Top 3 dense regions
      const bandHeight = 40
      this.overlay.startAudioPulse({
        bandCenterY: region.y,
        bandHeight,
        direction: 'down',
        intensity: 0.4,
        durationMs: 1200,
        sourceCanvas: this.sourceCanvas,
        intensityMultiplier: 1.1,
      })
    }
    
    const effect: ActiveEffect = {
      id: 'interpretive-density',
      type: 'primary',
      priority: 'interpretive',
      intensity: 0.6,
      startTime: performance.now(),
      duration: 2000,
      userTriggered: true, // Triggered by double-tap
      onSuppress: () => {
        this.densityHighlightActive = false
      },
    }
    
    this.governor.registerEffect(effect)
    
    // Auto-deactivate
    setTimeout(() => {
      this.deactivateDensityHighlight()
    }, effect.duration)
  }
  
  deactivateDensityHighlight(): void {
    this.densityHighlightActive = false
    this.governor.unregisterEffect('interpretive-density')
  }
  
  private findDenseRegions(): void {
    if (!this.sourceCanvas) return
    
    try {
      const ctx = this.sourceCanvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return
      
      const W = window.innerWidth
      const H = window.innerHeight
      const sourceW = this.sourceCanvas.width
      const sourceH = this.sourceCanvas.height
      
      // Sample grid (downsampled for performance)
      const gridSize = 20
      const stepX = Math.floor(sourceW / gridSize)
      const stepY = Math.floor(sourceH / gridSize)
      
      this.densityRegions = []
      
      for (let gy = 0; gy < gridSize; gy++) {
        for (let gx = 0; gx < gridSize; gx++) {
          const sx = gx * stepX
          const sy = gy * stepY
          
          // Sample small region
          const sampleSize = Math.min(stepX, stepY, 10)
          const imageData = ctx.getImageData(sx, sy, sampleSize, sampleSize)
          const data = imageData.data
          
          // Calculate density (brightness + alpha)
          let density = 0
          let count = 0
          
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i]
            const g = data[i + 1]
            const b = data[i + 2]
            const a = data[i + 3]
            
            if (a > 10) {
              const brightness = (r + g + b) / 3
              density += brightness * (a / 255)
              count++
            }
          }
          
          if (count > 0) {
            const avgDensity = density / count
            if (avgDensity > 50) { // Threshold for "dense"
              this.densityRegions.push({
                x: (sx / sourceW) * W,
                y: (sy / sourceH) * H,
                density: avgDensity,
              })
            }
          }
        }
      }
      
      // Sort by density
      this.densityRegions.sort((a, b) => b.density - a.density)
    } catch {
      // Sampling failed
    }
  }
  
  destroy(): void {
    this.deactivateDensityHighlight()
  }
}
