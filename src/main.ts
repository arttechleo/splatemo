import './style.css'
import * as THREE from 'three'
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d'
import { AnnotationManager, type Annotation } from './annotations/AnnotationManager'
import { ParticleDisintegration } from './transitions/ParticleDisintegration'
import { createOverlay } from './ui/overlay'
import { createOrbitController } from './controls/orbitControls'

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
    <p class="poster__label">Loading splat</p>
    <p class="poster__status">2D preview ready</p>
  </div>
`
app.appendChild(poster)

const annotationsRoot = document.createElement('div')
annotationsRoot.className = 'annotations'
app.appendChild(annotationsRoot)

const overlay = createOverlay()
app.appendChild(overlay)

const hint = document.createElement('div')
hint.className = 'feed-hint'
hint.textContent = 'Swipe to next'
app.appendChild(hint)

const transitionMask = document.createElement('div')
transitionMask.className = 'transition-mask'
app.appendChild(transitionMask)

const isMobile = /Mobi|Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
const manifestUrl = '/splats/manifest.json'
const ENABLE_VIEW_DEPENDENT_LOADING = false
const DEBUG_CONTROLS = true
const DEBUG_FEED = true
const orbitTarget = new THREE.Vector3(0, 0, 0)
let orbitController: ReturnType<typeof createOrbitController> | null = null

const threeScene = new THREE.Scene()

const viewer = new GaussianSplats3D.Viewer({
  rootElement: viewerRoot,
  threeScene,
  cameraUp: [0, 1, 0],
  initialCameraPosition: [0, 0, 6],
  initialCameraLookAt: [0, 0, 0],
  sharedMemoryForWorkers: false,
  gpuAcceleratedSort: false,
  useBuiltInControls: false,
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
  | {
      material?: { depthWrite: boolean }
      getSplatCount: () => number
      getSplatCenter: (index: number, out: THREE.Vector3) => void
    }
  | null = null

const particleSystem = new ParticleDisintegration(threeScene)
const annotationManager = new AnnotationManager(annotationsRoot)

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
  startRevealTransition()
  assertSplatVisibility('onSplatMeshChanged')
})

type SplatEntry = {
  id: string
  name?: string
  file: string
  cameraPoses?: Array<{
    position: [number, number, number]
    target: [number, number, number]
  }>
}

const splatCache = new Map<string, string>()
let splatEntries: SplatEntry[] = []
let currentIndex = 0
let hasScene = false
let isLoading = false
let isTransitioning = false
let currentPoses: SplatEntry['cameraPoses'] = undefined
let isSnapping = false
type FeedState = 'IDLE_VIEWING' | 'TRANSITION_OUT' | 'LOADING_NEXT' | 'TRANSITION_IN'
let feedState: FeedState = 'IDLE_VIEWING'

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
  showPoster('2D preview ready')

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
  currentPoses = entry.cameraPoses
  setAnnotationsForEntry(entry.id)
  assertSplatVisibility('loadSplat')

  const nextIndex = (currentIndex + 1) % splatEntries.length
  if (splatEntries[nextIndex]) {
    void prefetchSplat(splatEntries[nextIndex])
  }
}

const setupOrbitControls = () => {
  if (!viewer.camera || !viewer.renderer) return
  orbitController = createOrbitController({
    camera: viewer.camera,
    domElement: viewer.renderer.domElement,
    target: orbitTarget,
    options: {
      rotateSpeed: 0.005,
      damping: 0,
      allowLeftButton: true,
      debug: DEBUG_CONTROLS,
    },
  })
}

const setupPoseSnapping = () => {
  const camera = viewer.camera
  if (!camera || !orbitController) return

  const snapToPose = (pose: NonNullable<SplatEntry['cameraPoses']>[number]) => {
    if (isSnapping) return
    isSnapping = true
    orbitController?.setEnabled(false)

    console.log('Snap start', {
      targetPose: pose,
      currentPosition: camera.position.toArray(),
    })

    const startPos = camera.position.clone()
    const startTarget = orbitTarget.clone()
    const endPos = new THREE.Vector3(...pose.position)
    const endTarget = new THREE.Vector3(...pose.target)
    const startTime = performance.now()
    const duration = 650

    const animate = (time: number) => {
      const t = Math.min(1, (time - startTime) / duration)
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
      camera.position.lerpVectors(startPos, endPos, eased)
      orbitTarget.lerpVectors(startTarget, endTarget, eased)
      camera.lookAt(orbitTarget)
      console.log('Snap progress', Math.round(eased * 100))
      if (t < 1) {
        requestAnimationFrame(animate)
      } else {
        orbitController?.setTarget(orbitTarget)
        orbitController?.setRadius(camera.position.distanceTo(orbitTarget))
        orbitController?.setEnabled(true)
        isSnapping = false
        console.log('Snap end', {
          newPosition: camera.position.toArray(),
          orbitEnabled: true,
        })
      }
    }

    requestAnimationFrame(animate)
  }

  const handleSnap = () => {
    if (!currentPoses?.length) {
      console.warn('No camera poses available for snap')
      return
    }
    snapToPose(currentPoses[0])
  }

  let lastTapTime = 0
  viewerRoot.addEventListener('pointerup', () => {
    const now = Date.now()
    if (now - lastTapTime < 320) {
      handleSnap()
    }
    lastTapTime = now
  })

  viewerRoot.addEventListener('dblclick', () => {
    handleSnap()
  })
}

const showPoster = (status: string) => {
  const statusEl = poster.querySelector<HTMLParagraphElement>('.poster__status')
  if (statusEl) statusEl.textContent = status
  poster.classList.remove('poster--hidden')
  console.log('2D render loaded')
}

const startRevealTransition = () => {
  const duration = 700
  const start = performance.now()
  const tick = (time: number) => {
    const progress = Math.min(1, (time - start) / duration)
    poster.style.opacity = String(1 - progress)
    console.log('Reveal progress', Math.round(progress * 100))
    if (progress < 1) {
      requestAnimationFrame(tick)
    } else {
      poster.classList.add('poster--hidden')
      poster.style.opacity = ''
    }
  }
  requestAnimationFrame(tick)
}

const setAnnotationsForEntry = (id: string) => {
  const annotationSets: Record<string, Annotation[]> = {
    gs_Isetta_Car: [
      {
        id: 'door',
        label: 'Doorline',
        body: 'Compact cabin design.',
        position: new THREE.Vector3(0.25, 0.4, 0.3),
      },
      {
        id: 'wheel',
        label: 'Wheelbase',
        body: 'Classic microcar stance.',
        position: new THREE.Vector3(-0.4, -0.2, 0.6),
      },
    ],
  }
  annotationManager.setAnnotations(annotationSets[id] ?? [])
}

const navigateSplat = async (direction: 'next' | 'prev', delta: number) => {
  if (isTransitioning || splatEntries.length < 2 || feedState !== 'IDLE_VIEWING') return
  isTransitioning = true
  feedState = 'TRANSITION_OUT'
  console.log('Scroll delta', delta)
  if (DEBUG_FEED) console.log('State', feedState, 'direction', direction)

  const targetIndex =
    direction === 'next'
      ? (currentIndex + 1) % splatEntries.length
      : (currentIndex - 1 + splatEntries.length) % splatEntries.length

  console.log('Navigate splat', currentIndex, '->', targetIndex)
  if (currentSplatMesh) {
    const particleCount = particleSystem.start(currentSplatMesh, direction === 'next' ? 'down' : 'up')
    console.log('Particle disintegration start', particleCount)
  }

  const transitionStart = performance.now()
  const transitionDuration = 700
  const renderModeSetter = viewer as unknown as { setRenderMode?: (mode: number) => void }
  renderModeSetter.setRenderMode?.(GaussianSplats3D.RenderMode.Always)
  transitionMask.style.opacity = '0'
  transitionMask.classList.add('transition-mask--active')
  orbitController?.setEnabled(false)

  const tick = async (time: number) => {
    particleSystem.update(time)
    const progress = Math.min(1, (time - transitionStart) / transitionDuration)
    transitionMask.style.opacity = String(0.8 * progress)
    if (DEBUG_FEED && Math.abs(progress % 0.25) < 0.02) {
      console.log('Transition out progress', Math.round(progress * 100))
    }
    if (time - transitionStart < transitionDuration) {
      requestAnimationFrame(tick)
      return
    }
    console.log('Particle disintegration end')
    feedState = 'LOADING_NEXT'
    if (DEBUG_FEED) console.log('State', feedState)
    await loadSplat(targetIndex)
    feedState = 'TRANSITION_IN'
    if (DEBUG_FEED) console.log('State', feedState)
    const fadeStart = performance.now()
    const fadeDuration = 500
    const fade = (fadeTime: number) => {
      const fadeProgress = Math.min(1, (fadeTime - fadeStart) / fadeDuration)
      transitionMask.style.opacity = String(0.8 * (1 - fadeProgress))
      if (DEBUG_FEED && Math.abs(fadeProgress % 0.25) < 0.02) {
        console.log('Transition in progress', Math.round(fadeProgress * 100))
      }
      if (fadeProgress < 1) {
        requestAnimationFrame(fade)
        return
      }
      transitionMask.classList.remove('transition-mask--active')
      renderModeSetter.setRenderMode?.(GaussianSplats3D.RenderMode.OnChange)
      feedState = 'IDLE_VIEWING'
      if (DEBUG_FEED) console.log('State', feedState)
      isTransitioning = false
      orbitController?.setEnabled(true)
    }
    requestAnimationFrame(fade)
  }
  requestAnimationFrame(tick)
}

const setupSplatNavigation = () => {
  let touchStartY = 0
  let touchStartTime = 0
  viewerRoot.addEventListener(
    'wheel',
    (event) => {
      if (feedState !== 'IDLE_VIEWING') return
      if (Math.abs(event.deltaY) < 30) return
      void navigateSplat(event.deltaY > 0 ? 'next' : 'prev', event.deltaY)
    },
    { passive: true }
  )
  viewerRoot.addEventListener(
    'touchstart',
    (event) => {
      if (feedState !== 'IDLE_VIEWING') return
      if (event.touches.length === 1) {
        touchStartY = event.touches[0].clientY
        touchStartTime = performance.now()
      }
    },
    { passive: true }
  )
  viewerRoot.addEventListener(
    'touchend',
    (event) => {
      if (feedState !== 'IDLE_VIEWING') return
      if (event.changedTouches.length !== 1) return
      const delta = touchStartY - event.changedTouches[0].clientY
      if (Math.abs(delta) < 50) return
      const dt = Math.max(1, performance.now() - touchStartTime)
      const velocity = Math.abs(delta) / dt
      if (DEBUG_FEED) console.log('Swipe velocity', velocity.toFixed(3))
      if (velocity < 0.25) return
      void navigateSplat(delta > 0 ? 'next' : 'prev', delta)
    },
    { passive: true }
  )
}

const start = async () => {
  console.log('Device', isMobile ? 'mobile' : 'desktop')
  console.log('Renderer pixel ratio', viewer.renderer?.getPixelRatio())
  console.log('View-dependent loading enabled', ENABLE_VIEW_DEPENDENT_LOADING)
  if (DEBUG_FEED) console.log('Feed state', feedState)
  splatEntries = await loadManifest()
  await loadSplat(0)
  currentPoses = splatEntries[0]?.cameraPoses
  setupOrbitControls()
  setupPoseSnapping()
  setupSplatNavigation()
  viewer.start()
  const camera = viewer.camera
  if (camera) {
    console.log('Camera position', camera.position.toArray())
    camera.lookAt(orbitTarget)
    console.log('Camera target', orbitTarget.toArray())
  }
  const animate = (time: number) => {
    if (viewer.camera) {
      annotationManager.update(viewer.camera)
    }
    particleSystem.update(time)
    if (orbitController) {
      if (viewer.renderer?.xr?.isPresenting) {
        orbitController.setEnabled(false)
      } else {
        orbitController.setEnabled(true)
        orbitController.update(1 / 60)
      }
    }
    requestAnimationFrame(animate)
  }
  requestAnimationFrame(animate)
}

start().catch((error: unknown) => {
  console.error('Failed to load splat scene', error)
})

const assertSplatVisibility = (stage: string) => {
  const mesh = currentSplatMesh as unknown as {
    parent?: unknown
    visible?: boolean
    material?: { opacity?: number }
  } | null
  if (!mesh) {
    console.error(`[${stage}] Splat mesh missing. Check addSplatScene() and loader.`)
    return
  }
  if (!mesh.parent) {
    console.error(`[${stage}] Splat mesh not attached to scene. Ensure viewer uses rootElement/scene correctly.`)
  }
  if (mesh.visible === false) {
    console.error(`[${stage}] Splat mesh visibility is false.`)
  }
  if (mesh.material && typeof mesh.material.opacity === 'number' && mesh.material.opacity <= 0) {
    console.error(`[${stage}] Splat material opacity is zero.`)
  }
  const camera = viewer.camera
  if (camera) {
    const toTarget = orbitTarget.clone().sub(camera.position)
    if (toTarget.length() < 0.01) {
      console.error(`[${stage}] Camera target equals camera position.`)
    } else {
      const forward = new THREE.Vector3()
      camera.getWorldDirection(forward)
      const dot = forward.normalize().dot(toTarget.normalize())
      if (dot < 0.2) {
        console.error(`[${stage}] Camera may not be looking at target. Adjust camera/controls.`)
      }
    }
  }
  if (viewer.renderer && viewer.renderer.getContext().isContextLost()) {
    console.error(`[${stage}] WebGL context is lost.`)
  }
}
