/**
 * Effects Controller
 * Manages overlay-based visual effects inspired by Payhip 3DGS Shader Pack.
 * All effects are overlay-only, sampling from rendered canvas - no rendering internals modified.
 */

import * as THREE from 'three'
import { SplatTransitionOverlay } from '../transitions/SplatTransitionOverlay'
import { LensRain } from './LensRain'
import { RainOntoSplat } from './RainOntoSplat'

export type EffectPreset = 
  | 'none'
  | 'waves'
  | 'disintegrate'
  | 'perlin-wave'
  | 'wind'
  | 'glitter'
  | 'glow-dissolve'
  | 'rain'
  | 'rain-onto-splat'

export type EffectIntensityPreset = 'subtle' | 'medium' | 'vivid'

export interface EffectConfig {
  preset: EffectPreset
  intensity: number // 0-1
  enabled: boolean
  intensityPreset?: EffectIntensityPreset // Global intensity multiplier
  boost?: number // Debug boost multiplier (default 1.0)
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
    intensityPreset: 'medium',
    boost: 1.0,
  }
  
  // Lens Rain effect (separate from overlay system)
  private lensRain: LensRain | null = null
  
  // Rain Onto Splat effect (separate from overlay system)
  private rainOntoSplat: RainOntoSplat | null = null
  
  // Intensity multipliers by preset
  private readonly INTENSITY_MULTIPLIERS = {
    subtle: 0.5,
    medium: 1.0,
    vivid: 3.0,
  }
  
  // Get effective intensity multiplier (preset × boost)
  // Returns multiplier to apply to base intensity
  private getEffectiveIntensity(): number {
    const presetMultiplier = this.INTENSITY_MULTIPLIERS[this.config.intensityPreset || 'medium']
    const boost = this.config.boost || 1.0
    return presetMultiplier * boost
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
    this.lensRain = new LensRain()
    this.rainOntoSplat = new RainOntoSplat()
  }

  setSourceCanvas(canvas: HTMLCanvasElement | null): void {
    this.sourceCanvas = canvas
    this.cachedSnapshot = null
    if (this.lensRain) {
      this.lensRain.setSourceCanvas(canvas)
    }
    if (this.rainOntoSplat) {
      this.rainOntoSplat.setSourceCanvas(canvas)
    }
  }
  
  setCamera(camera: THREE.PerspectiveCamera | null, controls: { target?: THREE.Vector3; getAzimuthalAngle?: () => number } | null): void {
    if (this.lensRain) {
      this.lensRain.setCamera(camera, controls)
    }
  }

  setConfig(config: Partial<EffectConfig>): void {
    this.config = { ...this.config, ...config }
    
    // Handle Lens Rain separately (it's not overlay-based)
    if (this.config.preset === 'rain') {
      if (this.config.enabled) {
        if (this.lensRain) {
          this.lensRain.setConfig({
            intensity: this.config.intensity,
            decay: 0.6, // Default decay, can be made configurable
            wind: 0.3, // Default wind, can be made configurable
            enabled: true,
          })
        }
        this.stop() // Stop overlay effects
        if (this.rainOntoSplat) {
          this.rainOntoSplat.setConfig({ enabled: false })
        }
      } else {
        if (this.lensRain) {
          this.lensRain.setConfig({ enabled: false })
        }
        this.stop()
      }
      return
    }
    
    // Handle Rain Onto Splat separately (it's not overlay-based)
    if (this.config.preset === 'rain-onto-splat') {
      if (this.config.enabled) {
        if (this.rainOntoSplat) {
          this.rainOntoSplat.setConfig({
            intensity: this.config.intensity,
            depthTravel: 0.6, // Default, can be made configurable
            decay: 0.7, // Default, can be made configurable
            wind: 0.2, // Default, can be made configurable
            enabled: true,
          })
        }
        this.stop() // Stop overlay effects
        if (this.lensRain) {
          this.lensRain.setConfig({ enabled: false })
        }
      } else {
        if (this.rainOntoSplat) {
          this.rainOntoSplat.setConfig({ enabled: false })
        }
        this.stop()
      }
      return
    }
    
    // Handle other overlay-based effects
    if (!this.config.enabled || this.config.preset === 'none') {
      this.stop()
      if (this.lensRain) {
        this.lensRain.setConfig({ enabled: false })
      }
      if (this.rainOntoSplat) {
        this.rainOntoSplat.setConfig({ enabled: false })
      }
    } else {
      this.start()
      if (this.lensRain) {
        this.lensRain.setConfig({ enabled: false })
      }
      if (this.rainOntoSplat) {
        this.rainOntoSplat.setConfig({ enabled: false })
      }
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
    if (this.lensRain) {
      this.lensRain.pause()
    }
    if (this.rainOntoSplat) {
      this.rainOntoSplat.pause()
    }
  }

  resume(): void {
    if (this.config.enabled && this.config.preset !== 'none' && !this.isActive) {
      this.start()
    }
    if (this.lensRain && this.config.preset === 'rain' && this.config.enabled) {
      this.lensRain.resume()
    }
    if (this.rainOntoSplat && this.config.preset === 'rain-onto-splat' && this.config.enabled) {
      this.rainOntoSplat.resume()
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

    // Get effective intensity multiplier (preset × boost)
    const intensityMultiplier = this.getEffectiveIntensity()
    
    // Apply current effect preset
    switch (this.config.preset) {
      case 'waves':
        this.applyWavesEffect(snapshot, intensityMultiplier)
        break
      case 'disintegrate':
        this.applyDisintegrateEffect(snapshot, intensityMultiplier)
        break
      case 'perlin-wave':
        this.applyPerlinWaveEffect(snapshot, intensityMultiplier)
        break
      case 'wind':
        this.applyWindEffect(snapshot, intensityMultiplier)
        break
      case 'glitter':
        this.applyGlitterEffect(snapshot, intensityMultiplier)
        break
      case 'glow-dissolve':
        this.applyGlowDissolveEffect(snapshot, intensityMultiplier)
        break
    }

    this.rafId = requestAnimationFrame(this.animate)
  }

  // Effect implementations
  private applyWavesEffect(snapshot: HTMLCanvasElement, intensityMultiplier: number): void {
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
    
    // Emit particles from active wave band with bright leading edge
    // Matches scroll disintegration: splat-derived particles with directional motion
    const baseIntensity = 0.5 + intensity * 0.5
    
    // Leading edge (bright, high alpha)
    this.overlay.startAudioPulse({
      bandCenterY,
      bandHeight: bandHeight * 0.6, // Tighter leading edge
      direction: 'down',
      intensity: baseIntensity * 1.3, // 30% brighter leading edge
      durationMs: 1100, // Extended duration for longer tail
      sourceCanvas: snapshot,
      intensityMultiplier,
    })
    
    // Trailing fade (softer, wider)
    const trailingOffset = 0.08
    const trailingY = ((this.wavePosition - trailingOffset + 1) % 1) * H
    this.overlay.startAudioPulse({
      bandCenterY: trailingY,
      bandHeight: bandHeight * 0.8,
      direction: 'down',
      intensity: baseIntensity * 0.6, // Softer trailing
      durationMs: 900,
      sourceCanvas: snapshot,
      intensityMultiplier: intensityMultiplier * 0.7, // Slightly less intense trailing
    })
  }

  private applyDisintegrateEffect(snapshot: HTMLCanvasElement, intensityMultiplier: number): void {
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
          durationMs: 700, // Extended duration
          sourceCanvas: snapshot,
          intensityMultiplier,
        })
      }
    }
  }

  private applyPerlinWaveEffect(snapshot: HTMLCanvasElement, intensityMultiplier: number): void {
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
      durationMs: 900, // Extended duration
      sourceCanvas: snapshot,
      intensityMultiplier,
    })
  }

  private applyWindEffect(snapshot: HTMLCanvasElement, intensityMultiplier: number): void {
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
        durationMs: 700, // Extended duration
        sourceCanvas: snapshot,
        intensityMultiplier,
      })
    }
  }

  private applyGlitterEffect(snapshot: HTMLCanvasElement, intensityMultiplier: number): void {
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
          durationMs: 500 + Math.random() * 300, // Longer, varied duration for twinkle
          sourceCanvas: snapshot,
          intensityMultiplier: intensityMultiplier * 1.2, // Extra boost for sparkles
        })
      }
    }
  }

  private applyGlowDissolveEffect(snapshot: HTMLCanvasElement, intensityMultiplier: number): void {
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
          durationMs: 1100, // Extended duration for glow effect
          sourceCanvas: snapshot,
          intensityMultiplier: intensityMultiplier * 1.3, // Extra boost for glow
        })
      }
    }
  }

  destroy(): void {
    this.stop()
    if (this.lensRain) {
      this.lensRain.destroy()
      this.lensRain = null
    }
    if (this.rainOntoSplat) {
      this.rainOntoSplat.destroy()
      this.rainOntoSplat = null
    }
  }
}
