import * as THREE from 'three'

type SplatMeshLike = {
  getSplatCount: () => number
  getSplatCenter: (index: number, out: THREE.Vector3) => void
}

export class ParticleDisintegration {
  private scene: THREE.Scene
  private points: THREE.Points | null = null
  private velocities: Float32Array | null = null
  private startTime = 0
  private duration = 700

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  start(splatMesh: SplatMeshLike, direction: 'up' | 'down') {
    this.stop()
    const total = splatMesh.getSplatCount()
    const count = Math.min(8000, total)
    const stride = Math.max(1, Math.floor(total / count))
    const positions = new Float32Array(count * 3)
    const velocities = new Float32Array(count * 3)
    const temp = new THREE.Vector3()

    for (let i = 0; i < count; i += 1) {
      const splatIndex = i * stride
      splatMesh.getSplatCenter(splatIndex, temp)
      const idx = i * 3
      positions[idx] = temp.x
      positions[idx + 1] = temp.y
      positions[idx + 2] = temp.z

      velocities[idx] = (Math.random() - 0.5) * 0.6
      velocities[idx + 1] = (Math.random() * 0.9 + 0.2) * (direction === 'up' ? 1 : -1)
      velocities[idx + 2] = (Math.random() - 0.5) * 0.6
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const material = new THREE.PointsMaterial({
      size: 0.03,
      color: 0xffffff,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    })

    this.points = new THREE.Points(geometry, material)
    this.scene.add(this.points)
    this.velocities = velocities
    this.startTime = performance.now()
    return count
  }

  update(time: number) {
    if (!this.points || !this.velocities) return
    const elapsed = time - this.startTime
    const t = Math.min(1, elapsed / this.duration)
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2

    const positions = this.points.geometry.getAttribute('position') as THREE.BufferAttribute
    for (let i = 0; i < positions.count; i += 1) {
      const idx = i * 3
      positions.array[idx] += this.velocities[idx] * 0.02
      positions.array[idx + 1] += this.velocities[idx + 1] * 0.02
      positions.array[idx + 2] += this.velocities[idx + 2] * 0.02
    }
    positions.needsUpdate = true

    const material = this.points.material as THREE.PointsMaterial
    material.opacity = 0.8 * (1 - eased)
    material.size = 0.03 * (1 + eased * 0.6)

    if (t >= 1) {
      this.stop()
    }
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
