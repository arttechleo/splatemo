/**
 * Audio-driven continuous traveling wave system.
 * Creates a wavefront that continuously sweeps through the entire splat,
 * driven by audio frequency and amplitude.
 * Reuses SplatTransitionOverlay's sampling approach for consistency.
 */

import * as THREE from 'three'

export const DEBUG_AUDIO_PULSE = false

export class AudioPulseDriver {
  private audioContext: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private dataArray: Uint8Array | null = null
  private mediaStream: MediaStream | null = null
  private rafId: number | null = null
  private isActive = false
  private isEnabled = false
  
  // Audio analysis params
  private readonly FFT_SIZE = 256
  private readonly SMOOTHING_TIME_CONSTANT = 0.8
  
  // Frequency analysis
  private readonly LOW_FREQ_START = 0 // ~60Hz
  private readonly MID_FREQ_END = 32 // ~2.4kHz
  
  // Smoothing
  private readonly ENERGY_SMOOTH = 0.15
  private readonly FREQ_SMOOTH = 0.1
  private smoothedEnergy = 0
  private smoothedDominantFreq = 0
  
  // Wave parameters
  private wavePosition = 0 // Current wave position (0 to 1, wraps)
  private readonly MIN_WAVELENGTH = 0.08 // Minimum band spacing (8% of screen)
  private readonly MAX_WAVELENGTH = 0.25 // Maximum band spacing (25% of screen)
  private readonly BAND_THICKNESS_RATIO = 0.15 // Band thickness (15% of screen)
  private waveDirection = 1 // 1 = down, -1 = up (alternates at edges)
  
  // Particle emission
  private readonly PARTICLE_LIFETIME_MS = 800 // How long particles live
  private lastSnapshotTime = 0
  private cachedSnapshot: HTMLCanvasElement | null = null
  private readonly SNAPSHOT_REFRESH_FPS = 15 // Refresh snapshot at most 15 fps
  
  // Reference to transition overlay
  private transitionOverlay: {
    startAudioPulse: (params: {
      bandCenterY: number
      bandHeight: number
      direction: 'up' | 'down'
      intensity: number
      durationMs: number
      sourceCanvas: HTMLCanvasElement | null
    }) => void
  } | null = null

  // Source canvas reference
  private sourceCanvas: HTMLCanvasElement | null = null
  
  // Camera reference for depth calculations (reserved for future depth-based filtering)
  private _camera: THREE.PerspectiveCamera | null = null
  private _controls: { target?: THREE.Vector3 } | null = null
  private _currentSplatMesh: {
    getSplatCount: () => number
    getSplatCenter: (index: number, out: THREE.Vector3) => void
  } | null = null
  
  // Depth-based wave parameters
  private depthWavePosition = 0 // Current depth wave position (0 = near, 1 = far)
  private readonly DEPTH_WAVE_SPEED = 0.008 // Depth position increment per frame
  private readonly DEPTH_SLAB_THICKNESS = 0.15 // Thickness of depth slab (15% of depth range)
  

  constructor(
    transitionOverlay: {
      startAudioPulse: (params: {
        bandCenterY: number
        bandHeight: number
        direction: 'up' | 'down'
        intensity: number
        durationMs: number
        sourceCanvas: HTMLCanvasElement | null
      }) => void
    },
    sourceCanvas: HTMLCanvasElement | null,
    camera: THREE.PerspectiveCamera | null = null,
    controls: { target?: THREE.Vector3 } | null = null
  ) {
    this.transitionOverlay = transitionOverlay
    this.sourceCanvas = sourceCanvas
    this._camera = camera
    this._controls = controls
  }

  setCamera(camera: THREE.PerspectiveCamera | null, _controls: { target?: THREE.Vector3 } | null): void {
    // Store for future depth-based filtering
    void (this._camera = camera)
    void (this._controls = _controls)
  }

  setSplatMesh(mesh: {
    getSplatCount: () => number
    getSplatCenter: (index: number, out: THREE.Vector3) => void
  } | null): void {
    // Store for future depth-based filtering
    void (this._currentSplatMesh = mesh)
  }

  setSourceCanvas(canvas: HTMLCanvasElement | null): void {
    this.sourceCanvas = canvas
    this.cachedSnapshot = null
  }

  async enable(): Promise<boolean> {
    if (this.isEnabled) return true

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      this.audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      this.analyser = this.audioContext.createAnalyser()
      this.analyser.fftSize = this.FFT_SIZE
      this.analyser.smoothingTimeConstant = this.SMOOTHING_TIME_CONSTANT

      const source = this.audioContext.createMediaStreamSource(this.mediaStream)
      source.connect(this.analyser)

      const bufferLength = this.analyser.frequencyBinCount
      this.dataArray = new Uint8Array(bufferLength)

      this.isEnabled = true
      this.smoothedEnergy = 0
      this.smoothedDominantFreq = 0
      this.wavePosition = 0.5 // Start in middle
      this.waveDirection = 1

      this.start()
      return true
    } catch (error) {
      console.warn('[AUDIO_PULSE] Failed to enable audio input', error)
      return false
    }
  }

  disable(): void {
    this.isEnabled = false
    this.stop()

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop())
      this.mediaStream = null
    }

    if (this.audioContext) {
      this.audioContext.close().catch(() => {})
      this.audioContext = null
    }

    this.analyser = null
    this.dataArray = null
    this.cachedSnapshot = null
  }

  pause(): void {
    this.isActive = false
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
  }

  resume(): void {
    if (this.isEnabled && !this.isActive) {
      this.start()
    }
  }

  private start(): void {
    if (this.isActive || !this.isEnabled) return
    this.isActive = true
    this.animate()
  }

  private stop(): void {
    this.isActive = false
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
  }

  /**
   * Analyze audio to get energy and dominant frequency.
   * Returns { energy: 0-1, dominantFreq: normalized frequency }
   */
  private analyzeAudio(): { energy: number; dominantFreq: number } {
    if (!this.analyser || !this.dataArray) return { energy: 0, dominantFreq: 0 }

    ;(this.analyser as any).getByteFrequencyData(this.dataArray)

    // Calculate energy (RMS) from low-mid frequencies
    let energySum = 0
    let energyCount = 0
    for (let i = this.LOW_FREQ_START; i <= this.MID_FREQ_END; i++) {
      energySum += this.dataArray[i]
      energyCount++
    }
    const avgEnergy = energySum / energyCount
    const normalizedEnergy = Math.min(1, avgEnergy / 255)
    
    // Smooth energy
    this.smoothedEnergy += (normalizedEnergy - this.smoothedEnergy) * this.ENERGY_SMOOTH

    // Find dominant frequency (weighted centroid of low-mid band)
    let weightedSum = 0
    let magnitudeSum = 0
    for (let i = this.LOW_FREQ_START; i <= this.MID_FREQ_END; i++) {
      const magnitude = this.dataArray[i]
      const freqBin = i
      weightedSum += freqBin * magnitude
      magnitudeSum += magnitude
    }
    
    const dominantFreqBin = magnitudeSum > 0 ? weightedSum / magnitudeSum : 0
    // Normalize to 0-1 range (map frequency bins to normalized frequency)
    const normalizedFreq = Math.min(1, dominantFreqBin / (this.MID_FREQ_END - this.LOW_FREQ_START))
    
    // Smooth frequency
    this.smoothedDominantFreq += (normalizedFreq - this.smoothedDominantFreq) * this.FREQ_SMOOTH

    return {
      energy: this.smoothedEnergy,
      dominantFreq: this.smoothedDominantFreq,
    }
  }

  /**
   * Map dominant frequency to wavelength (band spacing).
   * Higher frequency = shorter wavelength = more bands.
   */
  private frequencyToWavelength(freq: number): number {
    // Inverse relationship: high freq = short wavelength
    // Map 0-1 frequency to MAX-MIN wavelength range
    return this.MAX_WAVELENGTH - (freq * (this.MAX_WAVELENGTH - this.MIN_WAVELENGTH))
  }

  /**
   * Get snapshot of source canvas (cached for performance).
   */
  private getSnapshot(): HTMLCanvasElement | null {
    if (!this.sourceCanvas) return null

    const now = performance.now()
    const snapshotInterval = 1000 / this.SNAPSHOT_REFRESH_FPS

    // Reuse cached snapshot if recent
    if (this.cachedSnapshot && now - this.lastSnapshotTime < snapshotInterval) {
      return this.cachedSnapshot
    }

    // Capture new snapshot
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

  /**
   * Calculate depth-based wave bands.
   * Creates screen-space bands that represent the projection of a depth slab traveling through the splat.
   */
  private calculateDepthWaveBands(depthCenter: number, depthThickness: number, wavelength: number): number[] {
    const bands: number[] = []
    
    // For depth-based wave, we emit particles across the entire screen height
    // but the depth slab determines which regions are most active
    // Create multiple bands across screen to represent the depth wave projection
    
    // Number of bands based on wavelength
    const numBands = Math.max(3, Math.floor(1 / wavelength))
    const bandSpacing = 1 / numBands
    
    for (let i = 0; i <= numBands; i++) {
      const normalizedY = i * bandSpacing
      
      // Weight bands by depth wave position (center of wave has highest intensity)
      // This creates a traveling wave effect across the screen
      const depthWeight = 1 - Math.abs(normalizedY - depthCenter) / depthThickness
      if (depthWeight > 0.3) {
        bands.push(normalizedY)
      }
    }
    
    return bands.filter(y => y >= 0 && y <= 1)
  }

  private animate = (): void => {
    if (!this.isActive || !this.isEnabled || !this.transitionOverlay) return

    const H = window.innerHeight

    // Analyze audio
    const { energy, dominantFreq } = this.analyzeAudio()
    
    // Map frequency to wavelength
    const wavelength = this.frequencyToWavelength(dominantFreq)
    
    // Calculate wave speed based on energy (more energy = faster wave)
    const baseSpeed = 0.005
    const energySpeedBoost = energy * 0.008
    const currentSpeed = baseSpeed + energySpeedBoost
    
    // Update depth wave position (travels through 3D depth: 0 = near, 1 = far)
    this.depthWavePosition += this.waveDirection * (this.DEPTH_WAVE_SPEED + energySpeedBoost)
    
    // Reverse direction at depth boundaries
    if (this.depthWavePosition >= 1) {
      this.depthWavePosition = 1
      this.waveDirection = -1
    } else if (this.depthWavePosition <= 0) {
      this.depthWavePosition = 0
      this.waveDirection = 1
    }
    
    // For depth-based wave, map depth wave position to screen-space bands
    const depthSlabCenter = this.depthWavePosition
    const depthSlabThickness = this.DEPTH_SLAB_THICKNESS
    
    // Calculate screen-space projection of depth slab
    const bandPositions = this.calculateDepthWaveBands(depthSlabCenter, depthSlabThickness, wavelength)
    const bandHeight = H * this.BAND_THICKNESS_RATIO
    
    // Get snapshot for particle sampling
    const snapshot = this.getSnapshot()
    
    if (snapshot && energy > 0.05) { // Only emit if there's significant audio
      // Emit particles for each active band
      for (const normalizedY of bandPositions) {
        const bandCenterY = normalizedY * H
        
        // Only emit if band is visible on screen
        if (bandCenterY >= -bandHeight && bandCenterY <= H + bandHeight) {
          // Intensity scales with energy (0.4 to 1.0)
          const intensity = 0.4 + energy * 0.6
          
          // Determine direction (always top to bottom for consistency)
          const direction: 'up' | 'down' = 'down'
          
          // Emit pulse for this band
          this.transitionOverlay.startAudioPulse({
            bandCenterY,
            bandHeight,
            direction,
            intensity,
            durationMs: this.PARTICLE_LIFETIME_MS,
            sourceCanvas: snapshot,
          })
        }
      }
    }

    if (DEBUG_AUDIO_PULSE) {
      let debugEl = document.getElementById('audio-pulse-debug')
      if (!debugEl) {
        debugEl = document.createElement('div')
        debugEl.id = 'audio-pulse-debug'
        debugEl.style.position = 'fixed'
        debugEl.style.top = '80px'
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
        <div>energy: ${energy.toFixed(3)}</div>
        <div>dominantFreq: ${dominantFreq.toFixed(3)}</div>
        <div>wavelength: ${wavelength.toFixed(3)}</div>
        <div>waveSpeed: ${currentSpeed.toFixed(4)}</div>
        <div>wavePosition: ${this.wavePosition.toFixed(3)}</div>
        <div>direction: ${this.waveDirection > 0 ? 'down' : 'up'}</div>
        <div>bands: ${bandPositions.length}</div>
      `
    }

    this.rafId = requestAnimationFrame(this.animate)
  }

  destroy(): void {
    this.disable()
  }
}
