/**
 * Audio-reactive wavelength effect overlay.
 * Creates a moving wavefront that passes through the splat in sync with audio.
 * Non-destructive: overlay-based, does not modify splat rendering.
 */

export const DEBUG_WAVELENGTH = false

export class AudioWavelength {
  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private audioContext: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private dataArray: Uint8Array | null = null
  private mediaStream: MediaStream | null = null
  private rafId: number | null = null
  private isActive = false
  private isEnabled = false
  private wavePosition = 0
  private smoothedAmplitude = 0

  // Audio analysis params
  private readonly FFT_SIZE = 256
  private readonly SMOOTHING_TIME_CONSTANT = 0.8
  private readonly LOW_FREQ_START = 0 // ~60Hz in 256 FFT at 44.1kHz
  private readonly LOW_FREQ_END = 8 // ~600Hz
  private readonly WAVE_SPEED_BASE = 0.5 // pixels per frame
  private readonly WAVE_BAND_HEIGHT = 0.15 // 15% of screen height
  private readonly AMPLITUDE_SMOOTH = 0.1

  constructor(container: HTMLElement) {
    this.canvas = document.createElement('canvas')
    this.canvas.style.position = 'fixed'
    this.canvas.style.inset = '0'
    this.canvas.style.width = '100%'
    this.canvas.style.height = '100%'
    this.canvas.style.pointerEvents = 'none'
    this.canvas.style.zIndex = '4'
    this.canvas.style.opacity = '0'
    this.canvas.style.transition = 'opacity 0.3s ease'
    container.appendChild(this.canvas)
    this.ctx = this.canvas.getContext('2d', { alpha: true })
    this.resize()
    window.addEventListener('resize', () => this.resize())
  }

  private resize() {
    if (!this.canvas) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    this.canvas.width = window.innerWidth * dpr
    this.canvas.height = window.innerHeight * dpr
    if (this.ctx) {
      this.ctx.setTransform(1, 0, 0, 1, 0, 0)
      this.ctx.scale(dpr, dpr)
    }
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
      this.wavePosition = 0
      this.smoothedAmplitude = 0

      if (this.canvas) {
        this.canvas.style.opacity = '1'
      }

      this.start()
      return true
    } catch (error) {
      console.warn('[AUDIO] Failed to enable audio input', error)
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

    if (this.canvas) {
      this.canvas.style.opacity = '0'
    }
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

  private getAmplitude(): number {
    if (!this.analyser || !this.dataArray) return 0

    ;(this.analyser as any).getByteFrequencyData(this.dataArray)

    // Sum low-mid frequencies (60-600Hz range)
    let sum = 0
    for (let i = this.LOW_FREQ_START; i <= this.LOW_FREQ_END; i++) {
      sum += this.dataArray[i]
    }
    const avg = sum / (this.LOW_FREQ_END - this.LOW_FREQ_START + 1)
    const normalized = avg / 255

    // Smooth amplitude
    this.smoothedAmplitude += (normalized - this.smoothedAmplitude) * this.AMPLITUDE_SMOOTH

    return this.smoothedAmplitude
  }

  private animate = (): void => {
    if (!this.isActive || !this.isEnabled || !this.ctx || !this.canvas) return

    const W = window.innerWidth
    const H = window.innerHeight
    this.ctx.clearRect(0, 0, W, H)

    const amplitude = this.getAmplitude()
    const waveSpeed = this.WAVE_SPEED_BASE + amplitude * 1.5
    const waveIntensity = 0.3 + amplitude * 0.5

    // Update wave position (loops continuously)
    this.wavePosition += waveSpeed
    if (this.wavePosition > H + H * this.WAVE_BAND_HEIGHT) {
      this.wavePosition = -H * this.WAVE_BAND_HEIGHT
    }

    const bandHeight = H * this.WAVE_BAND_HEIGHT
    const waveY = this.wavePosition

    // Draw wavelength effect (gradient band with shimmer)
    const gradient = this.ctx.createLinearGradient(0, waveY - bandHeight / 2, 0, waveY + bandHeight / 2)
    gradient.addColorStop(0, `rgba(255, 255, 255, 0)`)
    gradient.addColorStop(0.3, `rgba(255, 255, 255, ${0.15 * waveIntensity})`)
    gradient.addColorStop(0.5, `rgba(200, 220, 255, ${0.25 * waveIntensity})`)
    gradient.addColorStop(0.7, `rgba(255, 255, 255, ${0.15 * waveIntensity})`)
    gradient.addColorStop(1, `rgba(255, 255, 255, 0)`)

    this.ctx.fillStyle = gradient
    this.ctx.fillRect(0, waveY - bandHeight / 2, W, bandHeight)

    // Add subtle particle shimmer
    const particleCount = Math.floor(amplitude * 30)
    this.ctx.fillStyle = `rgba(255, 255, 255, ${0.4 * waveIntensity})`
    for (let i = 0; i < particleCount; i++) {
      const x = Math.random() * W
      const y = waveY + (Math.random() - 0.5) * bandHeight
      const size = 1 + Math.random() * 2
      this.ctx.beginPath()
      this.ctx.arc(x, y, size, 0, Math.PI * 2)
      this.ctx.fill()
    }

    if (DEBUG_WAVELENGTH) {
      this.ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)'
      this.ctx.lineWidth = 2
      this.ctx.strokeRect(0, waveY - bandHeight / 2, W, bandHeight)
      this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
      this.ctx.fillRect(10, 10, 200, 60)
      this.ctx.fillStyle = '#fff'
      this.ctx.font = '12px monospace'
      this.ctx.fillText(`amplitude: ${amplitude.toFixed(3)}`, 15, 30)
      this.ctx.fillText(`waveY: ${waveY.toFixed(1)}`, 15, 50)
      this.ctx.fillText(`speed: ${waveSpeed.toFixed(2)}`, 15, 70)
    }

    this.rafId = requestAnimationFrame(this.animate)
  }

  destroy(): void {
    this.disable()
    if (this.canvas?.parentElement) {
      this.canvas.parentElement.removeChild(this.canvas)
    }
    this.canvas = null
    this.ctx = null
  }
}
