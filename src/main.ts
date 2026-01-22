import './style.css'
import * as THREE from 'three'
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d'
import { AnnotationManager, type Annotation } from './annotations/AnnotationManager'
import { createOverlay } from './ui/overlay'
import { createFeedController } from './ux/feed'
import { createParticleOverlay } from './ux/particles'

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

const annotationManager = new AnnotationManager(annotationsRoot)
const particleOverlay = createParticleOverlay(particleCanvas)

let manifest: Manifest | null = null
let currentIndex = 0
let isLoading = false
let isDragging = false
let lastNavTime = 0
let activePointerId: number | null = null

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
  const endPos = new THREE.Vector3(...pose.position)
  const endTarget = new THREE.Vector3(...pose.target)
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

const loadSplat = async (entry: ManifestSplat) => {
  if (isLoading) return
  isLoading = true
  const statusEl = poster.querySelector<HTMLParagraphElement>('.poster__status')
  if (statusEl) statusEl.textContent = 'Loading 0%'
  poster.classList.remove('poster--hidden')
  await logSplatHead(entry.file)

  await viewer.removeSplatScene(0, false)
  await viewer.addSplatScene(entry.file, {
    showLoadingUI: true,
    progressiveLoad: true,
    splatAlphaRemovalThreshold: 5,
    rotation: [1, 0, 0, 0],
    onProgress: (percent: number) => {
      if (statusEl) statusEl.textContent = `Loading ${Math.round(percent)}%`
    },
  })

  setOverlay(entry)
  setAnnotations(entry)
  renderPoseChips(entry)
  if (ENABLE_2D_TO_3D_REVEAL) {
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
      }
    }
    requestAnimationFrame(fade)
  } else {
    poster.classList.add('poster--hidden')
  }
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
    debug: true,
  })

  await loadSplat(entries[0])
  setupNavigation(feed)

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
