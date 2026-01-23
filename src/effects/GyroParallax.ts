/**
 * Gyroscope-based Parallax Camera
 * Uses DeviceOrientation/DeviceMotion to create parallax effect on mobile.
 * Camera-only modification: does not touch splat rendering internals.
 */

import * as THREE from 'three'

export const DEBUG_GYRO_PARALLAX = false

export class GyroParallax {
  private camera: THREE.PerspectiveCamera | null = null
  private controls: { target?: THREE.Vector3 } | null = null
  private rafId: number | null = null
  private isActive = false
  private isEnabled = false
  private onStatusUpdate: ((status: 'idle' | 'tracking' | 'error') => void) | null = null
  
  // Gyro data
  private rawTilt = { x: 0, y: 0 } // Raw device tilt (radians)
  private smoothedTilt = { x: 0, y: 0 } // Smoothed tilt (EMA)
  private appliedOffset = { x: 0, y: 0 } // Applied camera offset
  
  // Smoothing parameters
  private readonly SMOOTHING_FACTOR = 0.12
  private readonly MAX_TILT_RADIANS = 0.15 // ~8.6 degrees max tilt
  private readonly PARALLAX_SCALE = 0.08 // Scale factor for parallax effect
  private readonly BASE_DISTANCE = 6 // Base camera distance for scaling
  private readonly MAX_PARALLAX_INTENSITY = 0.12 // Clamped intensity
  
  // Event handlers (stored for cleanup)
  private orientationHandler: ((event: DeviceOrientationEvent) => void) | null = null
  private motionHandler: ((event: DeviceMotionEvent) => void) | null = null

  constructor(camera: THREE.PerspectiveCamera, controls: { target?: THREE.Vector3 } | null) {
    this.camera = camera
    this.controls = controls
  }

  setOnStatusUpdate(callback: (status: 'idle' | 'tracking' | 'error') => void): void {
    this.onStatusUpdate = callback
  }

  private updateStatus(status: 'idle' | 'tracking' | 'error'): void {
    if (this.onStatusUpdate) {
      this.onStatusUpdate(status)
    }
  }

  async enable(): Promise<boolean> {
    if (this.isEnabled) return true

    // Check if device orientation is supported
    if (!window.DeviceOrientationEvent && !window.DeviceMotionEvent) {
      console.warn('[GYRO_PARALLAX] Device orientation not supported')
      this.updateStatus('error')
      return false
    }

    try {
      // Request permission on iOS 13+
      if (typeof (DeviceMotionEvent as any).requestPermission === 'function') {
        const permission = await (DeviceMotionEvent as any).requestPermission()
        if (permission !== 'granted') {
          console.warn('[GYRO_PARALLAX] Motion permission denied')
          this.updateStatus('error')
          return false
        }
      }

      // Set up event listeners
      this.setupListeners()

      this.isEnabled = true
      this.rawTilt = { x: 0, y: 0 }
      this.smoothedTilt = { x: 0, y: 0 }
      this.appliedOffset = { x: 0, y: 0 }

      this.updateStatus('tracking')
      this.start()
      return true
    } catch (error) {
      console.warn('[GYRO_PARALLAX] Failed to enable gyro', error)
      this.updateStatus('error')
      return false
    }
  }

  disable(): void {
    this.isEnabled = false
    this.stop()
    this.removeListeners()
    this.resetCameraOffset()
    this.updateStatus('idle')
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

  private setupListeners(): void {
    // Prefer DeviceMotionEvent (more accurate) over DeviceOrientationEvent
    if (window.DeviceMotionEvent) {
      this.motionHandler = (event: DeviceMotionEvent) => {
        if (!this.isEnabled) return
        
        // Use rotationRate if available (more stable)
        if (event.rotationRate) {
          // Convert rotation rate to tilt (integrate over time)
          // For simplicity, use beta (pitch) and gamma (roll) directly
          const beta = event.rotationRate.beta ? event.rotationRate.beta * (Math.PI / 180) : 0
          const gamma = event.rotationRate.gamma ? event.rotationRate.gamma * (Math.PI / 180) : 0
          
          // Accumulate tilt (with decay to prevent drift)
          this.rawTilt.x += gamma * 0.016 // ~60fps
          this.rawTilt.y += beta * 0.016
          
          // Clamp to max tilt
          this.rawTilt.x = Math.max(-this.MAX_TILT_RADIANS, Math.min(this.MAX_TILT_RADIANS, this.rawTilt.x))
          this.rawTilt.y = Math.max(-this.MAX_TILT_RADIANS, Math.min(this.MAX_TILT_RADIANS, this.rawTilt.y))
        }
      }
      window.addEventListener('devicemotion', this.motionHandler)
    } else if (window.DeviceOrientationEvent) {
      this.orientationHandler = (event: DeviceOrientationEvent) => {
        if (!this.isEnabled) return
        
        // Use beta (pitch) and gamma (roll) from orientation
        // Convert to radians and normalize
        const beta = event.beta ? (event.beta * Math.PI) / 180 : 0
        const gamma = event.gamma ? (event.gamma * Math.PI) / 180 : 0
        
        // Normalize to -1 to 1 range (assuming ±90 degrees max)
        this.rawTilt.x = Math.max(-this.MAX_TILT_RADIANS, Math.min(this.MAX_TILT_RADIANS, gamma / 90))
        this.rawTilt.y = Math.max(-this.MAX_TILT_RADIANS, Math.min(this.MAX_TILT_RADIANS, beta / 90))
      }
      window.addEventListener('deviceorientation', this.orientationHandler)
    }
  }

  private removeListeners(): void {
    if (this.motionHandler) {
      window.removeEventListener('devicemotion', this.motionHandler)
      this.motionHandler = null
    }
    if (this.orientationHandler) {
      window.removeEventListener('deviceorientation', this.orientationHandler)
      this.orientationHandler = null
    }
  }

  private resetCameraOffset(): void {
    // Camera offset is applied in updateCameraOffset, so we just reset tilt
    this.rawTilt = { x: 0, y: 0 }
    this.smoothedTilt = { x: 0, y: 0 }
    this.appliedOffset = { x: 0, y: 0 }
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

  private updateCameraOffset(): void {
    if (!this.camera || !this.controls?.target) return

    // Smooth tilt values (EMA)
    this.smoothedTilt.x += (this.rawTilt.x - this.smoothedTilt.x) * this.SMOOTHING_FACTOR
    this.smoothedTilt.y += (this.rawTilt.y - this.smoothedTilt.y) * this.SMOOTHING_FACTOR

    // Get current camera distance from target
    const cameraDistance = this.camera.position.distanceTo(this.controls.target)
    const distanceScale = cameraDistance / this.BASE_DISTANCE

    // Calculate parallax offset (scaled by distance and clamped)
    const offsetX = this.smoothedTilt.x * this.PARALLAX_SCALE * distanceScale
    const offsetY = this.smoothedTilt.y * this.PARALLAX_SCALE * distanceScale

          // Clamp offset to prevent nausea (respects intensity cap)
          const maxOffset = this.MAX_PARALLAX_INTENSITY * distanceScale
          this.appliedOffset.x = Math.max(-maxOffset, Math.min(maxOffset, offsetX))
          this.appliedOffset.y = Math.max(-maxOffset, Math.min(maxOffset, offsetY))

    // Apply offset to camera position (additive to current orbit)
    const direction = this.camera.position.clone().sub(this.controls.target).normalize()
    const right = new THREE.Vector3().crossVectors(direction, this.camera.up).normalize()
    const up = new THREE.Vector3().crossVectors(right, direction).normalize()

    // Calculate offset in camera space
    const offset = right.multiplyScalar(this.appliedOffset.x)
      .add(up.multiplyScalar(this.appliedOffset.y))

    // Apply offset (additive, doesn't interfere with orbit/zoom)
    const basePosition = this.camera.position.clone()
    const newPosition = basePosition.add(offset)
    
    // Update camera position
    this.camera.position.copy(newPosition)
    this.camera.lookAt(this.controls.target)
  }

  private animate = (): void => {
    if (!this.isActive || !this.isEnabled) return

    this.updateCameraOffset()

    if (DEBUG_GYRO_PARALLAX) {
      let debugEl = document.getElementById('gyro-parallax-debug')
      if (!debugEl) {
        debugEl = document.createElement('div')
        debugEl.id = 'gyro-parallax-debug'
        debugEl.style.position = 'fixed'
        debugEl.style.top = '120px'
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
        <div>rawTiltX: ${this.rawTilt.x.toFixed(4)}</div>
        <div>rawTiltY: ${this.rawTilt.y.toFixed(4)}</div>
        <div>smoothedX: ${this.smoothedTilt.x.toFixed(4)}</div>
        <div>smoothedY: ${this.smoothedTilt.y.toFixed(4)}</div>
        <div>offsetX: ${this.appliedOffset.x.toFixed(4)}</div>
        <div>offsetY: ${this.appliedOffset.y.toFixed(4)}</div>
      `
    }

    this.rafId = requestAnimationFrame(this.animate)
  }

  destroy(): void {
    this.disable()
  }
}
