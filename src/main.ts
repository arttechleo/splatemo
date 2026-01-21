import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) {
  throw new Error('App root not found')
}

app.innerHTML = `
  <div class="app">
    <header class="hud">
      <div>
        <p class="eyebrow">Gaussian Splatting Prototype</p>
        <h1>Splatemō</h1>
        <p class="subtitle">Three.js point splats with a soft Gaussian shader.</p>
      </div>
      <div class="stats">
        <span id="splat-count">0</span>
        <span class="muted">splats</span>
      </div>
    </header>
    <div class="canvas-wrap">
      <canvas id="scene"></canvas>
    </div>
    <section class="controls">
      <label>
        Density
        <input id="density" type="range" min="4000" max="40000" step="1000" value="16000" />
      </label>
      <label>
        Radius
        <input id="radius" type="range" min="1.4" max="5.2" step="0.1" value="3.2" />
      </label>
      <label class="toggle">
        <input id="autoRotate" type="checkbox" checked />
        Auto-rotate
      </label>
      <label class="toggle">
        <input id="quality" type="checkbox" />
        High quality
      </label>
      <button id="regenerate" type="button">Regenerate</button>
    </section>
    <footer class="hint">Drag to orbit · Pinch to zoom · Two-finger pan</footer>
  </div>
`

const canvas = document.querySelector<HTMLCanvasElement>('#scene')
const splatCountLabel = document.querySelector<HTMLSpanElement>('#splat-count')
const densityInput = document.querySelector<HTMLInputElement>('#density')
const radiusInput = document.querySelector<HTMLInputElement>('#radius')
const autoRotateInput = document.querySelector<HTMLInputElement>('#autoRotate')
const qualityInput = document.querySelector<HTMLInputElement>('#quality')
const regenerateButton = document.querySelector<HTMLButtonElement>('#regenerate')

if (
  !canvas ||
  !splatCountLabel ||
  !densityInput ||
  !radiusInput ||
  !autoRotateInput ||
  !qualityInput ||
  !regenerateButton
) {
  throw new Error('UI elements not found')
}

const scene = new THREE.Scene()
scene.fog = new THREE.Fog(0x070b14, 4, 16)

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 60)
camera.position.set(0, 0.6, 7.2)

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
  powerPreference: 'high-performance',
})
renderer.setClearColor(0x070b14, 1)

const controls = new OrbitControls(camera, canvas)
controls.enableDamping = true
controls.dampingFactor = 0.06
controls.autoRotate = true
controls.autoRotateSpeed = 0.4
controls.enablePan = true
controls.minDistance = 2.2
controls.maxDistance = 16
controls.target.set(0, 0.2, 0)

const material = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: {
    uTime: { value: 0 },
  },
  vertexShader: `
    attribute float size;
    attribute vec3 color;
    attribute float opacity;
    varying vec3 vColor;
    varying float vOpacity;
    uniform float uTime;

    void main() {
      vColor = color;
      vOpacity = opacity;
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      float pulse = 0.12 * sin(uTime * 0.6 + position.y * 1.5);
      float distanceScale = 280.0 / max(0.2, -mvPosition.z);
      gl_PointSize = size * (1.0 + pulse) * distanceScale;
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: `
    varying vec3 vColor;
    varying float vOpacity;

    void main() {
      vec2 coord = gl_PointCoord - vec2(0.5);
      float r = dot(coord, coord) * 4.0;
      float alpha = exp(-r * 4.0) * vOpacity;
      gl_FragColor = vec4(vColor, alpha);
    }
  `,
})

let splatPoints: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null
let plyData: PlyData | null = null

const settings = {
  count: Number(densityInput.value),
  radius: Number(radiusInput.value),
}

const palette = (t: number) => {
  const color = new THREE.Color()
  color.setHSL((0.62 + t * 0.35) % 1, 0.72, 0.58)
  return color
}

type PlyData = {
  count: number
  positions: Float32Array
  colors: Float32Array | null
  opacities: Float32Array | null
  bounds: { min: THREE.Vector3; max: THREE.Vector3 }
}

const parsePly = (text: string): PlyData => {
  const lines = text.split(/\r?\n/)
  let format = ''
  let vertexCount = 0
  let properties: string[] = []
  let inVertexElement = false
  let dataStart = 0

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim()
    if (!line) continue
    if (line.startsWith('format')) {
      format = line
      continue
    }
    if (line.startsWith('element vertex')) {
      vertexCount = Number(line.split(' ').at(-1))
      inVertexElement = true
      continue
    }
    if (line.startsWith('element') && !line.startsWith('element vertex')) {
      inVertexElement = false
      continue
    }
    if (inVertexElement && line.startsWith('property')) {
      const tokens = line.split(' ')
      properties.push(tokens[tokens.length - 1])
      continue
    }
    if (line === 'end_header') {
      dataStart = i + 1
      break
    }
  }

  if (!format.includes('ascii')) {
    throw new Error('Only ASCII PLY files are supported')
  }

  const xIndex = properties.indexOf('x')
  const yIndex = properties.indexOf('y')
  const zIndex = properties.indexOf('z')
  if (xIndex === -1 || yIndex === -1 || zIndex === -1) {
    throw new Error('PLY is missing position attributes')
  }

  const colorIndices = [
    properties.indexOf('red'),
    properties.indexOf('green'),
    properties.indexOf('blue'),
  ]
  const altColorIndices = [
    properties.indexOf('r'),
    properties.indexOf('g'),
    properties.indexOf('b'),
  ]
  const useAltColors = colorIndices.some((index) => index === -1)
  const [rIndex, gIndex, bIndex] = useAltColors ? altColorIndices : colorIndices
  const hasColors = rIndex !== -1 && gIndex !== -1 && bIndex !== -1

  const opacityIndex =
    properties.indexOf('alpha') !== -1
      ? properties.indexOf('alpha')
      : properties.indexOf('opacity')

  const positions = new Float32Array(vertexCount * 3)
  const colors = hasColors ? new Float32Array(vertexCount * 3) : null
  const opacities = opacityIndex !== -1 ? new Float32Array(vertexCount) : null
  const min = new THREE.Vector3(Infinity, Infinity, Infinity)
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity)

  for (let i = 0; i < vertexCount; i += 1) {
    const line = lines[dataStart + i]
    if (!line) continue
    const values = line.trim().split(/\s+/).map(Number)
    const positionIndex = i * 3
    const x = values[xIndex]
    const y = values[yIndex]
    const z = values[zIndex]
    positions[positionIndex] = x
    positions[positionIndex + 1] = y
    positions[positionIndex + 2] = z
    min.min(new THREE.Vector3(x, y, z))
    max.max(new THREE.Vector3(x, y, z))

    if (colors) {
      const r = values[rIndex] ?? 255
      const g = values[gIndex] ?? 255
      const b = values[bIndex] ?? 255
      colors[positionIndex] = r / 255
      colors[positionIndex + 1] = g / 255
      colors[positionIndex + 2] = b / 255
    }

    if (opacities) {
      const a = values[opacityIndex] ?? 255
      opacities[i] = THREE.MathUtils.clamp(a / 255, 0.1, 1)
    }
  }

  return {
    count: vertexCount,
    positions,
    colors,
    opacities,
    bounds: { min, max },
  }
}

const loadPly = async (url: string) => {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to load PLY: ${response.status}`)
  }
  const text = await response.text()
  return parsePly(text)
}

const createSplatGeometry = (count: number, radius: number) => {
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const sizes = new Float32Array(count)
  const opacities = new Float32Array(count)

  for (let i = 0; i < count; i += 1) {
    const u = Math.random()
    const v = Math.random()
    const theta = 2 * Math.PI * u
    const phi = Math.acos(2 * v - 1)
    const baseRadius = radius * Math.pow(Math.random(), 0.6)

    const swirl = Math.sin(theta * 3 + baseRadius * 2.2) * 0.35
    const x = (baseRadius + swirl) * Math.sin(phi) * Math.cos(theta)
    const y = baseRadius * Math.cos(phi) * 0.7 + Math.sin(theta * 2) * 0.25
    const z = (baseRadius - swirl) * Math.sin(phi) * Math.sin(theta)

    const index = i * 3
    positions[index] = x
    positions[index + 1] = y
    positions[index + 2] = z

    const color = palette(i / count)
    colors[index] = color.r
    colors[index + 1] = color.g
    colors[index + 2] = color.b

    sizes[i] = THREE.MathUtils.lerp(10, 26, Math.random())
    opacities[i] = THREE.MathUtils.lerp(0.25, 0.9, Math.random())
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1))
  geometry.setAttribute('opacity', new THREE.BufferAttribute(opacities, 1))
  geometry.computeBoundingSphere()
  return geometry
}

const createPlyGeometry = (data: PlyData, count: number, radius: number) => {
  const targetCount = Math.min(count, data.count)
  const positions = new Float32Array(targetCount * 3)
  const colors = new Float32Array(targetCount * 3)
  const sizes = new Float32Array(targetCount)
  const opacities = new Float32Array(targetCount)

  const center = data.bounds.min.clone().add(data.bounds.max).multiplyScalar(0.5)
  const size = data.bounds.max.clone().sub(data.bounds.min)
  const maxExtent = Math.max(size.x, size.y, size.z)
  const scale = maxExtent > 0 ? radius / (maxExtent * 0.5) : 1

  const step = Math.max(1, Math.floor(data.count / targetCount))
  const offset = Math.floor(Math.random() * step)

  for (let i = 0; i < targetCount; i += 1) {
    const sourceIndex = (offset + i * step) % data.count
    const sourcePositionIndex = sourceIndex * 3
    const targetPositionIndex = i * 3

    const x = (data.positions[sourcePositionIndex] - center.x) * scale
    const y = (data.positions[sourcePositionIndex + 1] - center.y) * scale
    const z = (data.positions[sourcePositionIndex + 2] - center.z) * scale

    positions[targetPositionIndex] = x
    positions[targetPositionIndex + 1] = y
    positions[targetPositionIndex + 2] = z

    if (data.colors) {
      colors[targetPositionIndex] = data.colors[sourcePositionIndex]
      colors[targetPositionIndex + 1] = data.colors[sourcePositionIndex + 1]
      colors[targetPositionIndex + 2] = data.colors[sourcePositionIndex + 2]
    } else {
      const color = palette(i / targetCount)
      colors[targetPositionIndex] = color.r
      colors[targetPositionIndex + 1] = color.g
      colors[targetPositionIndex + 2] = color.b
    }

    sizes[i] = THREE.MathUtils.lerp(8, 22, Math.random())
    if (data.opacities) {
      opacities[i] = data.opacities[sourceIndex]
    } else {
      opacities[i] = THREE.MathUtils.lerp(0.3, 0.9, Math.random())
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1))
  geometry.setAttribute('opacity', new THREE.BufferAttribute(opacities, 1))
  geometry.computeBoundingSphere()
  return geometry
}

const rebuildSplats = () => {
  if (splatPoints) {
    splatPoints.geometry.dispose()
    scene.remove(splatPoints)
  }

  const geometry = plyData
    ? createPlyGeometry(plyData, settings.count, settings.radius)
    : createSplatGeometry(settings.count, settings.radius)
  splatPoints = new THREE.Points(geometry, material)
  scene.add(splatPoints)

  splatCountLabel.textContent = settings.count.toLocaleString()
}

const resizeRenderer = () => {
  const parent = canvas.parentElement
  if (!parent) return
  const { clientWidth, clientHeight } = parent
  camera.aspect = clientWidth / clientHeight
  camera.updateProjectionMatrix()
  renderer.setSize(clientWidth, clientHeight, false)
}

const setPixelRatio = () => {
  const pixelRatio = qualityInput.checked ? Math.min(window.devicePixelRatio, 2) : 1
  renderer.setPixelRatio(pixelRatio)
}

densityInput.addEventListener('input', () => {
  settings.count = Number(densityInput.value)
  rebuildSplats()
})

radiusInput.addEventListener('input', () => {
  settings.radius = Number(radiusInput.value)
  rebuildSplats()
})

autoRotateInput.addEventListener('change', () => {
  controls.autoRotate = autoRotateInput.checked
})

qualityInput.addEventListener('change', () => {
  setPixelRatio()
  resizeRenderer()
})

regenerateButton.addEventListener('click', () => {
  rebuildSplats()
})

const resizeObserver = new ResizeObserver(() => resizeRenderer())
resizeObserver.observe(canvas.parentElement ?? canvas)

const updateDensityRange = (total: number) => {
  const minCount = Math.max(100, Math.min(1000, total))
  densityInput.min = String(minCount)
  densityInput.max = String(total)
  densityInput.step = String(Math.max(50, Math.floor(total / 200)))
  settings.count = Math.min(Number(densityInput.value), total)
  densityInput.value = String(settings.count)
}

const focusOnBounds = (bounds: PlyData['bounds']) => {
  const center = bounds.min.clone().add(bounds.max).multiplyScalar(0.5)
  const size = bounds.max.clone().sub(bounds.min)
  const radius = Math.max(size.x, size.y, size.z)
  controls.target.copy(center)
  camera.position.set(center.x, center.y + radius * 0.4, center.z + radius * 2.4)
  camera.updateProjectionMatrix()
}

const initSplats = async () => {
  try {
    plyData = await loadPly('/splats/gs_Isetta_Car.ply')
    updateDensityRange(plyData.count)
    focusOnBounds(plyData.bounds)
  } catch (error) {
    console.warn('Falling back to procedural splats', error)
  } finally {
    rebuildSplats()
  }
}

setPixelRatio()
resizeRenderer()
void initSplats()

const clock = new THREE.Clock()

const animate = () => {
  const elapsed = clock.getElapsedTime()
  material.uniforms.uTime.value = elapsed
  if (splatPoints) {
    splatPoints.rotation.y = elapsed * 0.05
  }
  controls.update()
  renderer.render(scene, camera)
}

renderer.setAnimationLoop(animate)
