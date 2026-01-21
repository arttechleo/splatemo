import './style.css'
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d'

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) {
  throw new Error('App root not found')
}

const viewerRoot = document.createElement('div')
viewerRoot.id = 'viewer'
app.appendChild(viewerRoot)

const viewer = new GaussianSplats3D.Viewer({
  rootElement: viewerRoot,
  cameraUp: [0, 1, 0],
  initialCameraPosition: [0, 0, 6],
  initialCameraLookAt: [0, 0, 0],
  sharedMemoryForWorkers: false,
  gpuAcceleratedSort: false,
  useBuiltInControls: true,
  webXRMode: GaussianSplats3D.WebXRMode.None,
  logLevel: GaussianSplats3D.LogLevel.None,
})

if (viewer.renderer) {
  viewer.renderer.setClearColor(0x000000, 1)
}

viewer
  .addSplatScene('/splats/gs_Isetta_Car.ply', {
    showLoadingUI: true,
    progressiveLoad: true,
    splatAlphaRemovalThreshold: 5,
  })
  .then(() => {
    if (viewer.controls) {
      viewer.controls.enableZoom = false
      viewer.controls.enablePan = false
      viewer.controls.enableRotate = true
    }
    viewer.start()
  })
  .catch((error: unknown) => {
    console.error('Failed to load splat scene', error)
  })
