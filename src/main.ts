import './style.css'
import * as THREE from 'three'
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d'
import { loadSplatManifest } from './splats/manifest'
import { SplatManager } from './splats/SplatManager'
import { AnnotationManager, type Annotation } from './annotations/AnnotationManager'
import { SplatParticles } from './transitions/SplatParticles'
import { SplatNavigator } from './transitions/SplatNavigator'
import { CameraPoseManager } from './camera/CameraPoseManager'
import { createOverlay } from './ui/overlay'

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) {
  throw new Error('App root not found')
}

const viewerRoot = document.createElement('div')
viewerRoot.id = 'viewer'
app.appendChild(viewerRoot)

const poster = document.createElement('div')
poster.className = 'poster'
poster.innerHTML = `
  <div class="poster__content">
    <div class="poster__title">Loading volumetric scene</div>
  </div>
`
app.appendChild(poster)

const annotationsRoot = document.createElement('div')
annotationsRoot.className = 'annotations'
app.appendChild(annotationsRoot)

const overlay = createOverlay()
overlay.classList.add('overlay--hidden')
app.appendChild(overlay)

const isMobile = /Mobi|Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)

const threeScene = new THREE.Scene()

const viewer = new GaussianSplats3D.Viewer({
  rootElement: viewerRoot,
  threeScene,
  cameraUp: [0, 1, 0],
  initialCameraPosition: [0, 0, 6],
  initialCameraLookAt: [0, 0, 0],
  sharedMemoryForWorkers: false,
  gpuAcceleratedSort: false,
  useBuiltInControls: true,
  renderMode: GaussianSplats3D.RenderMode.OnChange,
  sceneRevealMode: GaussianSplats3D.SceneRevealMode.Instant,
  sphericalHarmonicsDegree: isMobile ? 0 : 1,
  splatSortDistanceMapPrecision: isMobile ? 12 : 16,
  halfPrecisionCovariancesOnGPU: isMobile,
  antialiased: false,
  kernel2DSize: isMobile ? 0.18 : 0.24,
  webXRMode: GaussianSplats3D.WebXRMode.None,
  logLevel: GaussianSplats3D.LogLevel.None,
})

if (viewer.renderer) {
  viewer.renderer.setClearColor(0x000000, 1)
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5)
  viewer.renderer.setPixelRatio(pixelRatio)
}

let currentSplatMesh: {
  material?: { depthWrite: boolean }
  getSplatCount: () => number
  getSplatCenter: (index: number, out: THREE.Vector3) => void
} | null = null

viewer.onSplatMeshChanged((splatMesh: typeof currentSplatMesh) => {
  currentSplatMesh = splatMesh
  if (splatMesh?.material) {
    splatMesh.material.depthWrite = false
  }
  poster.classList.add('poster--hidden')
  overlay.classList.remove('overlay--hidden')
})

const progressLabel = document.createElement('div')
progressLabel.className = 'poster__progress'
const posterContent = poster.querySelector<HTMLDivElement>('.poster__content')
posterContent?.appendChild(progressLabel)

const setRenderMode = (mode: number) => {
  const viewerWithMode = viewer as unknown as { setRenderMode?: (value: number) => void }
  viewerWithMode.setRenderMode?.(mode)
}

const startViewer = async () => {
  viewer.start()

  const entries = await loadSplatManifest()
  const manager = new SplatManager(viewer, entries, {
    rotation: [1, 0, 0, 0],
    onProgress: (percent) => {
      progressLabel.textContent = `Loading ${Math.round(percent)}%`
    },
  })

  await manager.loadInitial()

  if (viewer.controls) {
    viewer.controls.enableZoom = false
    viewer.controls.enablePan = false
    viewer.controls.enableRotate = true
    viewer.controls.enableDamping = true
    viewer.controls.dampingFactor = 0.08
  }

  const annotations: Annotation[] = [
    {
      id: 'door',
      title: 'Doorline',
      body: 'Compact cabin design.',
      position: new THREE.Vector3(0.25, 0.4, 0.3),
      minAngle: 0,
      maxAngle: Math.PI * 0.7,
    },
    {
      id: 'wheel',
      title: 'Wheelbase',
      body: 'Classic microcar stance.',
      position: new THREE.Vector3(-0.4, -0.2, 0.6),
      minAngle: 0,
      maxAngle: Math.PI * 0.6,
    },
  ]
  const annotationManager = new AnnotationManager(viewer, annotationsRoot, annotations)

  const poseManager = new CameraPoseManager(viewer, manager.getCurrentEntry().poses)

  const particles = new SplatParticles(threeScene)
  const navigator = new SplatNavigator(manager, particles, {
    duration: 700,
    getSplatMesh: () => currentSplatMesh,
    onTransitionStart: () => {
      overlay.classList.add('overlay--hidden')
      setRenderMode(GaussianSplats3D.RenderMode.Always)
    },
    onTransitionEnd: () => {
      overlay.classList.remove('overlay--hidden')
      setRenderMode(GaussianSplats3D.RenderMode.OnChange)
    },
  })
  navigator.attach(viewerRoot)

  let lastTap = 0
  viewerRoot.addEventListener('pointerup', () => {
    const now = Date.now()
    if (now - lastTap < 300) {
      poseManager.snapToNext()
    }
    lastTap = now
  })

  const tick = (time: number) => {
    annotationManager.update()
    particles.update(time)
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

startViewer().catch((error: unknown) => {
  console.error('Failed to start viewer', error)
})
