import * as THREE from 'three'

const createSeededRandom = (seed: number) => {
  let value = seed
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296
    return value / 4294967296
  }
}

export const createParticleOverlay = (container: HTMLElement) => {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100)
  camera.position.set(0, 0, 6)
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
  renderer.setSize(container.clientWidth, container.clientHeight)
  renderer.domElement.className = 'particle-layer'
  container.appendChild(renderer.domElement)

  let points: THREE.Points | null = null
  let velocities: Float32Array | null = null
  let startTime = 0
  let duration = 650
  let resolveDone: (() => void) | null = null

  const resize = () => {
    const { clientWidth, clientHeight } = container
    camera.aspect = clientWidth / clientHeight
    camera.updateProjectionMatrix()
    renderer.setSize(clientWidth, clientHeight)
  }

  window.addEventListener('resize', resize)
  resize()

  const start = (direction: 'up' | 'down', count = 2000) => {
    stop()
    const random = createSeededRandom(direction === 'up' ? 1234 : 5678)
    const positions = new Float32Array(count * 3)
    const vels = new Float32Array(count * 3)
    for (let i = 0; i < count; i += 1) {
      const i3 = i * 3
      const radius = random() * 1.5
      const theta = random() * Math.PI * 2
      const phi = Math.acos(2 * random() - 1)
      positions[i3] = radius * Math.sin(phi) * Math.cos(theta)
      positions[i3 + 1] = radius * Math.cos(phi)
      positions[i3 + 2] = radius * Math.sin(phi) * Math.sin(theta)
      vels[i3] = (random() - 0.5) * 0.6
      vels[i3 + 1] = (random() * 0.9 + 0.2) * (direction === 'up' ? 1 : -1)
      vels[i3 + 2] = (random() - 0.5) * 0.6
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
    points = new THREE.Points(geometry, material)
    scene.add(points)
    velocities = vels
    startTime = performance.now()
    return new Promise<void>((resolve) => {
      resolveDone = resolve
    })
  }

  const update = (time: number) => {
    if (!points || !velocities) return
    const elapsed = time - startTime
    const t = Math.min(1, elapsed / duration)
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
    const positions = points.geometry.getAttribute('position') as THREE.BufferAttribute
    for (let i = 0; i < positions.count; i += 1) {
      const i3 = i * 3
      positions.array[i3] += velocities[i3] * 0.02
      positions.array[i3 + 1] += velocities[i3 + 1] * 0.02
      positions.array[i3 + 2] += velocities[i3 + 2] * 0.02
    }
    positions.needsUpdate = true
    const material = points.material as THREE.PointsMaterial
    material.opacity = 0.8 * (1 - eased)
    material.size = 0.03 * (1 + eased * 0.6)
    renderer.render(scene, camera)
    if (t >= 1) {
      stop()
      resolveDone?.()
      resolveDone = null
    }
  }

  const stop = () => {
    if (!points) return
    scene.remove(points)
    points.geometry.dispose()
    const material = points.material as THREE.Material
    material.dispose()
    points = null
    velocities = null
  }

  return {
    start,
    update,
    resize,
  }
}
