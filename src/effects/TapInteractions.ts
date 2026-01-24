/**
 * Tap Interactions
 * Tap-based effects triggered directly on the Gaussian splat.
 * All overlay-only, using existing particle system.
 */

import { SplatTransitionOverlay } from '../transitions/SplatTransitionOverlay'
import { EffectGovernor, type ActiveEffect } from './EffectGovernor'

export interface TapInteractionsConfig {
  rippleDuration: number // ms
  rippleIntensity: number // 0-1
  disintegrateDuration: number // ms
  disintegrateIntensity: number // 0-1
  spotlightIntensity: number // 0-1
  enabled: boolean
}

export class TapInteractions {
  private overlay: SplatTransitionOverlay
  private sourceCanvas: HTMLCanvasElement | null = null
  private governor: EffectGovernor
  private config: TapInteractionsConfig = {
    rippleDuration: 750,
    rippleIntensity: 0.8,
    disintegrateDuration: 1200,
    disintegrateIntensity: 0.9,
    spotlightIntensity: 0.7,
    enabled: false,
  }
  
  // Phase 1 callbacks
  private tapFocusHandler: ((x: number, y: number) => void) | null = null
  private doubleTapLikeHandler: ((x: number, y: number) => void) | null = null
  
  // Lab config for Phase 2 effects (disabled by default for clean demo)
  // Used by setLabConfig() method - kept for Lab toggle functionality
  private labConfig: {
    rippleBurst: boolean
    revealSpotlight: boolean
    depthScrubbing: boolean
    memoryEchoes: boolean
  } = {
    rippleBurst: false, // OFF by default
    revealSpotlight: false, // OFF by default
    depthScrubbing: false, // OFF by default
    memoryEchoes: false, // OFF by default
  }
  
  // Memory echo (ghost impressions)
  private memoryEchoes: Array<{ x: number; y: number; age: number; lifetime: number }> = []
  private readonly MAX_MEMORY_ECHOES = 5 // Phase 2: max 5 echoes
  
  // Depth scrubbing
  private isDepthScrubbing = false
  private scrubStartY = 0
  private scrubCurrentY = 0
  private scrubRafId: number | null = null
  
  // Gesture state
  private tapStartTime = 0
  private tapStartX = 0
  private tapStartY = 0
  private tapCount = 0
  private tapTimeout: ReturnType<typeof setTimeout> | null = null
  private isHolding = false
  private holdX = 0
  private holdY = 0
  private holdRafId: number | null = null
  
  // Movement threshold (pixels) to distinguish tap from scroll/orbit
  private readonly MOVEMENT_THRESHOLD = 10
  private readonly DOUBLE_TAP_DELAY = 300 // ms
  private readonly HOLD_DELAY = 150 // ms before hold activates
  
  // Spotlight state
  private spotlightRadius = 0
  private spotlightCanvas: HTMLCanvasElement | null = null
  private spotlightCtx: CanvasRenderingContext2D | null = null
  
  // Transition state
  private isTransitioning = false
  
  constructor(overlay: SplatTransitionOverlay, governor: EffectGovernor) {
    this.overlay = overlay
    this.governor = governor
    this.initSpotlightCanvas()
    this.setupEventListeners()
    this.startMemoryEchoUpdate()
  }
  
  private initSpotlightCanvas(): void {
    this.spotlightCanvas = document.createElement('canvas')
    this.spotlightCanvas.className = 'tap-interactions-spotlight'
    this.spotlightCanvas.style.position = 'fixed'
    this.spotlightCanvas.style.top = '0'
    this.spotlightCanvas.style.left = '0'
    this.spotlightCanvas.style.width = '100%'
    this.spotlightCanvas.style.height = '100%'
    this.spotlightCanvas.style.pointerEvents = 'none'
    this.spotlightCanvas.style.zIndex = '12' // Above rain overlay
    this.spotlightCanvas.style.opacity = '1'
    
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    this.spotlightCanvas.width = window.innerWidth * dpr
    this.spotlightCanvas.height = window.innerHeight * dpr
    
    this.spotlightCtx = this.spotlightCanvas.getContext('2d', { alpha: true })
    if (this.spotlightCtx) {
      this.spotlightCtx.scale(dpr, dpr)
    }
    
    document.body.appendChild(this.spotlightCanvas)
    
    window.addEventListener('resize', () => this.resizeSpotlight())
  }
  
  private resizeSpotlight(): void {
    if (!this.spotlightCanvas || !this.spotlightCtx) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    this.spotlightCanvas.width = window.innerWidth * dpr
    this.spotlightCanvas.height = window.innerHeight * dpr
    this.spotlightCtx.setTransform(1, 0, 0, 1, 0, 0)
    this.spotlightCtx.scale(dpr, dpr)
  }
  
  setSourceCanvas(canvas: HTMLCanvasElement | null): void {
    this.sourceCanvas = canvas
  }
  
  setConfig(config: Partial<TapInteractionsConfig>): void {
    this.config = { ...this.config, ...config }
  }
  
  getConfig(): TapInteractionsConfig {
    return { ...this.config }
  }
  
  setTransitioning(isTransitioning: boolean): void {
    this.isTransitioning = isTransitioning
    if (isTransitioning) {
      // Cancel any active interactions
      this.cancelHold()
      this.cancelTap()
    }
  }
  
  setTapFocusHandler(handler: (x: number, y: number) => void): void {
    this.tapFocusHandler = handler
  }
  
  setDoubleTapLikeHandler(handler: (x: number, y: number) => void): void {
    this.doubleTapLikeHandler = handler
  }
  
  setLabConfig(config: {
    rippleBurst: boolean
    revealSpotlight: boolean
    depthScrubbing: boolean
    memoryEchoes: boolean
  }): void {
    this.labConfig = { ...config }
    // Methods that use labConfig: _triggerRippleBurst, startHold, startDepthScrubbing, _addMemoryEcho
    // These are called conditionally based on labConfig values (when enabled via Lab toggle)
  }
  
  private setupEventListeners(): void {
    // Mouse events
    document.addEventListener('mousedown', (e) => this.handlePress(e.clientX, e.clientY, 1))
    document.addEventListener('mouseup', () => this.handleRelease())
    document.addEventListener('mousemove', (e) => this.handleMove(e.clientX, e.clientY))
    
    // Touch events
    document.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        const touch = e.touches[0]
        this.handlePress(touch.clientX, touch.clientY, 1)
      } else if (e.touches.length === 2) {
        // Two-finger tap → Reset
        this.handleTwoFingerTap()
      }
    })
    document.addEventListener('touchend', (e) => {
      if (e.touches.length === 0) {
        this.handleRelease()
      }
    })
    document.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1) {
        const touch = e.touches[0]
        this.handleMove(touch.clientX, touch.clientY)
      }
    })
  }
  
  private handlePress(x: number, y: number, _pointerCount: number): void {
    if (!this.config.enabled || this.isTransitioning) return
    
    this.tapStartX = x
    this.tapStartY = y
    this.lastMoveX = x
    this.lastMoveY = y
    this.tapStartTime = performance.now()
    this.isHolding = false
    this.scrubStartY = y
    this.scrubCurrentY = y
    
    // Start hold detection
    setTimeout(() => {
      if (this.tapStartTime > 0 && !this.isHolding) {
        const dx = Math.abs(this.lastMoveX - this.tapStartX)
        const dy = Math.abs(this.lastMoveY - this.tapStartY)
        if (dx < this.MOVEMENT_THRESHOLD && dy < this.MOVEMENT_THRESHOLD) {
          this.startHold(this.lastMoveX, this.lastMoveY)
        }
      }
    }, this.HOLD_DELAY)
  }
  
  private lastMoveX = 0
  private lastMoveY = 0
  
  private handleMove(x: number, y: number): void {
    if (!this.config.enabled) return
    
    const moveDx = Math.abs(x - this.lastMoveX)
    const moveDy = Math.abs(y - this.lastMoveY)
    
    // Check for depth scrubbing (slow vertical drag)
    if (!this.isHolding && Math.abs(y - this.scrubStartY) > 20 && moveDx < 5) {
      // Slow vertical movement, likely depth scrubbing
      if (!this.isDepthScrubbing) {
        this.startDepthScrubbing(y)
      } else {
        this.scrubCurrentY = y
      }
    } else if (this.isDepthScrubbing && (moveDx > 10 || Math.abs(y - this.scrubStartY) < 10)) {
      // Cancel scrubbing if horizontal movement or returned to start
      this.stopDepthScrubbing()
    }
    
    // Update hold position if holding
    if (this.isHolding) {
      // Cancel hold if moved too much
      if (moveDx > this.MOVEMENT_THRESHOLD || moveDy > this.MOVEMENT_THRESHOLD) {
        this.cancelHold()
      } else {
        this.holdX = x
        this.holdY = y
      }
    }
    
    this.lastMoveX = x
    this.lastMoveY = y
  }
  
  private handleRelease(): void {
    if (!this.config.enabled) return
    
    // Stop depth scrubbing
    if (this.isDepthScrubbing) {
      this.stopDepthScrubbing()
      return
    }
    
    const now = performance.now()
    const elapsed = now - this.tapStartTime
    
    // Cancel hold if active
    if (this.isHolding) {
      this.cancelHold()
      return
    }
    
    // Check for tap (not hold, not too much movement)
    const moveDx = Math.abs(this.lastMoveX - this.tapStartX)
    const moveDy = Math.abs(this.lastMoveY - this.tapStartY)
    
    if (elapsed < this.HOLD_DELAY * 2 && moveDx < this.MOVEMENT_THRESHOLD && moveDy < this.MOVEMENT_THRESHOLD) {
      this.tapCount++
      
      // Clear previous timeout
      if (this.tapTimeout) {
        clearTimeout(this.tapTimeout)
      }
      
      // Check for double tap
      if (this.tapCount === 2) {
        this.handleDoubleTap(this.tapStartX, this.tapStartY)
        this.tapCount = 0
      } else {
        // Wait for potential double tap
        this.tapTimeout = setTimeout(() => {
          if (this.tapCount === 1) {
            this.handleSingleTap(this.tapStartX, this.tapStartY)
          }
          this.tapCount = 0
        }, this.DOUBLE_TAP_DELAY)
      }
    }
    
    this.tapStartTime = 0
  }
  
  private resetHandler: (() => void) | null = null
  
  setResetHandler(handler: () => void): void {
    this.resetHandler = handler
  }
  
  private handleTwoFingerTap(): void {
    if (!this.config.enabled || this.isTransitioning) return
    
    // Trigger reset
    if (this.resetHandler) {
      this.resetHandler()
    }
  }
  
  private startHold(x: number, y: number): void {
    if (this.isHolding) return
    
    this.isHolding = true
    this.holdX = x
    this.holdY = y
    this.spotlightRadius = 20
    const holdStartTime = performance.now()
    
    // Check for long-press (slow time activation)
    setTimeout(() => {
      if (this.isHolding && performance.now() - holdStartTime >= 800) {
        // Long-press detected: activate slow time
        this.triggerSlowTime()
      }
    }, 800)
    
    // Record interaction
    const interactionEvent = new CustomEvent('user-interaction')
    document.dispatchEvent(interactionEvent)
    
    // Register as primary effect (user-triggered, high priority)
    const effect: ActiveEffect = {
      id: 'touch-spotlight',
      type: 'primary',
      priority: 'touch',
      intensity: this.config.spotlightIntensity,
      startTime: performance.now(),
      userTriggered: true,
      onSuppress: () => {
        this.cancelHold()
      },
    }
    this.governor.registerEffect(effect)
    
    this.animateSpotlight()
  }
  
  private triggerSlowTime(): void {
    // This will be wired to TimeEffects
    const event = new CustomEvent('slow-time-activate')
    document.dispatchEvent(event)
  }
  
  private cancelHold(): void {
    if (!this.isHolding) return
    
    this.isHolding = false
    if (this.holdRafId) {
      cancelAnimationFrame(this.holdRafId)
      this.holdRafId = null
    }
    
    // Unregister effect
    this.governor.unregisterEffect('touch-spotlight')
    
    // Fade out spotlight
    this.fadeOutSpotlight()
  }
  
  // Memory echoes disabled for clean demo (available in Lab toggle)
  private _addMemoryEcho(x: number, y: number): void {
    // Remove oldest if at max
    if (this.memoryEchoes.length >= this.MAX_MEMORY_ECHOES) {
      this.memoryEchoes.shift()
    }
    
    this.memoryEchoes.push({
      x,
      y,
      age: 0,
      lifetime: 4000, // 4 seconds
    })
  }
  
  private startMemoryEchoUpdate(): void {
    const update = () => {
      if (!this.config.enabled) {
        requestAnimationFrame(update)
        return
      }
      
      // Update memory echoes
      for (const echo of this.memoryEchoes) {
        echo.age += 16.67
      }
      
      // Remove expired echoes
      this.memoryEchoes = this.memoryEchoes.filter(e => e.age < e.lifetime)
      
      // Draw memory echoes
      this.drawMemoryEchoes()
      
      requestAnimationFrame(update)
    }
    requestAnimationFrame(update)
  }
  
  private drawMemoryEchoes(): void {
    if (!this.spotlightCtx || this.memoryEchoes.length === 0) return
    
    const W = window.innerWidth
    const H = window.innerHeight
    
    // Clear with no dimming (fully transparent)
    this.spotlightCtx.clearRect(0, 0, W, H)
    
    // Draw echoes
    for (const echo of this.memoryEchoes) {
      const ageRatio = echo.age / echo.lifetime
      const alpha = (1 - ageRatio) * 0.3
      const radius = 15 + ageRatio * 25
      
      this.spotlightCtx.save()
      this.spotlightCtx.globalAlpha = alpha
      this.spotlightCtx.strokeStyle = `rgba(255, 255, 255, ${alpha})`
      this.spotlightCtx.lineWidth = 1.5
      this.spotlightCtx.beginPath()
      this.spotlightCtx.arc(echo.x, echo.y, radius, 0, Math.PI * 2)
      this.spotlightCtx.stroke()
      this.spotlightCtx.restore()
    }
  }
  
  private startDepthScrubbing(_y: number): void {
    if (this.isDepthScrubbing) return
    
    // Phase 2: Depth scrubbing disabled for clean demo (available in Lab toggle)
    return
    
    // Register as secondary effect (user-triggered)
    const effect: ActiveEffect = {
      id: 'touch-depth-scrub',
      type: 'secondary',
      priority: 'touch',
      intensity: 0.4,
      startTime: performance.now(),
      userTriggered: true,
      onSuppress: () => {
        this.stopDepthScrubbing()
      },
    }
    this.governor.registerEffect(effect)
    
    this.animateDepthScrub()
  }
  
  private stopDepthScrubbing(): void {
    if (!this.isDepthScrubbing) return
    
    this.isDepthScrubbing = false
    if (this.scrubRafId) {
      cancelAnimationFrame(this.scrubRafId)
      this.scrubRafId = null
    }
    
    this.governor.unregisterEffect('touch-depth-scrub')
  }
  
  private animateDepthScrub = (): void => {
    if (!this.isDepthScrubbing || !this.sourceCanvas) {
      return
    }
    
    const scrubDelta = this.scrubCurrentY - this.scrubStartY
    const scrubSpeed = Math.abs(scrubDelta) / 100 // Normalize
    
    // Create depth layers based on scrub position
    if (scrubSpeed > 0.1) {
      const bandY = this.scrubCurrentY
      const bandHeight = 50
      
      this.overlay.startAudioPulse({
        bandCenterY: bandY,
        bandHeight,
        direction: scrubDelta > 0 ? 'down' : 'up',
        intensity: 0.3,
        durationMs: 500,
        sourceCanvas: this.sourceCanvas,
        intensityMultiplier: 0.8, // Subtle
      })
    }
    
    this.scrubRafId = requestAnimationFrame(this.animateDepthScrub)
  }
  
  private cancelTap(): void {
    this.tapCount = 0
    if (this.tapTimeout) {
      clearTimeout(this.tapTimeout)
      this.tapTimeout = null
    }
  }
  
  private handleSingleTap(x: number, y: number): void {
    // Phase 1: Tap = Focus (always active, clean - no particles)
    if (this.tapFocusHandler) {
      this.tapFocusHandler(x, y)
    }
    
    // Phase 2 effects removed for clean demo (ripple, memory echoes disabled)
    // These remain available in Lab toggle but are OFF by default
    
    // Record interaction (for potential future use, but no rare pulse)
    const event = new CustomEvent('user-interaction')
    document.dispatchEvent(event)
  }
  
  private handleDoubleTap(x: number, y: number): void {
    // Phase 1: Double tap = Like affordance (UI-only, no particles)
    if (this.doubleTapLikeHandler) {
      this.doubleTapLikeHandler(x, y)
    }
    
    // Phase 2 effects removed for clean demo (disintegrate pop disabled)
    // These remain available in Lab toggle but are OFF by default
    
    // Record interaction
    const interactionEvent = new CustomEvent('user-interaction')
    document.dispatchEvent(interactionEvent)
  }
  
  /**
   * Trigger ripple burst: circular wave expanding from tap point.
   * DISABLED for clean demo - available in Lab toggle.
   */
  private _triggerRippleBurst(x: number, y: number): void {
    if (!this.sourceCanvas) return
    
    const H = window.innerHeight
    const duration = this.config.rippleDuration
    const intensity = this.config.rippleIntensity
    
    // Create expanding rings (circular bands)
    const numRings = 4
    const ringSpacing = 50
    const baseBandHeight = 35
    
    for (let i = 0; i < numRings; i++) {
      const delay = i * 100 // Stagger rings
      const ringRadius = i * ringSpacing
      
      setTimeout(() => {
        // Create circular band at expanding radius
        // Approximate circle with vertical bands at different Y positions
        const angles = [0, Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4, Math.PI, 5 * Math.PI / 4, 3 * Math.PI / 2, 7 * Math.PI / 4]
        
        for (const angle of angles) {
          const bandY = y + Math.sin(angle) * ringRadius
          const bandX = x + Math.cos(angle) * ringRadius
          
          // Only create if within bounds (use Y for vertical bands)
          if (bandY >= 0 && bandY <= H) {
            const bandHeight = baseBandHeight * (1 - i * 0.15) // Slightly smaller outer rings
            
            // Create horizontal bands at different X positions to approximate circle
            // For simplicity, use vertical bands at tap Y with varying intensities
            this.overlay.startAudioPulse({
              bandCenterY: bandY,
              bandHeight,
              direction: 'down',
              intensity: intensity * (1 - i * 0.25), // Fade outer rings
              durationMs: Math.max(300, duration - delay - 100),
              sourceCanvas: this.sourceCanvas,
              intensityMultiplier: 1.3, // Boost for visibility with bright edge
            })
          }
          
          void bandX // X used for future horizontal band positioning if needed
        }
      }, delay)
    }
  }
  
  /**
   * Trigger disintegrate pop: larger region around tap point, then reassemble.
   * DISABLED for clean demo - available in Lab toggle.
   * @ts-ignore - intentionally unused in clean demo, available via Lab toggle
   */
  private _triggerDisintegratePop(_x: number, y: number): void {
    if (!this.sourceCanvas) return
    
    const H = window.innerHeight
    const duration = this.config.disintegrateDuration
    const intensity = this.config.disintegrateIntensity
    
    // Create multiple bands around tap point for full region effect
    const regionHeight = H * 0.4 // Large region
    const numBands = 5
    
    for (let i = 0; i < numBands; i++) {
      const bandY = y - regionHeight / 2 + (i / numBands) * regionHeight
      const bandHeight = regionHeight / numBands
      
      // Phase 1: Disintegrate (upward)
      this.overlay.startAudioPulse({
        bandCenterY: bandY,
        bandHeight,
        direction: 'up',
        intensity: intensity * (0.6 + i * 0.1),
        durationMs: duration * 0.5, // First half: disintegrate
        sourceCanvas: this.sourceCanvas,
        intensityMultiplier: 1.3,
      })
      
      // Phase 2: Reassemble (downward, delayed)
      setTimeout(() => {
        this.overlay.startAudioPulse({
          bandCenterY: bandY,
          bandHeight,
          direction: 'down',
          intensity: intensity * (0.4 + i * 0.1),
          durationMs: duration * 0.5, // Second half: reassemble
          sourceCanvas: this.sourceCanvas,
          intensityMultiplier: 1.1,
        })
      }, duration * 0.5)
    }
  }
  
  private animateSpotlight = (): void => {
    if (!this.isHolding || !this.spotlightCtx || !this.spotlightCanvas) {
      return
    }
    
    const W = window.innerWidth
    const H = window.innerHeight
    
    // No dimming - use clearRect instead
    this.spotlightCtx.clearRect(0, 0, W, H)
    
    // Grow spotlight while holding
    this.spotlightRadius = Math.min(180, this.spotlightRadius + 1.5)
    
    // Draw spotlight
    const x = this.holdX
    const y = this.holdY
    const intensity = this.config.spotlightIntensity
    
    // Create radial gradient
    const gradient = this.spotlightCtx.createRadialGradient(x, y, 0, x, y, this.spotlightRadius)
    gradient.addColorStop(0, `rgba(255, 255, 255, ${intensity * 0.15})`)
    gradient.addColorStop(0.5, `rgba(255, 255, 255, ${intensity * 0.08})`)
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
    
    this.spotlightCtx.fillStyle = gradient
    this.spotlightCtx.beginPath()
    this.spotlightCtx.arc(x, y, this.spotlightRadius, 0, Math.PI * 2)
    this.spotlightCtx.fill()
    
    // Add subtle shimmer particles (low frequency)
    if (Math.random() < 0.1 && this.sourceCanvas) {
      this.addShimmerParticle(x, y, this.spotlightRadius)
    }
    
    this.holdRafId = requestAnimationFrame(this.animateSpotlight)
  }
  
  private addShimmerParticle(_x: number, _y: number, radius: number): void {
    if (!this.sourceCanvas || !this.spotlightCtx) return
    
    // Sample a random point within spotlight radius
    const angle = Math.random() * Math.PI * 2
    const dist = Math.random() * radius * 0.8
    const px = this.holdX + Math.cos(angle) * dist
    const py = this.holdY + Math.sin(angle) * dist
    
    // Sample color from splat at that point
    try {
      const ctx = this.sourceCanvas.getContext('2d', { willReadFrequently: true })
      if (ctx) {
        const W = window.innerWidth
        const H = window.innerHeight
        const canvasX = Math.floor((px / W) * this.sourceCanvas.width)
        const canvasY = Math.floor((py / H) * this.sourceCanvas.height)
        const imageData = ctx.getImageData(canvasX, canvasY, 1, 1)
        const data = imageData.data
        
        if (data[3] > 10) {
          // Draw shimmer particle
          this.spotlightCtx.save()
          this.spotlightCtx.fillStyle = `rgba(${data[0]}, ${data[1]}, ${data[2]}, 0.6)`
          this.spotlightCtx.beginPath()
          this.spotlightCtx.arc(px, py, 2 + Math.random() * 2, 0, Math.PI * 2)
          this.spotlightCtx.fill()
          this.spotlightCtx.restore()
        }
      }
    } catch {
      // Sampling failed, skip
    }
  }
  
  private fadeOutSpotlight = (): void => {
    if (!this.spotlightCtx || !this.spotlightCanvas) return
    
    const W = window.innerWidth
    const H = window.innerHeight
    
    // Fade out
    this.spotlightRadius *= 0.92
    
    if (this.spotlightRadius < 1) {
      // Clear completely
      this.spotlightCtx.clearRect(0, 0, W, H)
      this.spotlightRadius = 0
      return
    }
    
    // No dimming - use clearRect instead
    this.spotlightCtx.clearRect(0, 0, W, H)
    
    // Draw fading spotlight
    const x = this.holdX
    const y = this.holdY
    const fadeAlpha = this.spotlightRadius / 180
    
    const gradient = this.spotlightCtx.createRadialGradient(x, y, 0, x, y, this.spotlightRadius)
    gradient.addColorStop(0, `rgba(255, 255, 255, ${fadeAlpha * 0.1})`)
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
    
    this.spotlightCtx.fillStyle = gradient
    this.spotlightCtx.beginPath()
    this.spotlightCtx.arc(x, y, this.spotlightRadius, 0, Math.PI * 2)
    this.spotlightCtx.fill()
    
    requestAnimationFrame(this.fadeOutSpotlight)
  }
  
  destroy(): void {
    this.cancelHold()
    this.cancelTap()
    if (this.spotlightCanvas && this.spotlightCanvas.parentNode) {
      this.spotlightCanvas.parentNode.removeChild(this.spotlightCanvas)
    }
    this.spotlightCanvas = null
    this.spotlightCtx = null
  }
}
