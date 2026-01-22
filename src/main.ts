import './style.css'
import * as THREE from 'three'
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d'

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) {
  throw new Error('App root not found')
}

const viewerRoot = document.createElement('div')
viewerRoot.id = 'viewer'
app.appendChild(viewerRoot)

const isMobile = /Mobi|Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
const manifestUrl = '/splats/manifest.json'

const viewer = new GaussianSplats3D.Viewer({
  rootElement: viewerRoot,
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
  viewer.renderer.domElement.addEventListener('webglcontextlost', (event: Event) => {
    event.preventDefault()
    console.error('WebGL context lost')
  })
  viewer.renderer.domElement.addEventListener('webglcontextrestored', () => {
    console.warn('WebGL context restored')
  })
}

let currentSplatMesh:
  | { material?: { depthWrite: boolean }; getSplatCount: () => number }
  | null = null

viewer.onSplatMeshChanged((splatMesh: typeof currentSplatMesh) => {
  console.log('Splat mesh ready')
  currentSplatMesh = splatMesh
  if (splatMesh?.material) {
    splatMesh.material.depthWrite = false
  }
  const viewerAny = viewer as unknown as { splatMesh?: { getSplatCount: () => number } }
  if (viewerAny.splatMesh) {
    console.log('Splat count', viewerAny.splatMesh.getSplatCount())
  }
  console.log('3D splat mesh ready')
  console.log('Splat mesh parent', (splatMesh as unknown as { parent?: unknown }).parent)
  const rendererInfo = viewer.renderer?.info
  console.log('Renderer programs', rendererInfo?.programs?.length)
})

type SplatEntry = {
  id: string
  name?: string
  file: string
}

const splatCache = new Map<string, string>()
let splatEntries: SplatEntry[] = []
let currentIndex = 0
let hasScene = false
let isLoading = false

const logSplatHead = async (url: string) => {
  try {
    const headResponse = await fetch(url, { method: 'HEAD' })
    console.log('PLY HEAD status', url, headResponse.status)
    const length = headResponse.headers.get('content-length')
    console.log('PLY content-length', url, length)
  } catch (error) {
    console.warn('PLY HEAD failed', url, error)
  }
}

const loadManifest = async () => {
  const response = await fetch(manifestUrl, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`Manifest fetch failed: ${response.status}`)
  }
  const data = (await response.json()) as SplatEntry[]
  console.log('Manifest entries', data.length)
  return data
}

const prefetchSplat = async (entry: SplatEntry) => {
  if (splatCache.has(entry.id)) return
  const url = `/splats/${entry.file}`
  await logSplatHead(url)
  const response = await fetch(url)
  if (!response.ok) {
    console.warn('Prefetch failed', url, response.status)
    return
  }
  const blob = await response.blob()
  console.log('Prefetch size', url, blob.size)
  const objectUrl = URL.createObjectURL(blob)
  splatCache.set(entry.id, objectUrl)
}

const loadSplat = async (index: number) => {
  if (isLoading) return
  const entry = splatEntries[index]
  if (!entry) return
  isLoading = true

  const url = `/splats/${entry.file}`
  await logSplatHead(url)

  if (hasScene) {
    await viewer.removeSplatScene(0, false)
  }

  const sourceUrl = splatCache.get(entry.id) ?? url
  await viewer.addSplatScene(sourceUrl, {
    showLoadingUI: true,
    progressiveLoad: true,
    splatAlphaRemovalThreshold: 5,
    rotation: [1, 0, 0, 0],
    onProgress: (percent: number) => {
      console.log('Splat load progress', entry.id, percent)
    },
  })

  if (sourceUrl !== url) {
    URL.revokeObjectURL(sourceUrl)
    splatCache.delete(entry.id)
  }

  currentIndex = index
  hasScene = true
  isLoading = false

  const nextIndex = (currentIndex + 1) % splatEntries.length
  if (splatEntries[nextIndex]) {
    void prefetchSplat(splatEntries[nextIndex])
  }
}

const setupOrbitControls = () => {
  if (!viewer.controls) return
  const controls = viewer.controls as unknown as {
    enableZoom: boolean
    enablePan: boolean
    enableRotate: boolean
    enableDamping: boolean
    dampingFactor: number
    addEventListener: (event: string, callback: () => void) => void
    target: THREE.Vector3
  }
  controls.enableDamping = false
  controls.dampingFactor = 0
  viewer.controls.enableZoom = false
  viewer.controls.enablePan = false
  viewer.controls.enableRotate = true
  controls.addEventListener('change', () => {
    const camera = viewer.camera
    if (!camera) return
    const pos = camera.position
    console.log('Orbit change', pos.x, pos.y, pos.z, 'target', controls.target.toArray())
  })
}

const setupPointerDebug = () => {
  const logPointer = (event: PointerEvent, phase: string) => {
    console.log(`Pointer ${phase}`, event.pointerId, event.pointerType)
  }

  viewerRoot.addEventListener('pointerdown', (event) => {
    logPointer(event, 'down')
    try {
      viewerRoot.setPointerCapture(event.pointerId)
    } catch (error) {
      console.warn('setPointerCapture failed', event.pointerId, error)
    }
  })

  viewerRoot.addEventListener('pointermove', (event) => {
    logPointer(event, 'move')
  })

  viewerRoot.addEventListener('pointerup', (event) => {
    logPointer(event, 'up')
    try {
      if (viewerRoot.hasPointerCapture(event.pointerId)) {
        viewerRoot.releasePointerCapture(event.pointerId)
      }
    } catch (error) {
      console.warn('releasePointerCapture failed', event.pointerId, error)
    }
  })
}

const setupSplatNavigation = () => {
  console.log('Splat navigation disabled for debug')
}

const start = async () => {
  console.log('Device', isMobile ? 'mobile' : 'desktop')
  console.log('Renderer pixel ratio', viewer.renderer?.getPixelRatio())
  splatEntries = await loadManifest()
  await loadSplat(0)
  setupPointerDebug()
  setupOrbitControls()
  setupSplatNavigation()
  viewer.start()
  const camera = viewer.camera
  if (camera) {
    console.log('Camera position', camera.position.toArray())
    const target = (viewer.controls as unknown as { target?: THREE.Vector3 })?.target
    if (target) {
      camera.lookAt(target)
      console.log('Camera target', target.toArray())
    }
  }
}

start().catch((error: unknown) => {
  console.error('Failed to load splat scene', error)
})
