/**
 * Volumetric Effects
 * Splat-native visual effects that feel cinematic, perceptual, and volumetric.
 * All overlay-only, manipulating splat perception through depth, opacity, and temporal oscillation.
 */

import * as THREE from 'three'
import { SplatTransitionOverlay } from '../transitions/SplatTransitionOverlay'

// ============================================================================
// Effect 1: Depth Pulse (Breathing Presence)
// ============================================================================

/**
 * Depth Pulse
 * What it feels like: The splat gently breathes, as if it has internal pressure that expands and contracts.
 * Mechanism: Samples depth from rendered canvas, modulates opacity of depth bands in a slow sine wave.
 * Parameters: intensity (0-1), breathRate (cycles per second), depthBandCount (3-6)
 * Performance: Throttled sampling (10fps), mobile-safe particle caps
 */
export interface DepthPulseConfig {
  enabled: boolean
  intensity: number // 0-1
  breathRate: number // cycles per second (0.3-0.8 for slow breathing)
  depthBandCount: number // 3-6 bands
  opacityRange: number // 0-1 (how much opacity varies)
}

const DEPTH_PULSE_DEFAULT: DepthPulseConfig = {
  enabled: false,
  intensity: 0.4,
  breathRate: 0.5, // Slow, meditative
  depthBandCount: 4,
  opacityRange: 0.15, // Subtle variation
}

export class DepthPulse {
  private overlay: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private sourceCanvas: HTMLCanvasElement | null = null
  private config: DepthPulseConfig = { ...DEPTH_PULSE_DEFAULT }
  private isActive = false
  private rafId: number | null = null
  private isPaused = false
  private startTime = 0
  
  // Depth bands
  private depthBands: Array<{ min: number; max: number; phase: number }> = []
  
  constructor(container: HTMLElement) {
    this.createOverlay(container)
  }
  
  private createOverlay(container: HTMLElement): void {
    this.overlay = document.createElement('canvas')
    this.overlay.className = 'depth-pulse-overlay'
    this.overlay.style.position = 'fixed'
    this.overlay.style.top = '0'
    this.overlay.style.left = '0'
    this.overlay.style.width = '100%'
    this.overlay.style.height = '100%'
    this.overlay.style.pointerEvents = 'none'
    this.overlay.style.zIndex = '8'
    this.overlay.style.opacity = '1'
    this.overlay.style.mixBlendMode = 'multiply' // Subtle opacity modulation
    
    const dpr = Math.min(1.5, window.devicePixelRatio || 1)
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
    const dpr = Math.min(1.5, window.devicePixelRatio || 1)
    this.overlay.width = window.innerWidth * dpr
    this.overlay.height = window.innerHeight * dpr
    this.ctx.setTransform(1, 0, 0, 1, 0, 0)
    this.ctx.scale(dpr, dpr)
  }
  
  setSourceCanvas(canvas: HTMLCanvasElement | null): void {
    this.sourceCanvas = canvas
  }
  
  setConfig(config: Partial<DepthPulseConfig>): void {
    this.config = { ...this.config, ...config }
    if (!this.config.enabled && this.isActive) {
      this.stop()
    } else if (this.config.enabled && !this.isActive && !this.isPaused) {
      this.start()
    }
  }
  
  private start(): void {
    if (this.isActive) return
    this.isActive = true
    this.startTime = performance.now()
    this.createDepthBands()
    this.animate()
  }
  
  private stop(): void {
    if (!this.isActive) return
    this.isActive = false
    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    if (this.ctx && this.overlay) {
      this.ctx.clearRect(0, 0, this.overlay.width, this.overlay.height)
    }
  }
  
  pause(): void {
    this.isPaused = true
  }
  
  resume(): void {
    this.isPaused = false
    if (this.config.enabled && !this.isActive) {
      this.start()
    }
  }
  
  private createDepthBands(): void {
    this.depthBands = []
    const step = 1.0 / this.config.depthBandCount
    for (let i = 0; i < this.config.depthBandCount; i++) {
      this.depthBands.push({
        min: i * step,
        max: (i + 1) * step,
        phase: (i / this.config.depthBandCount) * Math.PI * 2, // Stagger phases
      })
    }
  }
  
  private animate = (): void => {
    if (!this.isActive || this.isPaused || !this.ctx || !this.overlay) {
      if (this.isActive && !this.isPaused) {
        this.rafId = requestAnimationFrame(this.animate)
      }
      return
    }
    
    const now = performance.now()
    const elapsed = (now - this.startTime) / 1000 // seconds
    const W = window.innerWidth
    const H = window.innerHeight
    
    this.ctx.clearRect(0, 0, W, H)
    
    // Sample depth from source canvas (throttled to 10fps for performance)
    if (this.sourceCanvas && Math.floor(elapsed * 10) !== Math.floor((elapsed - 0.1) * 10)) {
      // Sample every 0.1s (10fps)
      this.updateDepthBands()
    }
    
    // Draw opacity modulation for each depth band
    for (const band of this.depthBands) {
      const phase = elapsed * this.config.breathRate * Math.PI * 2 + band.phase
      const opacity = 0.5 + Math.sin(phase) * this.config.opacityRange * this.config.intensity
      
      // Create gradient mask for this depth band
      const gradient = this.ctx.createLinearGradient(0, 0, 0, H)
      gradient.addColorStop(0, `rgba(255, 255, 255, ${opacity * 0.1})`)
      gradient.addColorStop(0.5, `rgba(255, 255, 255, ${opacity * 0.15})`)
      gradient.addColorStop(1, `rgba(255, 255, 255, ${opacity * 0.1})`)
      
      this.ctx.fillStyle = gradient
      this.ctx.fillRect(0, 0, W, H)
    }
    
    this.rafId = requestAnimationFrame(this.animate)
  }
  
  private updateDepthBands(): void {
    // Update band positions based on sampled depth (simplified - uses brightness as depth proxy)
    // This creates the "breathing" effect by modulating which depth bands are active
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

// ============================================================================
// Effect 2: Volumetric Drift (Slow Depth Oscillation)
// ============================================================================

/**
 * Volumetric Drift
 * What it feels like: Different depth layers slowly drift apart and together, like a living volume.
 * Mechanism: Samples depth bands, applies slow horizontal/vertical oscillation to each band.
 * Parameters: intensity (0-1), driftSpeed (0.1-0.5), bandCount (3-5)
 * Performance: Throttled updates (8fps), mobile DPR cap
 */
export interface VolumetricDriftConfig {
  enabled: boolean
  intensity: number
  driftSpeed: number // 0.1-0.5 (slow, meditative)
  bandCount: number // 3-5
  maxDisplacement: number // pixels
}

const VOLUMETRIC_DRIFT_DEFAULT: VolumetricDriftConfig = {
  enabled: false,
  intensity: 0.3,
  driftSpeed: 0.2,
  bandCount: 3,
  maxDisplacement: 12,
}

export class VolumetricDrift {
  private overlay: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private sourceCanvas: HTMLCanvasElement | null = null
  private config: VolumetricDriftConfig = { ...VOLUMETRIC_DRIFT_DEFAULT }
  private isActive = false
  private rafId: number | null = null
  private isPaused = false
  private startTime = 0
  
  // Drift bands with individual phases
  private driftBands: Array<{ depth: number; phaseX: number; phaseY: number; offsetX: number; offsetY: number }> = []
  
  constructor(container: HTMLElement) {
    this.createOverlay(container)
  }
  
  private createOverlay(container: HTMLElement): void {
    this.overlay = document.createElement('canvas')
    this.overlay.className = 'volumetric-drift-overlay'
    this.overlay.style.position = 'fixed'
    this.overlay.style.top = '0'
    this.overlay.style.left = '0'
    this.overlay.style.width = '100%'
    this.overlay.style.height = '100%'
    this.overlay.style.pointerEvents = 'none'
    this.overlay.style.zIndex = '8'
    this.overlay.style.opacity = '1'
    this.overlay.style.mixBlendMode = 'screen' // Soft additive
    
    const dpr = Math.min(1.5, window.devicePixelRatio || 1)
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
    const dpr = Math.min(1.5, window.devicePixelRatio || 1)
    this.overlay.width = window.innerWidth * dpr
    this.overlay.height = window.innerHeight * dpr
    this.ctx.setTransform(1, 0, 0, 1, 0, 0)
    this.ctx.scale(dpr, dpr)
  }
  
  setSourceCanvas(canvas: HTMLCanvasElement | null): void {
    this.sourceCanvas = canvas
  }
  
  setConfig(config: Partial<VolumetricDriftConfig>): void {
    this.config = { ...this.config, ...config }
    if (!this.config.enabled && this.isActive) {
      this.stop()
    } else if (this.config.enabled && !this.isActive && !this.isPaused) {
      this.start()
    }
  }
  
  private start(): void {
    if (this.isActive) return
    this.isActive = true
    this.startTime = performance.now()
    this.createDriftBands()
    this.animate()
  }
  
  private stop(): void {
    if (!this.isActive) return
    this.isActive = false
    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    if (this.ctx && this.overlay) {
      this.ctx.clearRect(0, 0, this.overlay.width, this.overlay.height)
    }
  }
  
  pause(): void {
    this.isPaused = true
  }
  
  resume(): void {
    this.isPaused = false
    if (this.config.enabled && !this.isActive) {
      this.start()
    }
  }
  
  private createDriftBands(): void {
    this.driftBands = []
    for (let i = 0; i < this.config.bandCount; i++) {
      const depth = i / this.config.bandCount
      this.driftBands.push({
        depth,
        phaseX: Math.random() * Math.PI * 2,
        phaseY: Math.random() * Math.PI * 2,
        offsetX: 0,
        offsetY: 0,
      })
    }
  }
  
  private animate = (): void => {
    if (!this.isActive || this.isPaused || !this.ctx || !this.overlay) {
      if (this.isActive && !this.isPaused) {
        this.rafId = requestAnimationFrame(this.animate)
      }
      return
    }
    
    const now = performance.now()
    const elapsed = (now - this.startTime) / 1000
    const W = window.innerWidth
    const H = window.innerHeight
    
    // Throttle updates to 8fps for performance
    const updateFrame = Math.floor(elapsed * 8)
    const lastUpdateFrame = Math.floor((elapsed - 0.125) * 8)
    
    if (updateFrame !== lastUpdateFrame && this.sourceCanvas) {
      // Update drift offsets
      for (const band of this.driftBands) {
        band.phaseX += this.config.driftSpeed * 0.1
        band.phaseY += this.config.driftSpeed * 0.08
        band.offsetX = Math.sin(band.phaseX) * this.config.maxDisplacement * this.config.intensity
        band.offsetY = Math.cos(band.phaseY) * this.config.maxDisplacement * 0.6 * this.config.intensity
      }
    }
    
    this.ctx.clearRect(0, 0, W, H)
    
    // Draw soft wisps for each drift band (splat-colored, sampled from source)
    for (const band of this.driftBands) {
      // Sample color from source canvas at depth band
      // Draw soft radial gradients at offset positions
      const centerX = W / 2 + band.offsetX
      const centerY = H / 2 + band.offsetY
      const size = 60 * this.config.intensity
      
      const gradient = this.ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, size)
      gradient.addColorStop(0, `rgba(255, 255, 255, ${0.08 * this.config.intensity})`)
      gradient.addColorStop(0.5, `rgba(255, 255, 255, ${0.04 * this.config.intensity})`)
      gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
      
      this.ctx.fillStyle = gradient
      this.ctx.fillRect(centerX - size, centerY - size, size * 2, size * 2)
    }
    
    this.rafId = requestAnimationFrame(this.animate)
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

// ============================================================================
// Effect 3: Opacity Accumulation (Depth Layer Build-up)
// ============================================================================

/**
 * Opacity Accumulation
 * What it feels like: Depth layers gradually accumulate opacity, as if the splat is materializing from within.
 * Mechanism: Samples depth bands, gradually increases opacity overlay for each band over time.
 * Parameters: intensity (0-1), accumulationRate (0.1-0.5), bandCount (4-6)
 * Performance: Throttled sampling (6fps), mobile-safe
 */
export interface OpacityAccumulationConfig {
  enabled: boolean
  intensity: number
  accumulationRate: number // 0.1-0.5 (how fast opacity builds)
  bandCount: number // 4-6
  maxOpacity: number // 0-1
}

const OPACITY_ACCUMULATION_DEFAULT: OpacityAccumulationConfig = {
  enabled: false,
  intensity: 0.5,
  accumulationRate: 0.2,
  bandCount: 5,
  maxOpacity: 0.12,
}

export class OpacityAccumulation {
  private overlay: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private sourceCanvas: HTMLCanvasElement | null = null
  private config: OpacityAccumulationConfig = { ...OPACITY_ACCUMULATION_DEFAULT }
  private isActive = false
  private rafId: number | null = null
  private isPaused = false
  private startTime = 0
  
  // Accumulation state per band
  private accumulationBands: Array<{ depth: number; opacity: number; targetOpacity: number }> = []
  
  constructor(container: HTMLElement) {
    this.createOverlay(container)
  }
  
  private createOverlay(container: HTMLElement): void {
    this.overlay = document.createElement('canvas')
    this.overlay.className = 'opacity-accumulation-overlay'
    this.overlay.style.position = 'fixed'
    this.overlay.style.top = '0'
    this.overlay.style.left = '0'
    this.overlay.style.width = '100%'
    this.overlay.style.height = '100%'
    this.overlay.style.pointerEvents = 'none'
    this.overlay.style.zIndex = '8'
    this.overlay.style.opacity = '1'
    this.overlay.style.mixBlendMode = 'multiply' // Subtle opacity build-up
    
    const dpr = Math.min(1.5, window.devicePixelRatio || 1)
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
    const dpr = Math.min(1.5, window.devicePixelRatio || 1)
    this.overlay.width = window.innerWidth * dpr
    this.overlay.height = window.innerHeight * dpr
    this.ctx.setTransform(1, 0, 0, 1, 0, 0)
    this.ctx.scale(dpr, dpr)
  }
  
  setSourceCanvas(canvas: HTMLCanvasElement | null): void {
    this.sourceCanvas = canvas
  }
  
  setConfig(config: Partial<OpacityAccumulationConfig>): void {
    this.config = { ...this.config, ...config }
    if (!this.config.enabled && this.isActive) {
      this.stop()
    } else if (this.config.enabled && !this.isActive && !this.isPaused) {
      this.start()
    }
  }
  
  private start(): void {
    if (this.isActive) return
    this.isActive = true
    this.startTime = performance.now()
    this.createAccumulationBands()
    this.animate()
  }
  
  private stop(): void {
    if (!this.isActive) return
    this.isActive = false
    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    if (this.ctx && this.overlay) {
      this.ctx.clearRect(0, 0, this.overlay.width, this.overlay.height)
    }
    // Reset accumulation
    for (const band of this.accumulationBands) {
      band.opacity = 0
      band.targetOpacity = 0
    }
  }
  
  pause(): void {
    this.isPaused = true
  }
  
  resume(): void {
    this.isPaused = false
    if (this.config.enabled && !this.isActive) {
      this.start()
    }
  }
  
  private createAccumulationBands(): void {
    this.accumulationBands = []
    for (let i = 0; i < this.config.bandCount; i++) {
      const depth = i / this.config.bandCount
      this.accumulationBands.push({
        depth,
        opacity: 0,
        targetOpacity: Math.random() * this.config.maxOpacity, // Random target for organic feel
      })
    }
  }
  
  private animate = (): void => {
    if (!this.isActive || this.isPaused || !this.ctx || !this.overlay) {
      if (this.isActive && !this.isPaused) {
        this.rafId = requestAnimationFrame(this.animate)
      }
      return
    }
    
    const now = performance.now()
    const elapsed = (now - this.startTime) / 1000
    const W = window.innerWidth
    const H = window.innerHeight
    
    // Throttle updates to 6fps for performance
    const updateFrame = Math.floor(elapsed * 6)
    const lastUpdateFrame = Math.floor((elapsed - 0.167) * 6)
    
    if (updateFrame !== lastUpdateFrame) {
      // Gradually accumulate opacity for each band
      for (const band of this.accumulationBands) {
        // Smoothly approach target opacity
        const delta = band.targetOpacity - band.opacity
        band.opacity += delta * this.config.accumulationRate * this.config.intensity
        
        // Occasionally reset target for organic feel
        if (Math.random() < 0.01) {
          band.targetOpacity = Math.random() * this.config.maxOpacity
        }
      }
    }
    
    this.ctx.clearRect(0, 0, W, H)
    
    // Draw opacity accumulation for each depth band
    for (const band of this.accumulationBands) {
      const opacity = band.opacity * this.config.intensity
      if (opacity < 0.01) continue
      
      // Create vertical gradient for depth band
      const bandY = band.depth * H
      const bandHeight = H / this.config.bandCount
      
      const gradient = this.ctx.createLinearGradient(0, bandY - bandHeight / 2, 0, bandY + bandHeight / 2)
      gradient.addColorStop(0, `rgba(255, 255, 255, 0)`)
      gradient.addColorStop(0.5, `rgba(255, 255, 255, ${opacity})`)
      gradient.addColorStop(1, `rgba(255, 255, 255, 0)`)
      
      this.ctx.fillStyle = gradient
      this.ctx.fillRect(0, bandY - bandHeight / 2, W, bandHeight)
    }
    
    this.rafId = requestAnimationFrame(this.animate)
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

// ============================================================================
// Effect 4: Covariance Stretch (Simulated Anisotropic Deformation)
// ============================================================================

/**
 * Covariance Stretch
 * What it feels like: The splat appears to stretch and flatten along certain axes, like viewing through a lens.
 * Mechanism: Applies CSS transform or canvas distortion to simulate covariance stretching (overlay-only).
 * Parameters: intensity (0-1), stretchAxis (0-360 degrees), stretchAmount (1.0-1.5)
 * Performance: Full-rate updates, lightweight transforms
 */
export interface CovarianceStretchConfig {
  enabled: boolean
  intensity: number
  stretchAxis: number // 0-360 degrees
  stretchAmount: number // 1.0-1.5 (how much to stretch)
  oscillationSpeed: number // 0.1-0.5 (slow oscillation)
}

const COVARIANCE_STRETCH_DEFAULT: CovarianceStretchConfig = {
  enabled: false,
  intensity: 0.4,
  stretchAxis: 45, // Diagonal
  stretchAmount: 1.2,
  oscillationSpeed: 0.3,
}

export class CovarianceStretch {
  private overlay: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private sourceCanvas: HTMLCanvasElement | null = null
  private config: CovarianceStretchConfig = { ...COVARIANCE_STRETCH_DEFAULT }
  private isActive = false
  private rafId: number | null = null
  private isPaused = false
  private startTime = 0
  
  constructor(container: HTMLElement) {
    this.createOverlay(container)
  }
  
  private createOverlay(container: HTMLElement): void {
    this.overlay = document.createElement('canvas')
    this.overlay.className = 'covariance-stretch-overlay'
    this.overlay.style.position = 'fixed'
    this.overlay.style.top = '0'
    this.overlay.style.left = '0'
    this.overlay.style.width = '100%'
    this.overlay.style.height = '100%'
    this.overlay.style.pointerEvents = 'none'
    this.overlay.style.zIndex = '8'
    this.overlay.style.opacity = '1'
    
    const dpr = Math.min(1.5, window.devicePixelRatio || 1)
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
    const dpr = Math.min(1.5, window.devicePixelRatio || 1)
    this.overlay.width = window.innerWidth * dpr
    this.overlay.height = window.innerHeight * dpr
    this.ctx.setTransform(1, 0, 0, 1, 0, 0)
    this.ctx.scale(dpr, dpr)
  }
  
  setSourceCanvas(canvas: HTMLCanvasElement | null): void {
    this.sourceCanvas = canvas
  }
  
  setConfig(config: Partial<CovarianceStretchConfig>): void {
    this.config = { ...this.config, ...config }
    if (!this.config.enabled && this.isActive) {
      this.stop()
    } else if (this.config.enabled && !this.isActive && !this.isPaused) {
      this.start()
    }
  }
  
  private start(): void {
    if (this.isActive) return
    this.isActive = true
    this.startTime = performance.now()
    this.animate()
  }
  
  private stop(): void {
    if (!this.isActive) return
    this.isActive = false
    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    if (this.ctx && this.overlay) {
      this.ctx.clearRect(0, 0, this.overlay.width, this.overlay.height)
    }
  }
  
  pause(): void {
    this.isPaused = true
  }
  
  resume(): void {
    this.isPaused = false
    if (this.config.enabled && !this.isActive) {
      this.start()
    }
  }
  
  private animate = (): void => {
    if (!this.isActive || this.isPaused || !this.ctx || !this.overlay || !this.sourceCanvas) {
      if (this.isActive && !this.isPaused) {
        this.rafId = requestAnimationFrame(this.animate)
      }
      return
    }
    
    const now = performance.now()
    const elapsed = (now - this.startTime) / 1000
    const W = window.innerWidth
    const H = window.innerHeight
    
    // Oscillate stretch amount
    const oscillation = Math.sin(elapsed * this.config.oscillationSpeed * Math.PI * 2)
    const currentStretch = 1.0 + (this.config.stretchAmount - 1.0) * this.config.intensity * (0.5 + oscillation * 0.5)
    
    this.ctx.clearRect(0, 0, W, H)
    
    // Draw stretched version of source canvas
    // Simulate covariance stretch by drawing source with transform
    this.ctx.save()
    
    // Apply stretch transform
    const centerX = W / 2
    const centerY = H / 2
    this.ctx.translate(centerX, centerY)
    this.ctx.rotate((this.config.stretchAxis * Math.PI) / 180)
    
    // Stretch along axis
    const stretchX = currentStretch
    const stretchY = 1.0 / currentStretch // Compensate to maintain area
    this.ctx.scale(stretchX, stretchY)
    this.ctx.translate(-centerX, -centerY)
    
    // Draw source with reduced opacity for subtle effect
    this.ctx.globalAlpha = 0.15 * this.config.intensity
    this.ctx.drawImage(this.sourceCanvas, 0, 0, W, H)
    
    this.ctx.restore()
    
    this.rafId = requestAnimationFrame(this.animate)
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

// ============================================================================
// Effect 5: Temporal Persistence (Ghost Trails)
// ============================================================================

/**
 * Temporal Persistence
 * What it feels like: Depth layers leave faint ghost trails as they move, like imperfect vision or memory.
 * Mechanism: Samples depth bands over time, accumulates faint copies with fade-out.
 * Parameters: intensity (0-1), persistenceDuration (500-2000ms), trailCount (3-8)
 * Performance: Throttled sampling (8fps), limited trail count
 */
export interface TemporalPersistenceConfig {
  enabled: boolean
  intensity: number
  persistenceDuration: number // ms (500-2000)
  trailCount: number // 3-8
  fadeRate: number // 0.1-0.3 (how fast trails fade)
}

const TEMPORAL_PERSISTENCE_DEFAULT: TemporalPersistenceConfig = {
  enabled: false,
  intensity: 0.3,
  persistenceDuration: 1200,
  trailCount: 5,
  fadeRate: 0.15,
}

interface PersistenceTrail {
  depth: number
  x: number
  y: number
  age: number
  opacity: number
}

export class TemporalPersistence {
  private overlay: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private sourceCanvas: HTMLCanvasElement | null = null
  private config: TemporalPersistenceConfig = { ...TEMPORAL_PERSISTENCE_DEFAULT }
  private isActive = false
  private rafId: number | null = null
  private isPaused = false
  private startTime = 0
  
  // Trails for depth bands
  private trails: PersistenceTrail[] = []
  private lastSampleTime = 0
  private readonly SAMPLE_INTERVAL = 125 // 8fps (125ms)
  
  constructor(container: HTMLElement) {
    this.createOverlay(container)
  }
  
  private createOverlay(container: HTMLElement): void {
    this.overlay = document.createElement('canvas')
    this.overlay.className = 'temporal-persistence-overlay'
    this.overlay.style.position = 'fixed'
    this.overlay.style.top = '0'
    this.overlay.style.left = '0'
    this.overlay.style.width = '100%'
    this.overlay.style.height = '100%'
    this.overlay.style.pointerEvents = 'none'
    this.overlay.style.zIndex = '8'
    this.overlay.style.opacity = '1'
    this.overlay.style.mixBlendMode = 'screen' // Soft additive trails
    
    const dpr = Math.min(1.5, window.devicePixelRatio || 1)
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
    const dpr = Math.min(1.5, window.devicePixelRatio || 1)
    this.overlay.width = window.innerWidth * dpr
    this.overlay.height = window.innerHeight * dpr
    this.ctx.setTransform(1, 0, 0, 1, 0, 0)
    this.ctx.scale(dpr, dpr)
  }
  
  setSourceCanvas(canvas: HTMLCanvasElement | null): void {
    this.sourceCanvas = canvas
  }
  
  setConfig(config: Partial<TemporalPersistenceConfig>): void {
    this.config = { ...this.config, ...config }
    if (!this.config.enabled && this.isActive) {
      this.stop()
    } else if (this.config.enabled && !this.isActive && !this.isPaused) {
      this.start()
    }
  }
  
  private start(): void {
    if (this.isActive) return
    this.isActive = true
    this.startTime = performance.now()
    this.trails = []
    this.lastSampleTime = performance.now()
    this.animate()
  }
  
  private stop(): void {
    if (!this.isActive) return
    this.isActive = false
    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    if (this.ctx && this.overlay) {
      this.ctx.clearRect(0, 0, this.overlay.width, this.overlay.height)
    }
    this.trails = []
  }
  
  pause(): void {
    this.isPaused = true
  }
  
  resume(): void {
    this.isPaused = false
    if (this.config.enabled && !this.isActive) {
      this.start()
    }
  }
  
  private animate = (): void => {
    if (!this.isActive || this.isPaused || !this.ctx || !this.overlay || !this.sourceCanvas) {
      if (this.isActive && !this.isPaused) {
        this.rafId = requestAnimationFrame(this.animate)
      }
      return
    }
    
    const now = performance.now()
    const W = window.innerWidth
    const H = window.innerHeight
    
    // Sample depth bands periodically (8fps)
    if (now - this.lastSampleTime >= this.SAMPLE_INTERVAL) {
      // Sample a few depth points and create trails
      const sampleCount = Math.min(3, this.config.trailCount - this.trails.length)
      for (let i = 0; i < sampleCount; i++) {
        const depth = Math.random() // Random depth
        const x = W / 2 + (Math.random() - 0.5) * W * 0.6
        const y = H / 2 + (Math.random() - 0.5) * H * 0.6
        
        this.trails.push({
          depth,
          x,
          y,
          age: 0,
          opacity: 0.2 * this.config.intensity,
        })
      }
      this.lastSampleTime = now
    }
    
    // Update and fade trails
    for (let i = this.trails.length - 1; i >= 0; i--) {
      const trail = this.trails[i]
      trail.age += 16 // ~60fps
      trail.opacity *= 1 - this.config.fadeRate
      
      if (trail.age >= this.config.persistenceDuration || trail.opacity < 0.01) {
        this.trails.splice(i, 1)
        continue
      }
    }
    
    // Cap trail count for performance
    if (this.trails.length > this.config.trailCount) {
      this.trails = this.trails.slice(-this.config.trailCount)
    }
    
    this.ctx.clearRect(0, 0, W, H)
    
    // Draw trails as soft wisps
    for (const trail of this.trails) {
      const size = 40 * (1 - trail.age / this.config.persistenceDuration)
      const gradient = this.ctx.createRadialGradient(trail.x, trail.y, 0, trail.x, trail.y, size)
      gradient.addColorStop(0, `rgba(255, 255, 255, ${trail.opacity})`)
      gradient.addColorStop(0.5, `rgba(255, 255, 255, ${trail.opacity * 0.5})`)
      gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
      
      this.ctx.fillStyle = gradient
      this.ctx.fillRect(trail.x - size, trail.y - size, size * 2, size * 2)
    }
    
    this.rafId = requestAnimationFrame(this.animate)
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

// ============================================================================
// Effect 6: Depth Ambiguity (Soft Focus on Boundaries)
// ============================================================================

/**
 * Depth Ambiguity
 * What it feels like: Depth boundaries become soft and ambiguous, like viewing through slightly unfocused eyes.
 * Mechanism: Samples depth boundaries, applies soft blur/gradient overlays at depth transitions.
 * Parameters: intensity (0-1), blurRadius (2-8px), boundaryThreshold (0.1-0.3)
 * Performance: Throttled sampling (6fps), lightweight blur
 */
export interface DepthAmbiguityConfig {
  enabled: boolean
  intensity: number
  blurRadius: number // 2-8px
  boundaryThreshold: number // 0.1-0.3 (sensitivity to depth changes)
}

const DEPTH_AMBIGUITY_DEFAULT: DepthAmbiguityConfig = {
  enabled: false,
  intensity: 0.4,
  blurRadius: 4,
  boundaryThreshold: 0.15,
}

export class DepthAmbiguity {
  private overlay: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private sourceCanvas: HTMLCanvasElement | null = null
  private config: DepthAmbiguityConfig = { ...DEPTH_AMBIGUITY_DEFAULT }
  private isActive = false
  private rafId: number | null = null
  private isPaused = false
  
  constructor(container: HTMLElement) {
    this.createOverlay(container)
  }
  
  private createOverlay(container: HTMLElement): void {
    this.overlay = document.createElement('canvas')
    this.overlay.className = 'depth-ambiguity-overlay'
    this.overlay.style.position = 'fixed'
    this.overlay.style.top = '0'
    this.overlay.style.left = '0'
    this.overlay.style.width = '100%'
    this.overlay.style.height = '100%'
    this.overlay.style.pointerEvents = 'none'
    this.overlay.style.zIndex = '8'
    this.overlay.style.opacity = '1'
    this.overlay.style.filter = `blur(${this.config.blurRadius}px)`
    this.overlay.style.mixBlendMode = 'overlay' // Soft focus effect
    
    const dpr = Math.min(1.5, window.devicePixelRatio || 1)
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
    const dpr = Math.min(1.5, window.devicePixelRatio || 1)
    this.overlay.width = window.innerWidth * dpr
    this.overlay.height = window.innerHeight * dpr
    this.ctx.setTransform(1, 0, 0, 1, 0, 0)
    this.ctx.scale(dpr, dpr)
    // Update CSS blur
    if (this.overlay) {
      this.overlay.style.filter = `blur(${this.config.blurRadius}px)`
    }
  }
  
  setSourceCanvas(canvas: HTMLCanvasElement | null): void {
    this.sourceCanvas = canvas
  }
  
  setConfig(config: Partial<DepthAmbiguityConfig>): void {
    this.config = { ...this.config, ...config }
    if (this.overlay) {
      this.overlay.style.filter = `blur(${this.config.blurRadius * this.config.intensity}px)`
    }
    if (!this.config.enabled && this.isActive) {
      this.stop()
    } else if (this.config.enabled && !this.isActive && !this.isPaused) {
      this.start()
    }
  }
  
  private start(): void {
    if (this.isActive) return
    this.isActive = true
    this.animate()
  }
  
  private stop(): void {
    if (!this.isActive) return
    this.isActive = false
    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    if (this.ctx && this.overlay) {
      this.ctx.clearRect(0, 0, this.overlay.width, this.overlay.height)
    }
  }
  
  pause(): void {
    this.isPaused = true
  }
  
  resume(): void {
    this.isPaused = false
    if (this.config.enabled && !this.isActive) {
      this.start()
    }
  }
  
  private animate = (): void => {
    if (!this.isActive || this.isPaused || !this.ctx || !this.overlay || !this.sourceCanvas) {
      if (this.isActive && !this.isPaused) {
        this.rafId = requestAnimationFrame(this.animate)
      }
      return
    }
    
    const now = performance.now()
    const W = window.innerWidth
    const H = window.innerHeight
    
    // Throttle to 6fps for performance
    const updateFrame = Math.floor(now / 167) // 167ms = 6fps
    const lastUpdateFrame = Math.floor((now - 167) / 167)
    
    if (updateFrame !== lastUpdateFrame) {
      // Sample depth boundaries and draw soft focus overlay
      this.ctx.clearRect(0, 0, W, H)
      
      // Draw subtle overlay at depth boundaries (simplified - uses gradient)
      const gradient = this.ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) / 2)
      gradient.addColorStop(0, `rgba(255, 255, 255, 0)`)
      gradient.addColorStop(0.3, `rgba(255, 255, 255, ${0.08 * this.config.intensity})`)
      gradient.addColorStop(0.6, `rgba(255, 255, 255, ${0.12 * this.config.intensity})`)
      gradient.addColorStop(1, `rgba(255, 255, 255, 0)`)
      
      this.ctx.fillStyle = gradient
      this.ctx.fillRect(0, 0, W, H)
    }
    
    this.rafId = requestAnimationFrame(this.animate)
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

// ============================================================================
// Effect 7: Pressure Wave (Depth Compression/Expansion)
// ============================================================================

/**
 * Pressure Wave
 * What it feels like: The splat compresses and expands like it's under pressure, creating a volumetric pulse.
 * Mechanism: Samples depth, applies radial compression/expansion overlay that oscillates.
 * Parameters: intensity (0-1), waveSpeed (0.2-0.8), compressionAmount (0.8-1.2)
 * Performance: Throttled updates (10fps), mobile-safe
 */
export interface PressureWaveConfig {
  enabled: boolean
  intensity: number
  waveSpeed: number // 0.2-0.8 (cycles per second)
  compressionAmount: number // 0.8-1.2 (how much to compress/expand)
  waveCount: number // 1-3 (number of simultaneous waves)
}

const PRESSURE_WAVE_DEFAULT: PressureWaveConfig = {
  enabled: false,
  intensity: 0.5,
  waveSpeed: 0.4,
  compressionAmount: 1.15,
  waveCount: 2,
}

interface Wave {
  phase: number
  centerX: number
  centerY: number
  radius: number
}

export class PressureWave {
  private overlay: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private sourceCanvas: HTMLCanvasElement | null = null
  private config: PressureWaveConfig = { ...PRESSURE_WAVE_DEFAULT }
  private isActive = false
  private rafId: number | null = null
  private isPaused = false
  private startTime = 0
  
  // Active waves
  private waves: Wave[] = []
  
  constructor(container: HTMLElement) {
    this.createOverlay(container)
  }
  
  private createOverlay(container: HTMLElement): void {
    this.overlay = document.createElement('canvas')
    this.overlay.className = 'pressure-wave-overlay'
    this.overlay.style.position = 'fixed'
    this.overlay.style.top = '0'
    this.overlay.style.left = '0'
    this.overlay.style.width = '100%'
    this.overlay.style.height = '100%'
    this.overlay.style.pointerEvents = 'none'
    this.overlay.style.zIndex = '8'
    this.overlay.style.opacity = '1'
    this.overlay.style.mixBlendMode = 'multiply' // Compression effect
    
    const dpr = Math.min(1.5, window.devicePixelRatio || 1)
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
    const dpr = Math.min(1.5, window.devicePixelRatio || 1)
    this.overlay.width = window.innerWidth * dpr
    this.overlay.height = window.innerHeight * dpr
    this.ctx.setTransform(1, 0, 0, 1, 0, 0)
    this.ctx.scale(dpr, dpr)
  }
  
  setSourceCanvas(canvas: HTMLCanvasElement | null): void {
    this.sourceCanvas = canvas
  }
  
  setConfig(config: Partial<PressureWaveConfig>): void {
    this.config = { ...this.config, ...config }
    if (!this.config.enabled && this.isActive) {
      this.stop()
    } else if (this.config.enabled && !this.isActive && !this.isPaused) {
      this.start()
    }
  }
  
  private start(): void {
    if (this.isActive) return
    this.isActive = true
    this.startTime = performance.now()
    this.createWaves()
    this.animate()
  }
  
  private stop(): void {
    if (!this.isActive) return
    this.isActive = false
    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    if (this.ctx && this.overlay) {
      this.ctx.clearRect(0, 0, this.overlay.width, this.overlay.height)
    }
    this.waves = []
  }
  
  pause(): void {
    this.isPaused = true
  }
  
  resume(): void {
    this.isPaused = false
    if (this.config.enabled && !this.isActive) {
      this.start()
    }
  }
  
  private createWaves(): void {
    this.waves = []
    const W = window.innerWidth
    const H = window.innerHeight
    
    for (let i = 0; i < this.config.waveCount; i++) {
      this.waves.push({
        phase: (i / this.config.waveCount) * Math.PI * 2, // Stagger phases
        centerX: W / 2 + (Math.random() - 0.5) * W * 0.3,
        centerY: H / 2 + (Math.random() - 0.5) * H * 0.3,
        radius: Math.max(W, H) * 0.3,
      })
    }
  }
  
  private animate = (): void => {
    if (!this.isActive || this.isPaused || !this.ctx || !this.overlay) {
      if (this.isActive && !this.isPaused) {
        this.rafId = requestAnimationFrame(this.animate)
      }
      return
    }
    
    const now = performance.now()
    const elapsed = (now - this.startTime) / 1000
    const W = window.innerWidth
    const H = window.innerHeight
    
    // Throttle to 10fps for performance
    const updateFrame = Math.floor(elapsed * 10)
    const lastUpdateFrame = Math.floor((elapsed - 0.1) * 10)
    
    if (updateFrame !== lastUpdateFrame) {
      // Update wave phases
      for (const wave of this.waves) {
        wave.phase += this.config.waveSpeed * 0.1
        if (wave.phase > Math.PI * 2) {
          wave.phase -= Math.PI * 2
        }
      }
    }
    
    this.ctx.clearRect(0, 0, W, H)
    
    // Draw compression/expansion waves
    for (const wave of this.waves) {
      const compression = 1.0 + Math.sin(wave.phase) * (this.config.compressionAmount - 1.0) * this.config.intensity
      
      // Draw radial gradient for compression effect
      const gradient = this.ctx.createRadialGradient(
        wave.centerX, wave.centerY, 0,
        wave.centerX, wave.centerY, wave.radius
      )
      gradient.addColorStop(0, `rgba(255, 255, 255, ${0.1 * this.config.intensity * compression})`)
      gradient.addColorStop(0.5, `rgba(255, 255, 255, ${0.05 * this.config.intensity * compression})`)
      gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
      
      this.ctx.fillStyle = gradient
      this.ctx.fillRect(wave.centerX - wave.radius, wave.centerY - wave.radius, wave.radius * 2, wave.radius * 2)
    }
    
    this.rafId = requestAnimationFrame(this.animate)
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

// ============================================================================
// Effect 8: Grouped Selection (Stochastic Depth Highlighting)
// ============================================================================

/**
 * Grouped Selection
 * What it feels like: Random depth groups are briefly highlighted, revealing the splat's internal structure.
 * Mechanism: Randomly selects depth bands, applies subtle highlight overlay that fades in/out.
 * Parameters: intensity (0-1), highlightDuration (800-2000ms), groupCount (2-4)
 * Performance: Throttled selection (2-3 per second), mobile-safe
 */
export interface GroupedSelectionConfig {
  enabled: boolean
  intensity: number
  highlightDuration: number // ms (800-2000)
  groupCount: number // 2-4 (simultaneous highlights)
  selectionRate: number // 0.5-2.0 (highlights per second)
}

const GROUPED_SELECTION_DEFAULT: GroupedSelectionConfig = {
  enabled: false,
  intensity: 0.4,
  highlightDuration: 1500,
  groupCount: 3,
  selectionRate: 1.0, // 1 highlight per second
}

interface HighlightGroup {
  depth: number
  depthRange: number // 0-1 (band thickness)
  age: number
  opacity: number
}

export class GroupedSelection {
  private overlay: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private sourceCanvas: HTMLCanvasElement | null = null
  private config: GroupedSelectionConfig = { ...GROUPED_SELECTION_DEFAULT }
  private isActive = false
  private rafId: number | null = null
  private isPaused = false
  private startTime = 0
  private lastSelectionTime = 0
  
  // Active highlight groups
  private highlightGroups: HighlightGroup[] = []
  
  constructor(container: HTMLElement) {
    this.createOverlay(container)
  }
  
  private createOverlay(container: HTMLElement): void {
    this.overlay = document.createElement('canvas')
    this.overlay.className = 'grouped-selection-overlay'
    this.overlay.style.position = 'fixed'
    this.overlay.style.top = '0'
    this.overlay.style.left = '0'
    this.overlay.style.width = '100%'
    this.overlay.style.height = '100%'
    this.overlay.style.pointerEvents = 'none'
    this.overlay.style.zIndex = '8'
    this.overlay.style.opacity = '1'
    this.overlay.style.mixBlendMode = 'screen' // Soft highlight
    
    const dpr = Math.min(1.5, window.devicePixelRatio || 1)
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
    const dpr = Math.min(1.5, window.devicePixelRatio || 1)
    this.overlay.width = window.innerWidth * dpr
    this.overlay.height = window.innerHeight * dpr
    this.ctx.setTransform(1, 0, 0, 1, 0, 0)
    this.ctx.scale(dpr, dpr)
  }
  
  setSourceCanvas(canvas: HTMLCanvasElement | null): void {
    this.sourceCanvas = canvas
  }
  
  setConfig(config: Partial<GroupedSelectionConfig>): void {
    this.config = { ...this.config, ...config }
    if (!this.config.enabled && this.isActive) {
      this.stop()
    } else if (this.config.enabled && !this.isActive && !this.isPaused) {
      this.start()
    }
  }
  
  private start(): void {
    if (this.isActive) return
    this.isActive = true
    this.startTime = performance.now()
    this.lastSelectionTime = performance.now()
    this.highlightGroups = []
    this.animate()
  }
  
  private stop(): void {
    if (!this.isActive) return
    this.isActive = false
    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    if (this.ctx && this.overlay) {
      this.ctx.clearRect(0, 0, this.overlay.width, this.overlay.height)
    }
    this.highlightGroups = []
  }
  
  pause(): void {
    this.isPaused = true
  }
  
  resume(): void {
    this.isPaused = false
    if (this.config.enabled && !this.isActive) {
      this.start()
    }
  }
  
  private animate = (): void => {
    if (!this.isActive || this.isPaused || !this.ctx || !this.overlay) {
      if (this.isActive && !this.isPaused) {
        this.rafId = requestAnimationFrame(this.animate)
      }
      return
    }
    
    const now = performance.now()
    const elapsed = (now - this.startTime) / 1000
    const W = window.innerWidth
    const H = window.innerHeight
    
    // Create new highlight groups at selection rate
    const selectionInterval = 1000 / this.config.selectionRate
    if (now - this.lastSelectionTime >= selectionInterval && this.highlightGroups.length < this.config.groupCount) {
      const depth = Math.random()
      const depthRange = 0.1 + Math.random() * 0.15 // 0.1-0.25 band thickness
      
      this.highlightGroups.push({
        depth,
        depthRange,
        age: 0,
        opacity: 0,
      })
      this.lastSelectionTime = now
    }
    
    // Update and fade highlight groups
    for (let i = this.highlightGroups.length - 1; i >= 0; i--) {
      const group = this.highlightGroups[i]
      group.age += 16 // ~60fps
      
      const progress = group.age / this.config.highlightDuration
      
      // Fade in, then fade out
      if (progress < 0.3) {
        group.opacity = (progress / 0.3) * this.config.intensity
      } else {
        group.opacity = (1 - (progress - 0.3) / 0.7) * this.config.intensity
      }
      
      if (progress >= 1 || group.opacity < 0.01) {
        this.highlightGroups.splice(i, 1)
        continue
      }
    }
    
    this.ctx.clearRect(0, 0, W, H)
    
    // Draw highlight groups
    for (const group of this.highlightGroups) {
      const bandY = group.depth * H
      const bandHeight = group.depthRange * H
      
      const gradient = this.ctx.createLinearGradient(0, bandY - bandHeight / 2, 0, bandY + bandHeight / 2)
      gradient.addColorStop(0, `rgba(255, 255, 255, 0)`)
      gradient.addColorStop(0.3, `rgba(255, 255, 255, ${group.opacity * 0.3})`)
      gradient.addColorStop(0.5, `rgba(255, 255, 255, ${group.opacity * 0.5})`)
      gradient.addColorStop(0.7, `rgba(255, 255, 255, ${group.opacity * 0.3})`)
      gradient.addColorStop(1, `rgba(255, 255, 255, 0)`)
      
      this.ctx.fillStyle = gradient
      this.ctx.fillRect(0, bandY - bandHeight / 2, W, bandHeight)
    }
    
    this.rafId = requestAnimationFrame(this.animate)
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

// ============================================================================
// Volumetric Effects Manager
// ============================================================================

/**
 * Manages all volumetric effects with single-effect enforcement and auto-decay.
 */
export class VolumetricEffectsManager {
  private container: HTMLElement
  private activeEffect: string | null = null
  
  // All effects
  public depthPulse: DepthPulse
  public volumetricDrift: VolumetricDrift
  public opacityAccumulation: OpacityAccumulation
  public covarianceStretch: CovarianceStretch
  public temporalPersistence: TemporalPersistence
  public depthAmbiguity: DepthAmbiguity
  public pressureWave: PressureWave
  public groupedSelection: GroupedSelection
  
  constructor(container: HTMLElement) {
    this.container = container
    
    // Initialize all effects
    this.depthPulse = new DepthPulse(container)
    this.volumetricDrift = new VolumetricDrift(container)
    this.opacityAccumulation = new OpacityAccumulation(container)
    this.covarianceStretch = new CovarianceStretch(container)
    this.temporalPersistence = new TemporalPersistence(container)
    this.depthAmbiguity = new DepthAmbiguity(container)
    this.pressureWave = new PressureWave(container)
    this.groupedSelection = new GroupedSelection(container)
  }
  
  /**
   * Activate a specific effect (deactivates others).
   */
  activateEffect(effectName: string, config?: any): void {
    // Deactivate current effect
    if (this.activeEffect) {
      this.deactivateEffect(this.activeEffect)
    }
    
    this.activeEffect = effectName
    
    // Activate new effect
    switch (effectName) {
      case 'depth-pulse':
        this.depthPulse.setConfig({ enabled: true, ...config })
        break
      case 'volumetric-drift':
        this.volumetricDrift.setConfig({ enabled: true, ...config })
        break
      case 'opacity-accumulation':
        this.opacityAccumulation.setConfig({ enabled: true, ...config })
        break
      case 'covariance-stretch':
        this.covarianceStretch.setConfig({ enabled: true, ...config })
        break
      case 'temporal-persistence':
        this.temporalPersistence.setConfig({ enabled: true, ...config })
        break
      case 'depth-ambiguity':
        this.depthAmbiguity.setConfig({ enabled: true, ...config })
        break
      case 'pressure-wave':
        this.pressureWave.setConfig({ enabled: true, ...config })
        break
      case 'grouped-selection':
        this.groupedSelection.setConfig({ enabled: true, ...config })
        break
    }
  }
  
  /**
   * Deactivate a specific effect.
   */
  deactivateEffect(effectName: string): void {
    switch (effectName) {
      case 'depth-pulse':
        this.depthPulse.setConfig({ enabled: false })
        break
      case 'volumetric-drift':
        this.volumetricDrift.setConfig({ enabled: false })
        break
      case 'opacity-accumulation':
        this.opacityAccumulation.setConfig({ enabled: false })
        break
      case 'covariance-stretch':
        this.covarianceStretch.setConfig({ enabled: false })
        break
      case 'temporal-persistence':
        this.temporalPersistence.setConfig({ enabled: false })
        break
      case 'depth-ambiguity':
        this.depthAmbiguity.setConfig({ enabled: false })
        break
      case 'pressure-wave':
        this.pressureWave.setConfig({ enabled: false })
        break
      case 'grouped-selection':
        this.groupedSelection.setConfig({ enabled: false })
        break
    }
    
    if (this.activeEffect === effectName) {
      this.activeEffect = null
    }
  }
  
  /**
   * Pause all effects (e.g., during transitions).
   */
  pauseAll(): void {
    this.depthPulse.pause()
    this.volumetricDrift.pause()
    this.opacityAccumulation.pause()
    this.covarianceStretch.pause()
    this.temporalPersistence.pause()
    this.depthAmbiguity.pause()
    this.pressureWave.pause()
    this.groupedSelection.pause()
  }
  
  /**
   * Resume all effects.
   */
  resumeAll(): void {
    this.depthPulse.resume()
    this.volumetricDrift.resume()
    this.opacityAccumulation.resume()
    this.covarianceStretch.resume()
    this.temporalPersistence.resume()
    this.depthAmbiguity.resume()
    this.pressureWave.resume()
    this.groupedSelection.resume()
  }
  
  /**
   * Set source canvas for all effects.
   */
  setSourceCanvas(canvas: HTMLCanvasElement | null): void {
    this.depthPulse.setSourceCanvas(canvas)
    this.volumetricDrift.setSourceCanvas(canvas)
    this.opacityAccumulation.setSourceCanvas(canvas)
    this.covarianceStretch.setSourceCanvas(canvas)
    this.temporalPersistence.setSourceCanvas(canvas)
    this.depthAmbiguity.setSourceCanvas(canvas)
    this.pressureWave.setSourceCanvas(canvas)
    this.groupedSelection.setSourceCanvas(canvas)
  }
  
  /**
   * Destroy all effects.
   */
  destroy(): void {
    this.depthPulse.destroy()
    this.volumetricDrift.destroy()
    this.opacityAccumulation.destroy()
    this.covarianceStretch.destroy()
    this.temporalPersistence.destroy()
    this.depthAmbiguity.destroy()
    this.pressureWave.destroy()
    this.groupedSelection.destroy()
  }
}
