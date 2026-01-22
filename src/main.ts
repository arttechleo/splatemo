import './style.css'
import * as THREE from 'three'
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d'
import { AnnotationManager, type Annotation } from './annotations/AnnotationManager'
import { createOverlay } from './ui/overlay'
import { createFeedController } from './ux/feed'
import { createParticleOverlay } from './ux/particles'
import { estimateBoundsFromPLY } from './utils/plyBounds'

type CameraPose = { name: string; position: [number, number, number]; target: [number, number, number] }
type ManifestSplat = {
  id: string
  file: string
  user: { handle: string; name: string; avatar: string }
  caption: string
  counts: { likes: number; comments: number; reposts: number }
  cameraPoses: CameraPose[]
  annotations: { id: string; position: [number, number, number]; title: string; body: string }[]
}
type Manifest = { splats: ManifestSplat[] }

const ENABLE_PARTICLE_TRANSITIONS = true
const ENABLE_2D_TO_3D_REVEAL = true
const ENABLE_VIEW_DEPENDENT_LOADING = false
const DISABLE_AUTO_SCROLL = true
const MIN_IDLE_DWELL_MS = 600

const urlParams = new URLSearchParams(window.location.search)
const debugMode = urlParams.get('debug') === '1'
const safeMode = urlParams.get('safe') === '1'

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) {
  throw new Error('App root not found')
}

const splatLayer = document.createElement('div')
splatLayer.id = 'splat-layer'
app.appendChild(splatLayer)

const particleCanvas = document.createElement('canvas')
particleCanvas.id = 'particle-layer'
app.appendChild(particleCanvas)

const uiLayer = document.createElement('div')
uiLayer.id = 'ui-layer'
app.appendChild(uiLayer)

const viewerRoot = document.createElement('div')
viewerRoot.id = 'viewer'
splatLayer.appendChild(viewerRoot)

const poster = document.createElement('div')
poster.className = 'poster'
poster.innerHTML = `
  <div class="poster__content">
    <p class="poster__label">Loading splat</p>
    <p class="poster__status">2D preview ready</p>
  </div>
`
uiLayer.appendChild(poster)

const annotationsRoot = document.createElement('div')
annotationsRoot.className = 'annotations'
uiLayer.appendChild(annotationsRoot)

const poseChips = document.createElement('div')
poseChips.className = 'pose-chips'
uiLayer.appendChild(poseChips)

const hint = document.createElement('div')
hint.className = 'feed-hint'
hint.textContent = 'Swipe to next'
uiLayer.appendChild(hint)

const overlayApi = createOverlay()
uiLayer.appendChild(overlayApi.element)

const isMobile = /Mobi|Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
const manifestUrl = '/splats/manifest.json'

const threeScene = new THREE.Scene()

let viewer: any

const annotationManager = new AnnotationManager(annotationsRoot)
const particleOverlay = createParticleOverlay(particleCanvas)

const sizeWarning = document.createElement('div')
sizeWarning.className = 'size-warning'
sizeWarning.textContent = 'SPLAT LAYER SIZE 0 — CHECK CSS'
sizeWarning.style.display = 'none'
uiLayer.appendChild(sizeWarning)

let manifest: Manifest | null = null
let currentIndex = 0
let isLoading = false
let isDragging = false
let lastNavTime = 0
let activePointerId: number | null = null
let currentSplatCenter = new THREE.Vector3(0, 0, 0)
let currentSplatRadius = 6
let currentSplatDistance = 6
let debugMarker: THREE.Object3D | null = null
let autoframeTimers: number[] = []
let engineReadyPromise: Promise<void> = Promise.resolve()
let resolveEngineReady: (() => void) | null = null

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
  return (await response.json()) as Manifest
}

const setOverlay = (entry: ManifestSplat) => {
  overlayApi.setData({
    user: entry.user,
    caption: entry.caption,
    counts: entry.counts,
  })
}

const setAnnotations = (entry: ManifestSplat) => {
  const annotations: Annotation[] = entry.annotations.map((item) => ({
    id: item.id,
    label: item.title,
    body: item.body,
    position: new THREE.Vector3(...item.position),
  }))
  annotationManager.setAnnotations(annotations)
}

const renderPoseChips = (entry: ManifestSplat) => {
  poseChips.innerHTML = ''
  entry.cameraPoses.forEach((pose) => {
    const button = document.createElement('button')
    button.className = 'pose-chip'
    button.type = 'button'
    button.textContent = pose.name
    button.addEventListener('click', () => animateCameraPose(pose))
    poseChips.appendChild(button)
  })
}

const animateCameraPose = (pose: CameraPose) => {
  const camera = viewer.camera
  const controls = viewer.controls as { enabled: boolean; target: THREE.Vector3 } | undefined
  if (!camera || !controls) return
  controls.enabled = false
  if (navigator.vibrate) navigator.vibrate(10)
  const startPos = camera.position.clone()
  const startTarget = controls.target.clone()
  const center = currentSplatCenter.clone()
  const dist = currentSplatDistance || currentSplatRadius * 2.2 || 6
  const posePosition = new THREE.Vector3(...pose.position)
  const endPos =
    posePosition.lengthSq() > 0
      ? posePosition.normalize().multiplyScalar(dist).add(center)
      : center.clone().add(new THREE.Vector3(0, 0, dist))
  const poseTarget = new THREE.Vector3(...pose.target)
  const endTarget = poseTarget.lengthSq() > 0 ? poseTarget.add(center) : center
  const start = performance.now()
  const duration = 650
  const animate = (time: number) => {
    const t = Math.min(1, (time - start) / duration)
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
    camera.position.lerpVectors(startPos, endPos, eased)
    controls.target.lerpVectors(startTarget, endTarget, eased)
    if (t < 1) {
      requestAnimationFrame(animate)
    } else {
      controls.enabled = true
    }
  }
  requestAnimationFrame(animate)
}

const setupOrbitControls = () => {
  if (!viewer.controls) return
  viewer.controls.enableZoom = false
  viewer.controls.enablePan = false
  viewer.controls.enableRotate = true
  viewer.controls.enableDamping = true
  viewer.controls.dampingFactor = 0.08
}

const setQualityForMotion = (active: boolean) => {
  if (!viewer.renderer) return
  const cap = active ? 1.25 : 1.75
  viewer.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap))
}

const updateSplatLayerSize = () => {
  const rect = splatLayer.getBoundingClientRect()
  if (rect.width < 100 || rect.height < 100) {
    console.warn('Splat layer size too small', rect.width, rect.height)
    sizeWarning.style.display = 'block'
  } else {
    sizeWarning.style.display = 'none'
  }
  const canvasCount = splatLayer.querySelectorAll('canvas').length
  console.log('Splat layer size', Math.round(rect.width), Math.round(rect.height), 'canvases', canvasCount)
  if (viewer?.renderer && viewer?.camera) {
    viewer.renderer.setSize(rect.width, rect.height, false)
    const camera = viewer.camera as THREE.PerspectiveCamera
    camera.aspect = rect.width / rect.height
    camera.updateProjectionMatrix()
  }
  particleOverlay.resize()
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
const nextTwoFrames = async () => {
  await nextFrame()
  await nextFrame()
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const clearAutoframeRetries = () => {
  autoframeTimers.forEach((timer) => window.clearTimeout(timer))
  autoframeTimers = []
}

const updateDebugMarker = (center: THREE.Vector3, radius: number = 1) => {
  if (!debugMode) {
    if (debugMarker) {
      threeScene.remove(debugMarker)
      const marker = debugMarker as THREE.AxesHelper
      marker.geometry.dispose()
      if (Array.isArray(marker.material)) {
        marker.material.forEach((material) => material.dispose())
      } else {
        marker.material.dispose()
      }
      debugMarker = null
    }
    return
  }
  if (!debugMarker) {
    const markerSize = Math.max(0.1, Math.min(radius * 0.15, 2.0))
    debugMarker = new THREE.AxesHelper(markerSize)
    threeScene.add(debugMarker)
  } else {
    const markerSize = Math.max(0.1, Math.min(radius * 0.15, 2.0))
    const marker = debugMarker as THREE.AxesHelper
    marker.scale.setScalar(markerSize / 0.45)
  }
  debugMarker.position.copy(center)
}

const applyCameraPose = (position: THREE.Vector3, target: THREE.Vector3) => {
  const camera = viewer?.camera as THREE.PerspectiveCamera | undefined
  if (!camera) return
  const controls = viewer?.controls as { target: THREE.Vector3; update?: () => void } | undefined
  camera.position.copy(position)
  camera.lookAt(target)
  if (controls) {
    controls.target.copy(target)
    controls.update?.()
  }
  viewer?.requestRender?.()
  viewer?.forceRender?.()
}

const scheduleAutoframeRetries = (center: THREE.Vector3) => {
  clearAutoframeRetries()
  if (!debugMode && !safeMode) return
  const fallbackOffsets: Array<[number, number, number]> = [
    [6, 0, 0],
    [0, 6, 0],
  ]
  fallbackOffsets.forEach((offset, index) => {
    const timer = window.setTimeout(() => {
      const position = new THREE.Vector3(...offset).add(center)
      applyCameraPose(position, center)
      console.log('Autoframe retry', index + 1, 'pos', position.toArray())
    }, 450 * (index + 1))
    autoframeTimers.push(timer)
  })
}

const frameCameraToBounds = (center: THREE.Vector3, radius: number) => {
  const camera = viewer?.camera as THREE.PerspectiveCamera | undefined
  if (!camera) return
  const distance = clamp(radius * 2.2, 3.5, 18)
  const position = center.clone().add(new THREE.Vector3(0, 0, distance))
  applyCameraPose(position, center)
  currentSplatCenter = center.clone()
  currentSplatRadius = radius
  currentSplatDistance = distance
  updateDebugMarker(center, radius)
  scheduleAutoframeRetries(center)
  console.log('Frame camera', {
    center: center.toArray(),
    radius: Math.round(radius * 100) / 100,
    distance: Math.round(distance * 100) / 100,
  })
}

const revealPoster = () =>
  new Promise<void>((resolve) => {
    if (!ENABLE_2D_TO_3D_REVEAL) {
      poster.classList.add('poster--hidden')
      resolve()
      return
    }
    const start = performance.now()
    const duration = 600
    const fade = (time: number) => {
      const t = Math.min(1, (time - start) / duration)
      poster.style.opacity = String(1 - t)
      if (t < 1) {
        requestAnimationFrame(fade)
      } else {
        poster.classList.add('poster--hidden')
        poster.style.opacity = ''
        resolve()
      }
    }
    requestAnimationFrame(fade)
  })

const loadSplat = async (entry: ManifestSplat) => {
  if (isLoading) return
  isLoading = true
  clearAutoframeRetries()
  engineReadyPromise = new Promise<void>((resolve) => {
    resolveEngineReady = resolve
  })
  const statusEl = poster.querySelector<HTMLParagraphElement>('.poster__status')
  if (statusEl) statusEl.textContent = 'Loading 0%'
  poster.classList.remove('poster--hidden')
  const loadStart = performance.now()
  console.log('LOAD start', entry.file)
  await logSplatHead(entry.file)

  await viewer.removeSplatScene(0, false)
  let progress = 0
  let reached100 = false
  let t100 = 0
  let resolveProgress100: (() => void) | null = null
  const progress100Promise: Promise<void> = new Promise<void>((resolve) => {
    resolveProgress100 = () => resolve()
  })
  let lastProgressLogged = -1
  await viewer.addSplatScene(entry.file, {
    showLoadingUI: true,
    progressiveLoad: true,
    splatAlphaRemovalThreshold: 5,
    rotation: [1, 0, 0, 0],
    onProgress: (percent: number) => {
      progress = percent
      const rounded = Math.round(percent)
      if (statusEl) statusEl.textContent = `Loading ${rounded}%`
      if (rounded >= lastProgressLogged + 5 || rounded === 100) {
        lastProgressLogged = rounded
        console.log('LOAD progress', entry.file, `${rounded}%`)
      }
      if (!reached100 && percent >= 100) {
        reached100 = true
        t100 = performance.now()
        resolveProgress100?.()
        console.log('LOAD progress 100%', entry.file)
      }
    },
  })
  const loadMs = Math.round(performance.now() - loadStart)
  console.log('LOAD request issued', entry.file, `${loadMs}ms`)
  // Fallback: if progress already reached 100% before onProgress fired
  if (!reached100 && progress >= 100) {
    reached100 = true
    t100 = performance.now()
    if (resolveProgress100 !== null) {
      (resolveProgress100 as () => void)()
    }
    console.log('LOAD progress 100%', entry.file)
  }
  await progress100Promise
  await nextTwoFrames()
  const settleMs = t100 ? Math.round(performance.now() - t100) : 0
  console.log('SPLAT READY', entry.file, `+${settleMs}ms`)
  const plyBounds = await estimateBoundsFromPLY(entry.file, { debug: debugMode })
  let center = new THREE.Vector3(0, 0, 0)
  let radius = 6
  if (plyBounds) {
    const [cx, cy, cz] = plyBounds.center
    if (Number.isFinite(cx) && Number.isFinite(cy) && Number.isFinite(cz)) {
      center = new THREE.Vector3(cx, cy, cz)
    }
    if (Number.isFinite(plyBounds.radius) && plyBounds.radius > 0) {
      radius = plyBounds.radius
    }
  }
  if (!Number.isFinite(radius) || radius < 1.5) {
    console.warn('PLY bounds invalid, using fallback radius', {
      radius,
      center: center.toArray(),
    })
    radius = 6
  }
  if (!Number.isFinite(center.x) || !Number.isFinite(center.y) || !Number.isFinite(center.z)) {
    console.warn('PLY bounds invalid, using fallback center', center.toArray())
    center = new THREE.Vector3(0, 0, 0)
  }
  frameCameraToBounds(center, radius)
  resolveEngineReady?.()
  resolveEngineReady = null

  setOverlay(entry)
  setAnnotations(entry)
  renderPoseChips(entry)
  await revealPoster()
  isLoading = false
}

const setupPointerDebug = () => {
  const controls = viewer.controls as { enabled: boolean } | undefined
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
    if (!isDragging || activePointerId !== event.pointerId) return
    if (event.buttons === 0) {
      stopDragging('buttons=0')
    }
  })

  viewerRoot.addEventListener('pointerup', (event) => {
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
    if (activePointerId === event.pointerId) {
      stopDragging('pointercancel')
    }
  })

  viewerRoot.addEventListener('mouseleave', () => stopDragging('mouseleave'))
  window.addEventListener('blur', () => stopDragging('blur'))
  window.addEventListener('mouseup', () => stopDragging('mouseup'))
  viewerRoot.addEventListener('contextmenu', (event) => {
    if (isDragging) {
      event.preventDefault()
      stopDragging('contextmenu')
    }
  })
}

const setupNavigation = (feed: ReturnType<typeof createFeedController>) => {
  let touchStartX = 0
  let touchStartY = 0
  let gesture: 'none' | 'nav' | 'orbit' = 'none'
  let touchStartTime = 0

  const tryNavigate = (direction: 'next' | 'prev') => {
    const now = performance.now()
    if (feed.getState() !== 'IDLE') {
      if (direction === 'next') feed.goNext()
      else feed.goPrev()
      return
    }
    if (now - lastNavTime < 350) return
    lastNavTime = now
    if (direction === 'next') feed.goNext()
    else feed.goPrev()
  }

  viewerRoot.addEventListener(
    'wheel',
    (event) => {
      if (isDragging) return
      if (Math.abs(event.deltaY) < 30) return
      tryNavigate(event.deltaY > 0 ? 'next' : 'prev')
    },
    { passive: true }
  )

  viewerRoot.addEventListener(
    'touchstart',
    (event) => {
      if (event.touches.length !== 1) return
      touchStartX = event.touches[0].clientX
      touchStartY = event.touches[0].clientY
      touchStartTime = performance.now()
      gesture = 'none'
    },
    { passive: true }
  )

  viewerRoot.addEventListener(
    'touchmove',
    (event) => {
      if (event.touches.length !== 1) return
      const dx = event.touches[0].clientX - touchStartX
      const dy = event.touches[0].clientY - touchStartY
      if (gesture === 'none') {
        if (Math.abs(dy) > Math.abs(dx) * 1.2) {
          gesture = 'nav'
          if (viewer.controls) viewer.controls.enabled = false
        } else if (Math.abs(dx) > 10) {
          gesture = 'orbit'
        }
      }
    },
    { passive: true }
  )

  viewerRoot.addEventListener(
    'touchend',
    (event) => {
      if (event.changedTouches.length !== 1) return
      const dy = event.changedTouches[0].clientY - touchStartY
      if (viewer.controls) viewer.controls.enabled = true
      if (gesture !== 'nav') return
      const dt = Math.max(1, performance.now() - touchStartTime)
      const velocity = Math.abs(dy) / dt
      if (Math.abs(dy) < 50 || velocity < 0.25) return
      tryNavigate(dy > 0 ? 'prev' : 'next')
    },
    { passive: true }
  )
}

const start = async () => {
  splatLayer.innerHTML = ''
  splatLayer.appendChild(viewerRoot)
  await new Promise(requestAnimationFrame)
  await new Promise(requestAnimationFrame)

  viewer = new GaussianSplats3D.Viewer({
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
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.75)
    viewer.renderer.setPixelRatio(pixelRatio)
    viewer.renderer.domElement.addEventListener('webglcontextlost', (event: Event) => {
      event.preventDefault()
      console.error('WebGL context lost')
    })
    const canvas = viewer.renderer.domElement
    const styles = window.getComputedStyle(canvas)
    console.log('Splat canvas', canvas)
    console.log('Splat canvas styles', {
      display: styles.display,
      visibility: styles.visibility,
      opacity: styles.opacity,
      zIndex: styles.zIndex,
    })
  }

  const resizeObserver = new ResizeObserver(() => updateSplatLayerSize())
  resizeObserver.observe(splatLayer)
  window.addEventListener('resize', updateSplatLayerSize)
  updateSplatLayerSize()

  setupOrbitControls()
  setupPointerDebug()
  manifest = await loadManifest()
  const entries = manifest.splats
  if (!entries.length) {
    throw new Error('No splat entries available.')
  }

  const feed = createFeedController({
    entries,
    onTransitionOut: async (direction) => {
      if (!ENABLE_PARTICLE_TRANSITIONS) return
      setQualityForMotion(true)
      await particleOverlay.start(direction === 'next' ? 'up' : 'down')
    },
    onLoad: async (entry) => {
      const index = entries.findIndex((item) => item.id === entry.id)
      if (index >= 0) currentIndex = index
      await loadSplat(entries[currentIndex])
    },
    onTransitionIn: async () => {
      setQualityForMotion(false)
    },
    debug: debugMode,
    minIdleMs: MIN_IDLE_DWELL_MS,
    waitForReady: () => engineReadyPromise,
  })

  await loadSplat(entries[0])
  setupNavigation(feed)
  if (DISABLE_AUTO_SCROLL) {
    console.log('Auto scroll disabled')
  }

  const tick = (time: number) => {
    annotationManager.update(viewer.camera as THREE.PerspectiveCamera)
    particleOverlay.update(time)
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  console.log('View-dependent loading enabled', ENABLE_VIEW_DEPENDENT_LOADING)
}

start().catch((error: unknown) => {
  console.error('Failed to start app', error)
})

window.addEventListener('keydown', (event) => {
  if (event.key.toLowerCase() === 'o') {
    const next = particleCanvas.style.display === 'none' ? '' : 'none'
    particleCanvas.style.display = next
    console.log('Particle overlay', next === '' ? 'shown' : 'hidden')
  }
  if (event.key.toLowerCase() === 'u') {
    const next = uiLayer.style.display === 'none' ? '' : 'none'
    uiLayer.style.display = next
    console.log('UI layer', next === '' ? 'shown' : 'hidden')
  }
})
