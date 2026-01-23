/**
 * Audio-driven pulse system that generates continuous disintegration waves.
 * Reuses SplatTransitionOverlay's sampling approach for consistency.
 */

export const DEBUG_AUDIO_PULSE = false

export class AudioPulseDriver {
  private audioContext: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private dataArray: Uint8Array | null = null
  private mediaStream: MediaStream | null = null
  private rafId: number | null = null
  private isActive = false
  private isEnabled = false
  private smoothedEnergy = 0
  private lastPulseTime = 0
  private bandPosition = 0
  private bandDirection = 1 // 1 = down, -1 = up
  private lastSnapshotTime = 0
  private cachedSnapshot: HTMLCanvasElement | null = null

  // Audio analysis params
  private readonly FFT_SIZE = 256
  private readonly SMOOTHING_TIME_CONSTANT = 0.8
  private readonly LOW_FREQ_START = 0 // ~60Hz
  private readonly LOW_FREQ_END = 8 // ~600Hz
  private readonly ENERGY_SMOOTH = 0.15

  // Pulse params
  private readonly MIN_PULSE_RATE = 1 // pulses per second
  private readonly MAX_PULSE_RATE = 6 // pulses per second
  private readonly PULSE_DURATION_MS = 600
  private readonly BAND_HEIGHT_RATIO = 0.16 // 16% of screen height
  private readonly BAND_SPEED = 0.8 // pixels per frame
  private readonly SNAPSHOT_REFRESH_FPS = 12 // Refresh snapshot at most 12 fps

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
    sourceCanvas: HTMLCanvasElement | null
  ) {
    this.transitionOverlay = transitionOverlay
    this.sourceCanvas = sourceCanvas
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
      this.lastPulseTime = performance.now()
      this.bandPosition = window.innerHeight * 0.5
      this.bandDirection = 1

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

  private getAudioEnergy(): number {
    if (!this.analyser || !this.dataArray) return 0

    ;(this.analyser as any).getByteFrequencyData(this.dataArray)

    // Sum low-mid frequencies
    let sum = 0
    for (let i = this.LOW_FREQ_START; i <= this.LOW_FREQ_END; i++) {
      sum += this.dataArray[i]
    }
    const avg = sum / (this.LOW_FREQ_END - this.LOW_FREQ_START + 1)
    const normalized = avg / 255

    // Smooth energy
    this.smoothedEnergy += (normalized - this.smoothedEnergy) * this.ENERGY_SMOOTH

    return this.smoothedEnergy
  }

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

  private animate = (): void => {
    if (!this.isActive || !this.isEnabled || !this.transitionOverlay) return

    const now = performance.now()
    const H = window.innerHeight
    const bandHeight = H * this.BAND_HEIGHT_RATIO

    // Update band position (oscillating top→bottom→top)
    this.bandPosition += this.bandDirection * this.BAND_SPEED

    // Reverse direction at boundaries
    if (this.bandPosition >= H - bandHeight / 2) {
      this.bandPosition = H - bandHeight / 2
      this.bandDirection = -1
    } else if (this.bandPosition <= bandHeight / 2) {
      this.bandPosition = bandHeight / 2
      this.bandDirection = 1
    }

    // Get audio energy
    const energy = this.getAudioEnergy()

    // Map energy to pulse rate
    const pulseRate = this.MIN_PULSE_RATE + energy * (this.MAX_PULSE_RATE - this.MIN_PULSE_RATE)
    const pulseInterval = 1000 / pulseRate

    // Spawn pulse if enough time has passed
    if (now - this.lastPulseTime >= pulseInterval) {
      const snapshot = this.getSnapshot()
      if (snapshot) {
        // Determine direction based on band movement
        const direction: 'up' | 'down' = this.bandDirection > 0 ? 'down' : 'up'

        // Intensity scales with energy (0.3 to 1.0)
        const intensity = 0.3 + energy * 0.7

        this.transitionOverlay.startAudioPulse({
          bandCenterY: this.bandPosition,
          bandHeight,
          direction,
          intensity,
          durationMs: this.PULSE_DURATION_MS,
          sourceCanvas: snapshot,
        })

        this.lastPulseTime = now
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
        <div>pulseRate: ${pulseRate.toFixed(2)}/s</div>
        <div>bandY: ${this.bandPosition.toFixed(1)}</div>
        <div>direction: ${this.bandDirection > 0 ? 'down' : 'up'}</div>
      `
    }

    this.rafId = requestAnimationFrame(this.animate)
  }

  destroy(): void {
    this.disable()
  }
}
