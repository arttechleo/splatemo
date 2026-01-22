import * as THREE from 'three'

type SplatMeshLike = {
  getSplatCount: () => number
  getSplatCenter: (index: number, out: THREE.Vector3) => void
}

export class SplatParticles {
  private scene: THREE.Scene
  private points: THREE.Points | null = null
  private velocities: Float32Array | null = null
  private startTime = 0
  private duration = 700

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  startFromSplat(
    splatMesh: SplatMeshLike,
    direction: 'up' | 'down',
    duration = 700,
    sampleCount = 6000
  ) {
    this.stop()
    this.duration = duration
    const total = splatMesh.getSplatCount()
    const count = Math.min(sampleCount, total)
    const stride = Math.max(1, Math.floor(total / count))

    const positions = new Float32Array(count * 3)
    const velocities = new Float32Array(count * 3)
    const temp = new THREE.Vector3()
    const scatter = direction === 'up' ? 1 : -1

    for (let i = 0; i < count; i += 1) {
      const index = i * stride
      splatMesh.getSplatCenter(index, temp)
      const baseIndex = i * 3
      positions[baseIndex] = temp.x
      positions[baseIndex + 1] = temp.y
      positions[baseIndex + 2] = temp.z

      velocities[baseIndex] = (Math.random() - 0.5) * 0.7
      velocities[baseIndex + 1] = (Math.random() * 0.8 + 0.4) * scatter
      velocities[baseIndex + 2] = (Math.random() - 0.5) * 0.7
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))

    const material = new THREE.PointsMaterial({
      size: 0.025,
      color: 0xffffff,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    })

    this.points = new THREE.Points(geometry, material)
    this.scene.add(this.points)
    this.velocities = velocities
    this.startTime = performance.now()
  }

  update(time: number) {
    if (!this.points || !this.velocities) return false
    const elapsed = time - this.startTime
    const t = Math.min(1, elapsed / this.duration)
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2

    const positions = this.points.geometry.getAttribute('position') as THREE.BufferAttribute
    for (let i = 0; i < positions.count; i += 1) {
      const index = i * 3
      positions.array[index] += this.velocities[index] * 0.02
      positions.array[index + 1] += this.velocities[index + 1] * 0.02
      positions.array[index + 2] += this.velocities[index + 2] * 0.02
    }
    positions.needsUpdate = true

    const material = this.points.material as THREE.PointsMaterial
    material.opacity = 0.8 * (1 - eased)
    material.size = 0.025 * (1 + eased * 0.6)

    if (t >= 1) {
      this.stop()
      return false
    }
    return true
  }

  stop() {
    if (!this.points) return
    this.scene.remove(this.points)
    this.points.geometry.dispose()
    const material = this.points.material as THREE.Material
    material.dispose()
    this.points = null
    this.velocities = null
  }
}
