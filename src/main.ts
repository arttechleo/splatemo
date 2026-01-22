import './style.css'
import * as THREE from 'three'
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d'
import { AnnotationManager, type Annotation } from './annotations/AnnotationManager'
import { ParticleDisintegration } from './transitions/ParticleDisintegration'
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

const isMobile = /Mobi|Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
const manifestUrl = '/splats/manifest.json'
const ENABLE_VIEW_DEPENDENT_LOADING = false

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
  controls.enableDamping = true
  controls.dampingFactor = 0.08
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

const setupPoseSnapping = () => {
  const camera = viewer.camera
  const controls = viewer.controls as
    | (THREE.EventDispatcher & { enabled: boolean; target: THREE.Vector3 })
    | undefined
  if (!camera || !controls) return

  const snapToPose = (pose: NonNullable<SplatEntry['cameraPoses']>[number]) => {
    if (isSnapping) return
    isSnapping = true
    controls.enabled = false

    console.log('Snap start', {
      targetPose: pose,
      currentPosition: camera.position.toArray(),
    })

    const startPos = camera.position.clone()
    const startTarget = controls.target.clone()
    const endPos = new THREE.Vector3(...pose.position)
    const endTarget = new THREE.Vector3(...pose.target)
    const startTime = performance.now()
    const duration = 650

    const animate = (time: number) => {
      const t = Math.min(1, (time - startTime) / duration)
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
      camera.position.lerpVectors(startPos, endPos, eased)
      controls.target.lerpVectors(startTarget, endTarget, eased)
      console.log('Snap progress', Math.round(eased * 100))
      if (t < 1) {
        requestAnimationFrame(animate)
      } else {
        controls.enabled = true
        isSnapping = false
        console.log('Snap end', {
          newPosition: camera.position.toArray(),
          orbitEnabled: controls.enabled,
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

const setupPointerDebug = () => {
  const logPointer = (event: PointerEvent, phase: string) => {
    console.log(`Pointer ${phase}`, event.pointerId, event.pointerType)
  }

  const controls = viewer.controls as { enabled: boolean } | undefined
  let activePointerId: number | null = null
  let isDragging = false

  const stopDragging = (reason: string) => {
    if (!isDragging) return
    isDragging = false
    activePointerId = null
    console.log('Drag end', reason)
    if (controls) {
      controls.enabled = false
      requestAnimationFrame(() => {
        controls.enabled = true
      })
    }
  }

  viewerRoot.addEventListener('pointerdown', (event) => {
    logPointer(event, 'down')
    if (event.pointerType === 'mouse' && event.button !== 2) return
    isDragging = true
    activePointerId = event.pointerId
    try {
      viewerRoot.setPointerCapture(event.pointerId)
    } catch (error) {
      console.warn('setPointerCapture failed', event.pointerId, error)
    }
  })

  viewerRoot.addEventListener('pointermove', (event) => {
    logPointer(event, 'move')
    if (!isDragging || activePointerId !== event.pointerId) return
    if (event.buttons === 0) {
      stopDragging('buttons=0')
    }
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
    if (activePointerId === event.pointerId) {
      stopDragging('pointerup')
    }
  })

  viewerRoot.addEventListener('pointercancel', (event) => {
    logPointer(event, 'cancel')
    if (activePointerId === event.pointerId) {
      stopDragging('pointercancel')
    }
  })

  viewerRoot.addEventListener('mouseleave', () => {
    stopDragging('mouseleave')
  })

  window.addEventListener('blur', () => {
    stopDragging('blur')
  })

  window.addEventListener('mouseup', () => {
    stopDragging('mouseup')
  })

  viewerRoot.addEventListener('contextmenu', (event) => {
    if (isDragging) {
      event.preventDefault()
      stopDragging('contextmenu')
    }
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
  if (isTransitioning || splatEntries.length < 2) return
  isTransitioning = true
  console.log('Scroll delta', delta)

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
  const transitionDuration = 750
  const renderModeSetter = viewer as unknown as { setRenderMode?: (mode: number) => void }
  renderModeSetter.setRenderMode?.(GaussianSplats3D.RenderMode.Always)

  const tick = async (time: number) => {
    particleSystem.update(time)
    if (time - transitionStart < transitionDuration) {
      requestAnimationFrame(tick)
      return
    }
    console.log('Particle disintegration end')
    await loadSplat(targetIndex)
    renderModeSetter.setRenderMode?.(GaussianSplats3D.RenderMode.OnChange)
    isTransitioning = false
  }
  requestAnimationFrame(tick)
}

const setupSplatNavigation = () => {
  let touchStartY = 0
  viewerRoot.addEventListener(
    'wheel',
    (event) => {
      if (Math.abs(event.deltaY) < 30) return
      void navigateSplat(event.deltaY > 0 ? 'next' : 'prev', event.deltaY)
    },
    { passive: true }
  )
  viewerRoot.addEventListener(
    'touchstart',
    (event) => {
      if (event.touches.length === 1) {
        touchStartY = event.touches[0].clientY
      }
    },
    { passive: true }
  )
  viewerRoot.addEventListener(
    'touchend',
    (event) => {
      if (event.changedTouches.length !== 1) return
      const delta = touchStartY - event.changedTouches[0].clientY
      if (Math.abs(delta) < 50) return
      void navigateSplat(delta > 0 ? 'next' : 'prev', delta)
    },
    { passive: true }
  )
}

const start = async () => {
  console.log('Device', isMobile ? 'mobile' : 'desktop')
  console.log('Renderer pixel ratio', viewer.renderer?.getPixelRatio())
  console.log('View-dependent loading enabled', ENABLE_VIEW_DEPENDENT_LOADING)
  splatEntries = await loadManifest()
  await loadSplat(0)
  currentPoses = splatEntries[0]?.cameraPoses
  setupPointerDebug()
  setupOrbitControls()
  setupPoseSnapping()
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
  const animate = (time: number) => {
    if (viewer.camera) {
      annotationManager.update(viewer.camera)
    }
    particleSystem.update(time)
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
  const target = (viewer.controls as unknown as { target?: THREE.Vector3 })?.target
  if (camera && target) {
    const toTarget = target.clone().sub(camera.position)
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
