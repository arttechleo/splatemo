/**
 * Discovery Features
 * Interactive features to make splat viewing more entertaining.
 * All overlay/camera/UI only - no rendering internals modified.
 */

import * as THREE from 'three'

export type DiscoveryMode = 'calm' | 'vivid' | 'gallery' | 'inspect'

export interface DiscoveryConfig {
  mode: DiscoveryMode
  enabled: boolean
}

export class Discovery {
  private camera: THREE.PerspectiveCamera | null = null
  private controls: { 
    target?: THREE.Vector3
    enableZoom?: boolean
    minDistance?: number
    maxDistance?: number
    autoRotate?: boolean
    autoRotateSpeed?: number
  } | null = null
  
  private config: DiscoveryConfig = {
    mode: 'calm',
    enabled: false,
  }
  
  // Gallery mode auto-orbit
  private galleryOrbitSpeed = 0.3 // degrees per frame
  
  // Inspect mode
  private inspectZoomRange = { min: 0.5, max: 20 }
  private defaultZoomRange = { min: 1, max: 10 }
  
  // Guided poses
  private currentPoseIndex = 0
  private poseAnimation: number | null = null
  private poseStartTime = 0
  private poseDuration = 400 // ms
  private poseStart: { position: THREE.Vector3; target: THREE.Vector3 } | null = null
  private poseEnd: { position: THREE.Vector3; target: THREE.Vector3 } | null = null
  
  // Default poses (generic, can be overridden per-splat)
  private defaultPoses: Array<{
    position: [number, number, number]
    target: [number, number, number]
    name: string
  }> = [
    { position: [0, 0, 6], target: [0, 0, 0], name: 'Front' },
    { position: [6, 0, 0], target: [0, 0, 0], name: 'Right' },
    { position: [-6, 0, 0], target: [0, 0, 0], name: 'Left' },
    { position: [0, 6, 0], target: [0, 0, 0], name: 'Top' },
    { position: [0, 0, -6], target: [0, 0, 0], name: 'Back' },
  ]
  
  setCamera(camera: THREE.PerspectiveCamera | null, controls: {
    target?: THREE.Vector3
    enableZoom?: boolean
    minDistance?: number
    maxDistance?: number
    autoRotate?: boolean
    autoRotateSpeed?: number
  } | null): void {
    this.camera = camera
    this.controls = controls
  }
  
  setConfig(config: Partial<DiscoveryConfig>): void {
    this.config = { ...this.config, ...config }
    this.applyMode()
  }
  
  getConfig(): DiscoveryConfig {
    return { ...this.config }
  }
  
  private applyMode(): void {
    if (!this.controls) return
    
    switch (this.config.mode) {
      case 'calm':
        // Effects off or subtle (handled by EffectsController)
        if (this.controls.autoRotate !== undefined) {
          this.controls.autoRotate = false
        }
        this.setZoomRange(this.defaultZoomRange.min, this.defaultZoomRange.max)
        break
        
      case 'vivid':
        // Effects intensity up (handled by EffectsController)
        if (this.controls.autoRotate !== undefined) {
          this.controls.autoRotate = false
        }
        this.setZoomRange(this.defaultZoomRange.min, this.defaultZoomRange.max)
        break
        
      case 'gallery':
        // Slow auto-orbit + hide most UI
        if (this.controls.autoRotate !== undefined) {
          this.controls.autoRotate = true
          if (this.controls.autoRotateSpeed !== undefined) {
            this.controls.autoRotateSpeed = this.galleryOrbitSpeed
          }
        }
        this.setZoomRange(this.defaultZoomRange.min, this.defaultZoomRange.max)
        break
        
      case 'inspect':
        // Wider zoom + focus reticle
        if (this.controls.autoRotate !== undefined) {
          this.controls.autoRotate = false
        }
        this.setZoomRange(this.inspectZoomRange.min, this.inspectZoomRange.max)
        break
    }
  }
  
  private setZoomRange(min: number, max: number): void {
    if (!this.controls) return
    if (this.controls.minDistance !== undefined) {
      this.controls.minDistance = min
    }
    if (this.controls.maxDistance !== undefined) {
      this.controls.maxDistance = max
    }
  }
  
  /**
   * Navigate to next guided pose.
   */
  nextPose(): void {
    if (!this.camera || !this.controls?.target) return
    
    this.currentPoseIndex = (this.currentPoseIndex + 1) % this.defaultPoses.length
    const pose = this.defaultPoses[this.currentPoseIndex]
    
    // Store current state
    this.poseStart = {
      position: this.camera.position.clone(),
      target: this.controls.target.clone(),
    }
    
    // Set target state
    this.poseEnd = {
      position: new THREE.Vector3(...pose.position),
      target: new THREE.Vector3(...pose.target),
    }
    
    // Start animation
    this.poseStartTime = performance.now()
    if (this.poseAnimation) {
      cancelAnimationFrame(this.poseAnimation)
    }
    this.animatePose()
  }
  
  private animatePose = (): void => {
    if (!this.camera || !this.controls?.target || !this.poseStart || !this.poseEnd) {
      return
    }
    
    const elapsed = performance.now() - this.poseStartTime
    const t = Math.min(1, elapsed / this.poseDuration)
    
    // Ease in-out cubic
    const eased = t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2
    
    // Interpolate position and target
    this.camera.position.lerpVectors(this.poseStart.position, this.poseEnd.position, eased)
    this.controls.target.lerpVectors(this.poseStart.target, this.poseEnd.target, eased)
    
    if (t < 1) {
      this.poseAnimation = requestAnimationFrame(this.animatePose)
    } else {
      this.poseAnimation = null
    }
  }
  
  getCurrentPoseName(): string {
    return this.defaultPoses[this.currentPoseIndex]?.name || 'Unknown'
  }
  
  destroy(): void {
    if (this.poseAnimation) {
      cancelAnimationFrame(this.poseAnimation)
      this.poseAnimation = null
    }
  }
}
