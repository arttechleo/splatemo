/**
 * Effects Controller
 * Manages overlay-based visual effects inspired by Payhip 3DGS Shader Pack.
 * All effects are overlay-only, sampling from rendered canvas - no rendering internals modified.
 */

import { SplatTransitionOverlay } from '../transitions/SplatTransitionOverlay'

export type EffectPreset = 
  | 'none'
  | 'waves'
  | 'disintegrate'
  | 'perlin-wave'
  | 'wind'
  | 'glitter'
  | 'glow-dissolve'

export interface EffectConfig {
  preset: EffectPreset
  intensity: number // 0-1
  enabled: boolean
}

export class EffectsController {
  private overlay: SplatTransitionOverlay
  private sourceCanvas: HTMLCanvasElement | null = null
  private rafId: number | null = null
  private isActive = false
  private config: EffectConfig = {
    preset: 'none',
    intensity: 0.5,
    enabled: false,
  }
  
  // Snapshot management
  private lastSnapshotTime = 0
  private cachedSnapshot: HTMLCanvasElement | null = null
  private readonly SNAPSHOT_REFRESH_FPS = 12 // Max 12 FPS for snapshots
  
  // Effect state
  private effectTime = 0 // Continuous time for effect animations
  private wavePosition = 0 // For wave effects
  
  constructor(overlay: SplatTransitionOverlay) {
    this.overlay = overlay
  }

  setSourceCanvas(canvas: HTMLCanvasElement | null): void {
    this.sourceCanvas = canvas
    this.cachedSnapshot = null
  }

  setConfig(config: Partial<EffectConfig>): void {
    this.config = { ...this.config, ...config }
    if (!this.config.enabled || this.config.preset === 'none') {
      this.stop()
    } else {
      this.start()
    }
  }

  getConfig(): EffectConfig {
    return { ...this.config }
  }

  pause(): void {
    this.isActive = false
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
  }

  resume(): void {
    if (this.config.enabled && this.config.preset !== 'none' && !this.isActive) {
      this.start()
    }
  }

  private start(): void {
    if (this.isActive || !this.config.enabled || this.config.preset === 'none') return
    this.isActive = true
    this.effectTime = 0
    this.animate()
  }

  private stop(): void {
    this.isActive = false
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
  }

  private getSnapshot(): HTMLCanvasElement | null {
    if (!this.sourceCanvas) return null

    const now = performance.now()
    const snapshotInterval = 1000 / this.SNAPSHOT_REFRESH_FPS

    if (this.cachedSnapshot && now - this.lastSnapshotTime < snapshotInterval) {
      return this.cachedSnapshot
    }

    try {
      const w = this.sourceCanvas.width
      const h = this.sourceCanvas.height
      if (w < 4 || h < 4) return null

      const snapshot = document.createElement('canvas')
      snapshot.width = w
      snapshot.height = h
      const ctx = snapshot.getContext('2d', { alpha: true })
      if (!ctx) return null

      ctx.drawImage(this.sourceCanvas, 0, 0, w, h, 0, 0, w, h)
      this.cachedSnapshot = snapshot
      this.lastSnapshotTime = now
      return snapshot
    } catch {
      return null
    }
  }

  private animate = (): void => {
    if (!this.isActive || !this.config.enabled || this.config.preset === 'none') return

    const deltaTime = 16.67 // ~60fps
    this.effectTime += deltaTime

    const snapshot = this.getSnapshot()
    if (!snapshot) {
      this.rafId = requestAnimationFrame(this.animate)
      return
    }

    // Apply current effect preset
    switch (this.config.preset) {
      case 'waves':
        this.applyWavesEffect(snapshot)
        break
      case 'disintegrate':
        this.applyDisintegrateEffect(snapshot)
        break
      case 'perlin-wave':
        this.applyPerlinWaveEffect(snapshot)
        break
      case 'wind':
        this.applyWindEffect(snapshot)
        break
      case 'glitter':
        this.applyGlitterEffect(snapshot)
        break
      case 'glow-dissolve':
        this.applyGlowDissolveEffect(snapshot)
        break
    }

    this.rafId = requestAnimationFrame(this.animate)
  }

  // Effect implementations
  private applyWavesEffect(snapshot: HTMLCanvasElement): void {
    const H = window.innerHeight
    const intensity = this.config.intensity
    
    // Wave travels through entire splat repeatedly (continuous loop)
    const waveSpeed = 0.006 + intensity * 0.012
    this.wavePosition += waveSpeed
    
    // Wrap at edges for continuous loop
    if (this.wavePosition >= 1) {
      this.wavePosition = 0
    } else if (this.wavePosition < 0) {
      this.wavePosition = 1
    }
    
    // Band mask with clear leading edge (matches scroll transition style)
    // Band height scales with intensity for more visible wave at higher intensity
    const bandHeight = H * (0.14 + intensity * 0.1) // 14-24% of screen
    const bandCenterY = this.wavePosition * H
    
    // Emit particles from active wave band
    // Matches scroll disintegration: splat-derived particles with directional motion
    // Intensity controls particle density and motion amount
    this.overlay.startAudioPulse({
      bandCenterY,
      bandHeight,
      direction: 'down', // Consistent direction for readable wavefront
      intensity: 0.5 + intensity * 0.5, // Scales particle count and velocity
      durationMs: 900, // Longer duration for smoother, more visible wave
      sourceCanvas: snapshot,
    })
    
    // Add trailing wave for depth (creates richer wave with liquid feel)
    // Only at higher intensities to avoid performance hit
    if (intensity > 0.5) {
      const trailingOffset = 0.12
      const trailingY = ((this.wavePosition - trailingOffset + 1) % 1) * H
      this.overlay.startAudioPulse({
        bandCenterY: trailingY,
        bandHeight: bandHeight * 0.65,
        direction: 'down',
        intensity: 0.25 + (intensity - 0.5) * 0.4,
        durationMs: 700,
        sourceCanvas: snapshot,
      })
    }
  }

  private applyDisintegrateEffect(snapshot: HTMLCanvasElement): void {
    // Continuous dissolve loop - particles lift and reassemble
    const H = window.innerHeight
    const cycleTime = 4000 // 4 second cycle
    const cycleProgress = (this.effectTime % cycleTime) / cycleTime
    const intensity = this.config.intensity
    
    // Phase 1: Disintegrate (0-0.5) - particles lift up
    // Phase 2: Reassemble (0.5-1) - particles fall down
    const bandHeight = H * (0.15 + intensity * 0.1)
    const numBands = 6
    
    for (let i = 0; i < numBands; i++) {
      const bandPhase = (i / numBands + cycleProgress) % 1
      const bandY = bandPhase * H
      
      // Determine direction based on phase
      const direction: 'up' | 'down' = bandPhase < 0.5 ? 'up' : 'down'
      const phaseIntensity = bandPhase < 0.5 
        ? (bandPhase * 2) * intensity // Fade in during disintegrate
        : ((1 - bandPhase) * 2) * intensity // Fade out during reassemble
      
      if (phaseIntensity > 0.1) {
        this.overlay.startAudioPulse({
          bandCenterY: bandY,
          bandHeight,
          direction,
          intensity: 0.4 + phaseIntensity * 0.6,
          durationMs: 500,
          sourceCanvas: snapshot,
        })
      }
    }
  }

  private applyPerlinWaveEffect(snapshot: HTMLCanvasElement): void {
    // Similar to waves but with noise-warped band (liquid distortion)
    const H = window.innerHeight
    const intensity = this.config.intensity
    const waveSpeed = 0.008 + intensity * 0.015
    
    this.wavePosition += waveSpeed
    if (this.wavePosition > 1) this.wavePosition = 0
    
    // Apply noise warp to band (simplified Perlin-like noise for liquid feel)
    const noise1 = Math.sin(this.effectTime * 0.0015) * 0.04
    const noise2 = Math.cos(this.effectTime * 0.002 + this.wavePosition * Math.PI * 2) * 0.03
    const noiseOffset = noise1 + noise2
    
    const bandCenterY = Math.max(0, Math.min(H, (this.wavePosition + noiseOffset) * H))
    const bandHeight = H * (0.12 + intensity * 0.08)
    
    // Warped band creates liquid wave feel
    this.overlay.startAudioPulse({
      bandCenterY,
      bandHeight,
      direction: 'down',
      intensity: 0.4 + intensity * 0.6,
      durationMs: 700,
      sourceCanvas: snapshot,
    })
  }

  private applyWindEffect(snapshot: HTMLCanvasElement): void {
    // Constant directional drift with turbulence
    const intensity = this.config.intensity
    const H = window.innerHeight
    
    // Create multiple bands with directional drift and turbulence
    const numBands = 4
    const windSpeed = 0.0004 + intensity * 0.0006
    
    for (let i = 0; i < numBands; i++) {
      const basePhase = i / numBands
      const phase = basePhase + (this.effectTime * windSpeed)
      
      // Turbulence via noise
      const turbulence = Math.sin(phase * Math.PI * 4 + this.effectTime * 0.001) * 0.05
      const bandY = ((phase % 1) + turbulence) * H
      const bandHeight = H * (0.08 + intensity * 0.06)
      
      this.overlay.startAudioPulse({
        bandCenterY: Math.max(0, Math.min(H, bandY)),
        bandHeight,
        direction: 'down',
        intensity: 0.3 + intensity * 0.5,
        durationMs: 500,
        sourceCanvas: snapshot,
      })
    }
  }

  private applyGlitterEffect(snapshot: HTMLCanvasElement): void {
    // Sparse sparkles from bright areas (galaxy glitter style)
    const intensity = this.config.intensity
    const sparkleRate = Math.floor(3 + intensity * 12)
    const sparkleInterval = 1000 / sparkleRate
    
    if (this.effectTime % sparkleInterval < 16) {
      // Sample bright pixels for sparkles (low frequency to avoid performance hit)
      const ctx = snapshot.getContext('2d', { willReadFrequently: true })
      if (!ctx) return
      
      const W = window.innerWidth
      const H = window.innerHeight
      
      // Find bright pixels (sparse sampling - every 8 pixels for performance)
      const brightPixels: Array<{ x: number; y: number }> = []
      try {
        const imageData = ctx.getImageData(0, 0, snapshot.width, snapshot.height)
        const data = imageData.data
        
        for (let i = 0; i < data.length; i += 32) { // Sample every 8 pixels (4 channels * 8)
          const r = data[i]
          const g = data[i + 1]
          const b = data[i + 2]
          const a = data[i + 3]
          const brightness = (r + g + b) / 3
          
          // Only sample visible, bright pixels
          if (a > 50 && brightness > 160 && Math.random() < 0.15) {
            const px = ((i / 4) % snapshot.width) / snapshot.width * W
            const py = Math.floor((i / 4) / snapshot.width) / snapshot.height * H
            brightPixels.push({ x: px, y: py })
          }
        }
      } catch {
        // Fallback: random sparkles if sampling fails
        const numFallback = Math.floor(5 + intensity * 10)
        for (let i = 0; i < numFallback; i++) {
          brightPixels.push({
            x: Math.random() * W,
            y: Math.random() * H,
          })
        }
      }
      
      // Spawn sparkles from bright areas
      const numSparkles = Math.min(brightPixels.length, Math.floor(8 + intensity * 15))
      for (let i = 0; i < numSparkles; i++) {
        const pixel = brightPixels[Math.floor(Math.random() * brightPixels.length)]
        const bandHeight = 15 + Math.random() * 10
        this.overlay.startAudioPulse({
          bandCenterY: pixel.y,
          bandHeight,
          direction: 'down',
          intensity: 0.7 + intensity * 0.3,
          durationMs: 400 + Math.random() * 200, // Vary duration for twinkle
          sourceCanvas: snapshot,
        })
      }
    }
  }

  private applyGlowDissolveEffect(snapshot: HTMLCanvasElement): void {
    // Dissolve with edge glow (particles bloom before fading)
    const intensity = this.config.intensity
    const cycleTime = 5000
    const cycleProgress = (this.effectTime % cycleTime) / cycleTime
    const H = window.innerHeight
    
    // Create dissolving bands with glow effect
    const numBands = 5
    const bandHeight = H * (0.12 + intensity * 0.08)
    
    for (let i = 0; i < numBands; i++) {
      const bandPhase = (i / numBands + cycleProgress) % 1
      const bandY = bandPhase * H
      
      // Glow intensity peaks in middle of dissolve
      const glowIntensity = Math.sin(bandPhase * Math.PI) * intensity
      
      if (glowIntensity > 0.1) {
        this.overlay.startAudioPulse({
          bandCenterY: bandY,
          bandHeight,
          direction: 'down',
          intensity: 0.5 + glowIntensity * 0.5,
          durationMs: 900, // Longer duration for glow effect
          sourceCanvas: snapshot,
        })
      }
    }
  }

  destroy(): void {
    this.stop()
  }
}
