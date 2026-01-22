import * as THREE from 'three'
import type { CameraPose } from '../splats/types'

type ViewerLike = {
  camera?: THREE.PerspectiveCamera
  controls?: {
    enabled: boolean
    target: THREE.Vector3
    update: () => void
  }
}

const createCanonicalPoses = (radius: number, height: number): CameraPose[] => [
  { position: [0, height, radius], target: [0, 0, 0] },
  { position: [radius, height, 0], target: [0, 0, 0] },
  { position: [0, height, -radius], target: [0, 0, 0] },
  { position: [-radius, height, 0], target: [0, 0, 0] },
]

export class CameraPoseManager {
  private viewer: ViewerLike
  private poses: CameraPose[]
  private isSnapping = false
  private activeIndex = 0

  constructor(viewer: ViewerLike, poses: CameraPose[] | null | undefined) {
    this.viewer = viewer
    const radius = 6
    const height = 1.2
    this.poses = poses?.length ? poses : createCanonicalPoses(radius, height)
  }

  getPoseList() {
    return this.poses
  }

  get isTransitioning() {
    return this.isSnapping
  }

  snapTo(index: number, duration = 650) {
    const camera = this.viewer.camera
    const controls = this.viewer.controls
    if (!camera || !controls || this.isSnapping) return

    this.isSnapping = true
    controls.enabled = false

    const pose = this.poses[index % this.poses.length]
    this.activeIndex = index % this.poses.length

    const startPos = camera.position.clone()
    const startTarget = controls.target.clone()
    const endPos = new THREE.Vector3(...pose.position)
    const endTarget = new THREE.Vector3(...pose.target)

    const start = performance.now()
    const animate = (time: number) => {
      const t = Math.min(1, (time - start) / duration)
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
      camera.position.lerpVectors(startPos, endPos, eased)
      controls.target.lerpVectors(startTarget, endTarget, eased)
      controls.update()
      if (t < 1) {
        requestAnimationFrame(animate)
      } else {
        controls.enabled = true
        this.isSnapping = false
      }
    }

    requestAnimationFrame(animate)
  }

  snapToNext() {
    this.snapTo(this.activeIndex + 1)
  }
}
