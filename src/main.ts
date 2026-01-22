import './style.css'
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d'

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) {
  throw new Error('App root not found')
}

const viewerRoot = document.createElement('div')
viewerRoot.id = 'viewer'
app.appendChild(viewerRoot)

const isMobile = /Mobi|Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
const splatUrl = '/splats/gs_Isetta_Car.ply'

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

viewer.onSplatMeshChanged((splatMesh: { material?: { depthWrite: boolean } }) => {
  console.log('Splat mesh ready')
  if (splatMesh.material) {
    splatMesh.material.depthWrite = false
  }
  const viewerAny = viewer as unknown as { splatMesh?: { getSplatCount: () => number } }
  if (viewerAny.splatMesh) {
    console.log('Splat count', viewerAny.splatMesh.getSplatCount())
  }
})

const logSplatHead = async () => {
  try {
    const headResponse = await fetch(splatUrl, { method: 'HEAD' })
    console.log('PLY HEAD status', headResponse.status)
    const length = headResponse.headers.get('content-length')
    console.log('PLY content-length', length)
  } catch (error) {
    console.warn('PLY HEAD failed', error)
  }
}

const start = async () => {
  await logSplatHead()
  return viewer.addSplatScene(splatUrl, {
    showLoadingUI: true,
    progressiveLoad: true,
    splatAlphaRemovalThreshold: 5,
    rotation: [1, 0, 0, 0],
    onProgress: (percent: number) => {
      console.log('Splat load progress', percent)
    },
  })
}

start()
  .then(() => {
    if (viewer.controls) {
      viewer.controls.enableZoom = false
      viewer.controls.enablePan = false
      viewer.controls.enableRotate = true
    }
    viewer.start()
    const camera = viewer.camera
    if (camera) {
      console.log('Camera position', camera.position.toArray())
    }
  })
  .catch((error: unknown) => {
    console.error('Failed to load splat scene', error)
  })
