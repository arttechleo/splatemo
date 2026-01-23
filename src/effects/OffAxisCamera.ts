/**
 * Off-Axis / Head-Coupled Perspective Camera
 * Uses MediaPipe face tracking to create a dynamic off-axis camera projection.
 * Camera-only modification: does not touch splat rendering internals.
 */

import * as THREE from 'three'
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'

export const DEBUG_OFF_AXIS = false

export class OffAxisCamera {
  private camera: THREE.PerspectiveCamera | null = null
  private faceLandmarker: FaceLandmarker | null = null
  private video: HTMLVideoElement | null = null
  private rafId: number | null = null
  private isActive = false
  private isEnabled = false
  private lastVideoTime = -1
  private faceDetected = false
  private facePosition = { x: 0, y: 0, z: 0 } // Normalized face position (0-1)
  private smoothedFacePosition = { x: 0, y: 0, z: 0 }
  private defaultProjectionMatrix: THREE.Matrix4 | null = null
  private onStatusUpdate: ((status: 'idle' | 'tracking' | 'error') => void) | null = null
  private trackingFps = 0
  private lastFpsUpdate = 0
  private frameCount = 0
  
  // Smoothing parameters
  private readonly SMOOTHING_FACTOR = 0.15
  private readonly MAX_OFFSET_X = 0.15 // Maximum horizontal offset (15% of screen)
  private readonly MAX_OFFSET_Y = 0.1 // Maximum vertical offset (10% of screen)
  private readonly FOV = 50 // Base field of view (degrees)
  
  // Camera state
  private originalAspect = 1
  private originalNear = 0.1
  private originalFar = 1000

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera
    this.storeDefaultProjection()
  }

  setOnStatusUpdate(callback: (status: 'idle' | 'tracking' | 'error') => void): void {
    this.onStatusUpdate = callback
  }

  private updateStatus(status: 'idle' | 'tracking' | 'error'): void {
    if (this.onStatusUpdate) {
      this.onStatusUpdate(status)
    }
  }

  private storeDefaultProjection(): void {
    if (!this.camera) return
    this.defaultProjectionMatrix = this.camera.projectionMatrix.clone()
    this.originalAspect = this.camera.aspect
    this.originalNear = this.camera.near
    this.originalFar = this.camera.far
  }

  async enable(): Promise<boolean> {
    if (this.isEnabled) return true

    try {
      // Request camera permission
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'user' } 
      })

      // Create video element
      this.video = document.createElement('video')
      this.video.srcObject = stream
      this.video.autoplay = true
      this.video.playsInline = true
      this.video.style.position = 'fixed'
      this.video.style.top = '-9999px'
      this.video.style.width = '1px'
      this.video.style.height = '1px'
      this.video.style.opacity = '0'
      this.video.style.pointerEvents = 'none'
      document.body.appendChild(this.video)

      await new Promise<void>((resolve) => {
        if (this.video) {
          this.video.onloadedmetadata = () => resolve()
        } else {
          resolve()
        }
      })

      // Initialize MediaPipe Face Landmarker
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm'
      )
      
      this.faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
          delegate: 'GPU',
        },
        outputFaceBlendshapes: false,
        runningMode: 'VIDEO',
        numFaces: 1,
      })

      this.isEnabled = true
      this.faceDetected = false
      this.facePosition = { x: 0, y: 0, z: 0 }
      this.smoothedFacePosition = { x: 0, y: 0, z: 0 }
      this.trackingFps = 0
      this.frameCount = 0
      this.lastFpsUpdate = performance.now()

      this.updateStatus('tracking')
      this.start()
      return true
    } catch (error) {
      console.warn('[OFF_AXIS] Failed to enable face tracking', error)
      this.cleanup()
      this.updateStatus('error')
      return false
    }
  }

  disable(): void {
    this.isEnabled = false
    this.stop()
    this.cleanup()
    this.restoreDefaultProjection()
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

  private cleanup(): void {
    if (this.video?.srcObject) {
      const stream = this.video.srcObject as MediaStream
      stream.getTracks().forEach((track) => track.stop())
    }
    if (this.video?.parentElement) {
      this.video.parentElement.removeChild(this.video)
    }
    this.video = null
    this.faceLandmarker = null
  }

  private restoreDefaultProjection(): void {
    if (!this.camera || !this.defaultProjectionMatrix) return
    this.camera.projectionMatrix.copy(this.defaultProjectionMatrix)
    this.camera.aspect = this.originalAspect
    this.camera.near = this.originalNear
    this.camera.far = this.originalFar
    this.camera.updateProjectionMatrix()
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

  private detectFace = async (): Promise<void> => {
    if (!this.faceLandmarker || !this.video) return

    const now = performance.now() / 1000 // Convert to seconds
    if (now === this.lastVideoTime) return
    this.lastVideoTime = now

    // Update FPS counter
    this.frameCount++
    const fpsUpdateInterval = 1000 // Update FPS every second
    if (now * 1000 - this.lastFpsUpdate > fpsUpdateInterval) {
      this.trackingFps = this.frameCount
      this.frameCount = 0
      this.lastFpsUpdate = now * 1000
    }

    try {
      const results = this.faceLandmarker.detectForVideo(this.video, now)
      
      if (results.faceLandmarks && results.faceLandmarks.length > 0) {
        const landmarks = results.faceLandmarks[0]
        
        // Use nose tip (landmark 1) as reference point
        // MediaPipe landmarks are normalized (0-1)
        const noseTip = landmarks[1] || landmarks[0]
        
        if (noseTip) {
          // Convert to screen-centered coordinates (-0.5 to 0.5)
          const x = (noseTip.x - 0.5) * 2
          const y = (0.5 - noseTip.y) * 2 // Flip Y axis
          const z = Math.max(0, Math.min(1, noseTip.z || 0)) // Depth estimate
          
          this.facePosition = { x, y, z }
          this.faceDetected = true
          this.updateStatus('tracking')
        }
      } else {
        this.faceDetected = false
        // Smoothly return to center when face is lost
        this.facePosition = { x: 0, y: 0, z: 0 }
      }
    } catch (error) {
      console.warn('[OFF_AXIS] Face detection error', error)
      this.faceDetected = false
      this.updateStatus('error')
    }
  }

  private updateCameraProjection(): void {
    if (!this.camera) return

    // Smooth face position
    this.smoothedFacePosition.x += (this.facePosition.x - this.smoothedFacePosition.x) * this.SMOOTHING_FACTOR
    this.smoothedFacePosition.y += (this.facePosition.y - this.smoothedFacePosition.y) * this.SMOOTHING_FACTOR
    this.smoothedFacePosition.z += (this.facePosition.z - this.smoothedFacePosition.z) * this.SMOOTHING_FACTOR

    // Calculate offset (clamped to max values)
    const offsetX = this.smoothedFacePosition.x * this.MAX_OFFSET_X
    const offsetY = this.smoothedFacePosition.y * this.MAX_OFFSET_Y

    // Create off-axis projection matrix
    // This shifts the camera frustum based on face position
    const aspect = this.camera.aspect
    const fov = this.FOV * (Math.PI / 180)
    const near = this.camera.near
    const far = this.camera.far

    const range = far - near

    // Calculate frustum bounds with offset
    const left = (-aspect * near * Math.tan(fov / 2)) + (offsetX * near)
    const right = (aspect * near * Math.tan(fov / 2)) + (offsetX * near)
    const bottom = (-near * Math.tan(fov / 2)) + (offsetY * near)
    const top = (near * Math.tan(fov / 2)) + (offsetY * near)

    // Create custom projection matrix
    const m = new THREE.Matrix4()
    m.set(
      (2 * near) / (right - left), 0, 0, 0,
      0, (2 * near) / (top - bottom), 0, 0,
      (right + left) / (right - left), (top + bottom) / (top - bottom), -(far + near) / range, -1,
      0, 0, -(2 * far * near) / range, 0
    )

    this.camera.projectionMatrix.copy(m)
    this.camera.projectionMatrixInverse.copy(m).invert()
  }

  private animate = async (): Promise<void> => {
    if (!this.isActive || !this.isEnabled) return

    await this.detectFace()
    this.updateCameraProjection()

    if (DEBUG_OFF_AXIS) {
      let debugEl = document.getElementById('off-axis-debug')
      if (!debugEl) {
        debugEl = document.createElement('div')
        debugEl.id = 'off-axis-debug'
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
        <div>faceDetected: ${this.faceDetected ? 'YES' : 'NO'}</div>
        <div>faceX: ${this.facePosition.x.toFixed(3)}</div>
        <div>faceY: ${this.facePosition.y.toFixed(3)}</div>
        <div>faceZ: ${this.facePosition.z.toFixed(3)}</div>
        <div>smoothedX: ${this.smoothedFacePosition.x.toFixed(3)}</div>
        <div>smoothedY: ${this.smoothedFacePosition.y.toFixed(3)}</div>
        <div>trackingFps: ${this.trackingFps}</div>
      `
    }

    this.rafId = requestAnimationFrame(this.animate)
  }

  destroy(): void {
    this.disable()
  }
}
