import './style.css'
import * as THREE from 'three'
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d'
import { AnnotationManager, type Annotation } from './annotations/AnnotationManager'
import { ParticleDisintegration } from './transitions/ParticleDisintegration'
import { SplatTransitionOverlay } from './transitions/SplatTransitionOverlay'
import { AudioWavelength } from './effects/AudioWavelength'
import { AudioPulseDriver } from './effects/AudioPulseDriver'
import { createOverlay } from './ui/overlay'
import { createHUD } from './ui/hud'

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) {
  throw new Error('App root not found')
}

const viewerRoot = document.createElement('div')
viewerRoot.id = 'viewer'
app.appendChild(viewerRoot)

const hudResult = createHUD()
const hud = hudResult.element
app.appendChild(hud)
const showErrorToast = hudResult.showErrorToast
const showLoading = hudResult.showLoading
const hideLoading = hudResult.hideLoading
hudResult.setSoundToggleHandler(async (enabled: boolean) => {
  if (enabled) {
    const success = await audioWavelength.enable()
    if (!success) {
      showErrorToast('Microphone access required for audio-reactive effect')
      // Reset button state
      const soundButton = hud.querySelector<HTMLButtonElement>('.hud__button--sound')
      if (soundButton) {
        soundButton.classList.remove('hud__button--active')
      }
    }
  } else {
    audioWavelength.disable()
  }
})

hudResult.setSoundModeToggleHandler(async (enabled: boolean) => {
  if (enabled) {
    const success = await audioPulseDriver.enable()
    if (!success) {
      showErrorToast('Microphone access required for audio pulse effect')
      // Reset button state
      const soundModeButton = hud.querySelector<HTMLButtonElement>('.hud__button--sound-mode')
      if (soundModeButton) {
        soundModeButton.classList.remove('hud__button--active')
      }
    }
  } else {
    audioPulseDriver.disable()
  }
})

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

// Loading indicator
const loadingIndicator = document.createElement('div')
loadingIndicator.className = 'loading-indicator'
loadingIndicator.innerHTML = '<div class="loading-indicator__bar"></div>'
app.appendChild(loadingIndicator)
const loadingBar = loadingIndicator.querySelector<HTMLDivElement>('.loading-indicator__bar')!

const showLoadingIndicator = (progress: number = 0) => {
  loadingIndicator.classList.add('loading-indicator--active')
  loadingBar.style.width = `${Math.min(100, Math.max(0, progress))}%`
}

const hideLoadingIndicator = () => {
  loadingIndicator.classList.remove('loading-indicator--active')
  setTimeout(() => {
    loadingBar.style.width = '0%'
  }, 200)
}

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
  
  // Set source canvas for audio pulse driver (will be set after audioPulseDriver is created)
  setTimeout(() => {
    audioPulseDriver.setSourceCanvas(viewer.renderer?.domElement ?? null)
  }, 0)
}

let currentSplatMesh:
  | {
      material?: { depthWrite: boolean }
      getSplatCount: () => number
      getSplatCenter: (index: number, out: THREE.Vector3) => void
    }
  | null = null

const particleSystem = new ParticleDisintegration(threeScene)
const splatTransitionOverlay = new SplatTransitionOverlay(app)
const audioWavelength = new AudioWavelength(app)
const annotationManager = new AnnotationManager(annotationsRoot)
const audioPulseDriver = new AudioPulseDriver(splatTransitionOverlay, null)

viewer.onSplatMeshChanged((splatMesh: typeof currentSplatMesh) => {
  currentSplatMesh = splatMesh
  
  // Handle scene removal (splatMesh is null/undefined)
  if (!splatMesh) {
    console.log('[MESH] scene removed')
    return
  }

  console.log('[MESH] splat mesh ready')
  if (splatMesh.material) {
    splatMesh.material.depthWrite = false
  }
  
  const viewerAny = viewer as unknown as { splatMesh?: { getSplatCount: () => number } }
  if (viewerAny.splatMesh) {
    console.log('[MESH] splat count', viewerAny.splatMesh.getSplatCount())
  }
  
  const meshParent = (splatMesh as unknown as { parent?: unknown }).parent
  console.log('[MESH] parent attached:', !!meshParent)
  
  const rendererInfo = viewer.renderer?.info
  console.log('[MESH] renderer programs', rendererInfo?.programs?.length)
  
  // Hide loading indicator when mesh is visible
  hideLoading()
  
  // Capture default camera state on first splat load
  if (defaultCameraPosition === null) {
    const camera = viewer.camera
    const controls = viewer.controls as unknown as { target?: THREE.Vector3 } | null
    if (camera) {
      defaultCameraPosition = camera.position.clone()
      defaultCameraDistance = controls?.target
        ? camera.position.distanceTo(controls.target)
        : 6
      defaultCameraTarget = controls?.target ? controls.target.clone() : new THREE.Vector3(0, 0, 0)
      if (defaultCameraPosition) {
        console.log('[INIT] Default camera state captured', {
          position: defaultCameraPosition.toArray(),
          target: defaultCameraTarget.toArray(),
          distance: defaultCameraDistance,
        })
      }
    }
  }
  
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

// Load state management
type LoadState = 'IDLE' | 'LOADING'
let loadState: LoadState = 'IDLE'
let activeLoadId = 0
let currentUrl: string | null = null
let currentSceneHandle: number | null = null
let pendingNavigation: 'next' | 'prev' | null = null

const splatCache = new Map<string, string>()
let splatEntries: SplatEntry[] = []
let currentIndex = 0
let isTransitioning = false
let currentPoses: SplatEntry['cameraPoses'] = undefined
let isSnapping = false

const logSplatHead = async (url: string): Promise<{ status: number; contentLength: string | null } | null> => {
  try {
    const headResponse = await fetch(url, { method: 'HEAD' })
    const length = headResponse.headers.get('content-length')
    console.log('[PLY HEAD]', url, 'status:', headResponse.status, 'content-length:', length)
    return { status: headResponse.status, contentLength: length }
  } catch (error) {
    console.warn('[PLY HEAD] failed', url, error)
    return null
  }
}

const loadManifest = async () => {
  const response = await fetch(manifestUrl, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`Manifest fetch failed: ${response.status}`)
  }
  const data = (await response.json()) as SplatEntry[]
  console.log('[MANIFEST] entries:', data.length)
  return data
}

const prefetchSplat = async (entry: SplatEntry) => {
  // Just prefetch to browser cache - don't create blob URLs
  // The viewer library doesn't support blob URLs, so we rely on HTTP cache
  if (splatCache.has(entry.id)) return
  const url = `/splats/${entry.file}`
  try {
    // Prefetch to browser HTTP cache only
    const response = await fetch(url, { method: 'HEAD' })
    if (response.ok) {
      console.log('[PREFETCH] cached', url)
      splatCache.set(entry.id, 'cached') // Mark as cached, but use original URL
    } else {
      console.warn('[PREFETCH] failed', url, response.status)
    }
  } catch (error) {
    console.warn('[PREFETCH] error', url, error)
  }
}

const waitForRAF = (): Promise<void> => {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve()
      })
    })
  })
}

const swapToSplat = async (entry: SplatEntry, loadId: number): Promise<void> => {
  const url = `/splats/${entry.file}`
  const oldUrl = currentUrl

  console.log('[SWAP] start from', oldUrl || 'none', 'to', url)

  // Step 1: Validate URL exists
  const headInfo = await logSplatHead(url)
  if (!headInfo || headInfo.status !== 200) {
    throw new Error(`PLY file not found or invalid: ${url} (status: ${headInfo?.status || 'unknown'})`)
  }

  // Step 2: Unload previous scene
  if (currentSceneHandle !== null || currentUrl !== null) {
    const handleToRemove = currentSceneHandle !== null ? currentSceneHandle : 0
    console.log('[UNLOAD] removing scene handle', handleToRemove)
    try {
      await viewer.removeSplatScene(handleToRemove, false)
      currentSceneHandle = null
      currentUrl = null
      console.log('[UNLOAD] ok')
    } catch (error) {
      console.warn('[UNLOAD] error', error)
      // Continue anyway - might already be removed
      currentSceneHandle = null
      currentUrl = null
    }

    // Wait for GPU state to settle
    await waitForRAF()
  }

  // Check if this load is still current
  if (loadId !== activeLoadId) {
    console.log('[SWAP] cancelled - stale loadId', loadId, 'vs', activeLoadId)
    return
  }

  // Step 3: Load new scene with timeout
  // Always use original URL - browser cache handles prefetching
  // The viewer library doesn't support blob URLs
  const sourceUrl = url
  console.log('[LOAD] starting', sourceUrl)

  const loadPromise = viewer.addSplatScene(sourceUrl, {
    showLoadingUI: true,
    progressiveLoad: true,
    splatAlphaRemovalThreshold: 5,
    rotation: [1, 0, 0, 0],
    onProgress: (percent: number) => {
      if (loadId === activeLoadId) {
        console.log('[LOAD] progress', entry.id, percent + '%')
        showLoadingIndicator(percent)
      }
    },
  })

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Load timeout after 25s: ${url}`))
    }, 25000)
  })

  try {
    const sceneHandleResult = await Promise.race([loadPromise, timeoutPromise])
    console.log('[LOAD] ok, scene handle result:', sceneHandleResult)

    // Check again if this load is still current
    if (loadId !== activeLoadId) {
      console.log('[LOAD] cancelled - stale loadId after completion', loadId, 'vs', activeLoadId)
      // Try to remove the scene we just loaded if we got a handle
      if (typeof sceneHandleResult === 'number') {
        try {
          await viewer.removeSplatScene(sceneHandleResult, false)
        } catch (error) {
          console.warn('[LOAD] cleanup error', error)
        }
      }
      return
    }

    // Handle both cases: if it returns a number (handle) or void
    currentSceneHandle = typeof sceneHandleResult === 'number' ? sceneHandleResult : 0
    currentUrl = url

    // Wait for visibility (2 RAF frames)
    await waitForRAF()
    await waitForRAF()

    console.log('[VISIBLE] ok')
    hideLoadingIndicator()
  } catch (error) {
    console.error('[LOAD] failed', error)
    hideLoadingIndicator()
    if (isMobile) {
      splatTransitionOverlay.endTransition()
    }
    throw error
  }
}

const loadSplat = async (index: number, retryCount = 0): Promise<void> => {
  if (loadState === 'LOADING') {
    console.log('[LOAD] already in progress, ignoring request for index', index)
    return
  }

  const entry = splatEntries[index]
  if (!entry) {
    console.error('[LOAD] invalid index', index)
    return
  }

  loadState = 'LOADING'
  const loadId = ++activeLoadId

  console.log('[LOAD] starting index', index, 'entry:', entry.id, 'loadId:', loadId)

  showPoster('Loading splat...')
  showLoading()

  try {
    await swapToSplat(entry, loadId)

    // Check again if this load is still current
    if (loadId !== activeLoadId) {
      console.log('[LOAD] cancelled - stale loadId before state update', loadId, 'vs', activeLoadId)
      loadState = 'IDLE'
      return
    }

    currentIndex = index
    currentPoses = entry.cameraPoses
    setAnnotationsForEntry(entry.id)
    // Note: assertSplatVisibility is called from onSplatMeshChanged callback
    // when the mesh is actually ready, not here

    loadState = 'IDLE'
    hideLoading()
    console.log('[LOAD] complete index', index, 'entry:', entry.id)

    // Prefetch next
    const nextIndex = (currentIndex + 1) % splatEntries.length
    if (splatEntries[nextIndex]) {
      void prefetchSplat(splatEntries[nextIndex])
    }

    // Process pending navigation
    if (pendingNavigation) {
      const direction = pendingNavigation
      pendingNavigation = null
      const targetIndex =
        direction === 'next'
          ? (currentIndex + 1) % splatEntries.length
          : (currentIndex - 1 + splatEntries.length) % splatEntries.length
      void loadSplat(targetIndex)
    }
  } catch (error) {
    console.error('[LOAD] error', error)
    loadState = 'IDLE'
    hideLoading()

    if (isMobile) {
      splatTransitionOverlay.endTransition()
    }

    // Retry once automatically
    if (retryCount === 0) {
      console.log('[LOAD] retrying once...')
      setTimeout(() => {
        void loadSplat(index, 1)
      }, 1000)
    } else {
      // Show error toast
      showErrorToast('Failed to load splat — tap to retry', () => {
        void loadSplat(index, 0)
      })
    }
  }
}

// Default camera state (captured after first splat loads)
let defaultCameraPosition: THREE.Vector3 | null = null
let defaultCameraTarget: THREE.Vector3 | null = null
let defaultCameraDistance = 6

const resetView = () => {
  const camera = viewer.camera
  const controls = viewer.controls as unknown as {
    target?: THREE.Vector3
    update?: () => void
    enabled?: boolean
  } | null

  if (!camera || !controls) return

  // Use stored defaults or fallback to initial values
  const target = defaultCameraTarget || new THREE.Vector3(0, 0, 0)
  const distance = defaultCameraDistance || 6
  const position = defaultCameraPosition || new THREE.Vector3(0, 0, distance)

  // Reset camera position
  camera.position.copy(position)
  if (controls.target) {
    controls.target.copy(target)
  }
  camera.lookAt(target)

  // Update controls
  if (controls.update) {
    controls.update()
  }

  console.log('[RESET] View restored to default')
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
    minDistance?: number
    maxDistance?: number
  }
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  viewer.controls.enableZoom = false
  viewer.controls.enablePan = false
  viewer.controls.enableRotate = true
  
  // Set wider zoom bounds for OrbitControls if available
  if (typeof controls.minDistance === 'number') {
    controls.minDistance = 0.8
  }
  if (typeof controls.maxDistance === 'number') {
    controls.maxDistance = 20
  }
  // Removed excessive orbit change logging - was firing every frame during damping
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

const setupOrbitStabilization = () => {
  const controls = viewer.controls as
    | (THREE.EventDispatcher & { enabled: boolean })
    | undefined
  if (!controls) return

  let activePointerId: number | null = null

  const stopDrag = (pointerId: number | null) => {
    if (pointerId === null) return
    if (activePointerId !== pointerId) return

    try {
      if (viewerRoot.hasPointerCapture(pointerId)) {
        viewerRoot.releasePointerCapture(pointerId)
      }
    } catch (error) {
      // Ignore errors - pointer may already be released
    }

    activePointerId = null
  }

  const handlePointerDown = (event: PointerEvent) => {
    // Don't start drag if clicking on HUD interactive elements
    const target = event.target as HTMLElement
    if (target.closest('#hud button, #hud input, #hud form')) {
      return
    }

    // Only handle primary button (left mouse button)
    if (event.button !== 0 && event.button !== undefined) {
      return
    }

    if (activePointerId !== null) {
      stopDrag(activePointerId)
    }

    activePointerId = event.pointerId

    try {
      viewerRoot.setPointerCapture(event.pointerId)
    } catch (error) {
      console.warn('setPointerCapture failed', event.pointerId, error)
      activePointerId = null
    }
  }

  const handlePointerMove = (event: PointerEvent) => {
    if (activePointerId !== event.pointerId) return

    // Stop drag if buttons are released during move
    if (event.buttons === 0) {
      stopDrag(event.pointerId)
      return
    }
  }

  const handlePointerUp = (event: PointerEvent) => {
    if (activePointerId === event.pointerId) {
      stopDrag(event.pointerId)
    }
  }

  const handlePointerCancel = (event: PointerEvent) => {
    if (activePointerId === event.pointerId) {
      stopDrag(event.pointerId)
    }
  }

  const handleMouseUp = (_event: MouseEvent) => {
    if (activePointerId !== null) {
      stopDrag(activePointerId)
    }
  }

  const handleContextMenu = (event: MouseEvent) => {
    if (activePointerId !== null) {
      stopDrag(activePointerId)
    }
    // Prevent context menu from interfering
    event.preventDefault()
  }

  const handleMouseLeave = () => {
    if (activePointerId !== null) {
      stopDrag(activePointerId)
    }
  }

  const handleBlur = () => {
    if (activePointerId !== null) {
      stopDrag(activePointerId)
    }
  }

  const handleVisibilityChange = () => {
    if (document.hidden && activePointerId !== null) {
      stopDrag(activePointerId)
    }
  }

  // Add event listeners
  viewerRoot.addEventListener('pointerdown', handlePointerDown)
  viewerRoot.addEventListener('pointermove', handlePointerMove)
  viewerRoot.addEventListener('pointerup', handlePointerUp)
  viewerRoot.addEventListener('pointercancel', handlePointerCancel)
  window.addEventListener('mouseup', handleMouseUp)
  window.addEventListener('contextmenu', handleContextMenu)
  viewerRoot.addEventListener('mouseleave', handleMouseLeave)
  window.addEventListener('blur', handleBlur)
  document.addEventListener('visibilitychange', handleVisibilityChange)

  // Cleanup function (not called here, but available if needed)
  return () => {
    viewerRoot.removeEventListener('pointerdown', handlePointerDown)
    viewerRoot.removeEventListener('pointermove', handlePointerMove)
    viewerRoot.removeEventListener('pointerup', handlePointerUp)
    viewerRoot.removeEventListener('pointercancel', handlePointerCancel)
    window.removeEventListener('mouseup', handleMouseUp)
    window.removeEventListener('contextmenu', handleContextMenu)
    viewerRoot.removeEventListener('mouseleave', handleMouseLeave)
    window.removeEventListener('blur', handleBlur)
    document.removeEventListener('visibilitychange', handleVisibilityChange)
  }
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

const navigateSplat = async (direction: 'next' | 'prev', _delta: number) => {
  // Disable navigation if only one splat
  if (splatEntries.length < 2) return
  if (isTransitioning) return

  // If currently loading, queue the navigation
  if (loadState === 'LOADING') {
    console.log('[NAV] queuing navigation', direction, '(currently loading)')
    pendingNavigation = direction
    return
  }

  isTransitioning = true
  console.log('[NAV] start', direction)

  const targetIndex =
    direction === 'next'
      ? (currentIndex + 1) % splatEntries.length
      : (currentIndex - 1 + splatEntries.length) % splatEntries.length

  console.log('[NAV] index', currentIndex, '->', targetIndex)

  const sourceCanvas = viewer.renderer?.domElement ?? null

  // Pause audio effects during transition
  audioWavelength.pause()
  audioPulseDriver.pause()

  if (isMobile) {
    splatTransitionOverlay.startTransition(
      direction === 'next' ? 'up' : 'down',
      sourceCanvas
    )
  } else if (currentSplatMesh) {
    particleSystem.start(currentSplatMesh, direction === 'next' ? 'down' : 'up')
  }

  const transitionStart = performance.now()
  const transitionDuration = isMobile ? 0 : 750
  const renderModeSetter = viewer as unknown as { setRenderMode?: (mode: number) => void }
  renderModeSetter.setRenderMode?.(GaussianSplats3D.RenderMode.Always)

  const tick = async (time: number) => {
    if (!isMobile) particleSystem.update(time)
    if (time - transitionStart < transitionDuration) {
      requestAnimationFrame(tick)
      return
    }
    await loadSplat(targetIndex)
    renderModeSetter.setRenderMode?.(GaussianSplats3D.RenderMode.OnChange)
    isTransitioning = false
    if (isMobile) {
      splatTransitionOverlay.endTransition()
    }
    // Resume audio effects after transition
    audioWavelength.resume()
    audioPulseDriver.resume()
  }
  requestAnimationFrame(tick)
}

const setupSplatNavigation = () => {
  // Desktop wheel navigation
  viewerRoot.addEventListener(
    'wheel',
    (event) => {
      if (Math.abs(event.deltaY) < 30) return
      void navigateSplat(event.deltaY > 0 ? 'next' : 'prev', event.deltaY)
    },
    { passive: true }
  )

  // Mobile gesture handling with axis locking
  if (!isMobile) return

  const DEBUG_GESTURE_MODE = false

  let touchStartX = 0
  let touchStartY = 0
  let touchStartTime = 0
  let gestureLock: 'vertical' | 'horizontal' | null = null
  let activeTouchId: number | null = null
  let totalDeltaY = 0
  const LOCK_THRESHOLD = 15 // pixels to lock axis
  const SWIPE_THRESHOLD = 80 // minimum distance for feed navigation
  const VELOCITY_THRESHOLD = 0.3 // pixels per ms for velocity-based swipe

  // Two-finger gesture state
  let gestureMode: 'feed' | 'camera' | null = null
  let twoFingerMode: 'PINCH_ZOOM' | 'TWO_FINGER_ORBIT' | null = null
  let twoFingerTouches: Map<number, { x: number; y: number }> = new Map()
  let initialPinchDistance = 0
  let initialCameraDistance = 0
  let initialOrbitAngle = 0
  let initialOrbitPitch = 0
  const MIN_DISTANCE = 0.8
  const MAX_DISTANCE = 20
  const ZOOM_SENSITIVITY = 0.015
  const ORBIT_SENSITIVITY = 0.008
  const PITCH_MAX = 15 * (Math.PI / 180) // 15 degrees in radians
  const PINCH_THRESHOLD_PX = 15 // pixels of distance change to detect pinch
  const DEBUG_PINCH_ZOOM = false

  const getDistance = (t1: Touch, t2: Touch): number => {
    const dx = t2.clientX - t1.clientX
    const dy = t2.clientY - t1.clientY
    return Math.sqrt(dx * dx + dy * dy)
  }

  const getCenter = (t1: Touch, t2: Touch): { x: number; y: number } => {
    return {
      x: (t1.clientX + t2.clientX) / 2,
      y: (t1.clientY + t2.clientY) / 2,
    }
  }

  const getCameraDistance = (): number => {
    const camera = viewer.camera
    const controls = viewer.controls as unknown as { target?: THREE.Vector3 } | null
    if (!camera || !controls?.target) return 6
    return camera.position.distanceTo(controls.target)
  }

  const setCameraDistance = (distance: number): void => {
    const camera = viewer.camera
    const controls = viewer.controls as unknown as { target?: THREE.Vector3 } | null
    if (!camera || !controls?.target) return

    const clamped = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, distance))
    const direction = camera.position.clone().sub(controls.target).normalize()
    camera.position.copy(controls.target).add(direction.multiplyScalar(clamped))
    camera.lookAt(controls.target)
  }

  const handleTouchStart = (event: TouchEvent) => {
    // Don't interfere with HUD interactions
    const target = event.target as HTMLElement
    if (target.closest('#hud button, #hud input, #hud form')) {
      return
    }

    const touchCount = event.touches.length

    // Two-finger gesture: enter camera mode (mode not locked yet)
    if (touchCount === 2) {
      gestureMode = 'camera'
      twoFingerMode = null // Will be determined on first move
      activeTouchId = null
      gestureLock = null

      const t1 = event.touches[0]
      const t2 = event.touches[1]
      initialPinchDistance = getDistance(t1, t2)
      initialCameraDistance = getCameraDistance()
      twoFingerTouches.set(t1.identifier, { x: t1.clientX, y: t1.clientY })
      twoFingerTouches.set(t2.identifier, { x: t2.clientX, y: t2.clientY })

      const camera = viewer.camera
      const controls = viewer.controls as unknown as { target?: THREE.Vector3 } | null
      if (camera && controls?.target) {
        const offset = camera.position.clone().sub(controls.target)
        initialOrbitAngle = Math.atan2(offset.x, offset.z)
        const horizontalDist = Math.sqrt(offset.x * offset.x + offset.z * offset.z)
        initialOrbitPitch = Math.atan2(offset.y, horizontalDist)
      }

      // Disable OrbitControls during two-finger gestures
      const orbitControls = viewer.controls as unknown as { enabled?: boolean } | null
      if (orbitControls) {
        orbitControls.enabled = false
      }

      if (DEBUG_GESTURE_MODE) {
        console.log('[GESTURE] Enter camera mode (2 fingers), mode not yet determined')
      }

      event.preventDefault()
      return
    }

    // One-finger gesture: enter feed mode (only if not already in camera mode)
    if (touchCount === 1 && gestureMode !== 'camera' && activeTouchId === null) {
      gestureMode = 'feed'
      const touch = event.touches[0]
      activeTouchId = touch.identifier
      touchStartX = touch.clientX
      touchStartY = touch.clientY
      touchStartTime = performance.now()
      gestureLock = null
      totalDeltaY = 0

      if (DEBUG_GESTURE_MODE) {
        console.log('[GESTURE] Enter feed mode (1 finger)')
      }

      event.preventDefault()
    }
  }

  const handleTouchMove = (event: TouchEvent) => {
    const touchCount = event.touches.length

    // Two-finger camera gestures
    if (touchCount === 2 && gestureMode === 'camera') {
      event.preventDefault()

      const t1 = event.touches[0]
      const t2 = event.touches[1]
      const currentDistance = getDistance(t1, t2)
      const center = getCenter(t1, t2)

      const camera = viewer.camera
      const controls = viewer.controls as unknown as { target?: THREE.Vector3 } | null
      if (!camera || !controls?.target) return

      // Determine gesture mode if not yet locked
      if (twoFingerMode === null) {
        const distanceDelta = Math.abs(currentDistance - initialPinchDistance)
        if (distanceDelta > PINCH_THRESHOLD_PX) {
          twoFingerMode = 'PINCH_ZOOM'
          if (DEBUG_GESTURE_MODE) {
            console.log('[GESTURE] Locked to PINCH_ZOOM mode')
          }
        } else {
          // Check for drag (center movement)
          const prevCenter = twoFingerTouches.size === 2
            ? (() => {
                const prevTouches = Array.from(twoFingerTouches.values())
                return {
                  x: (prevTouches[0].x + prevTouches[1].x) / 2,
                  y: (prevTouches[0].y + prevTouches[1].y) / 2,
                }
              })()
            : center
          const dragX = Math.abs(center.x - prevCenter.x)
          const dragY = Math.abs(center.y - prevCenter.y)
          if (dragX > 3 || dragY > 3) {
            twoFingerMode = 'TWO_FINGER_ORBIT'
            if (DEBUG_GESTURE_MODE) {
              console.log('[GESTURE] Locked to TWO_FINGER_ORBIT mode')
            }
          }
        }
      }

      // Apply gesture based on locked mode
      if (twoFingerMode === 'PINCH_ZOOM') {
        // Pinch zoom only - ignore rotation
        const distanceDelta = currentDistance - initialPinchDistance
        // Fingers apart (positive delta) = zoom IN (decrease camera distance)
        // Fingers together (negative delta) = zoom OUT (increase camera distance)
        // Scale factor: positive delta reduces distance, negative delta increases distance
        const scaleFactor = 1 - distanceDelta * ZOOM_SENSITIVITY
        const newDistance = initialCameraDistance * scaleFactor
        setCameraDistance(newDistance)

        // Update OrbitControls if it has an update method
        const orbitControls = viewer.controls as unknown as { update?: () => void } | null
        if (orbitControls?.update) {
          orbitControls.update()
        }

        if (DEBUG_PINCH_ZOOM) {
          const actualDistance = getCameraDistance()
          console.log('[PINCH]', {
            minDistance: MIN_DISTANCE,
            maxDistance: MAX_DISTANCE,
            initialPinch: initialPinchDistance.toFixed(1),
            currentPinch: currentDistance.toFixed(1),
            delta: distanceDelta.toFixed(1),
            scaleFactor: scaleFactor.toFixed(3),
            initialCamDist: initialCameraDistance.toFixed(2),
            newCamDist: newDistance.toFixed(2),
            actualCamDist: actualDistance.toFixed(2),
          })
        }
      } else if (twoFingerMode === 'TWO_FINGER_ORBIT') {
        // Two-finger drag orbit only - ignore zoom
        const prevCenter = twoFingerTouches.size === 2
          ? (() => {
              const prevTouches = Array.from(twoFingerTouches.values())
              return {
                x: (prevTouches[0].x + prevTouches[1].x) / 2,
                y: (prevTouches[0].y + prevTouches[1].y) / 2,
              }
            })()
          : center

        const dragX = center.x - prevCenter.x
        const dragY = center.y - prevCenter.y

        if (Math.abs(dragX) > 1 || Math.abs(dragY) > 1) {
          const offset = camera.position.clone().sub(controls.target)
          const horizontalDist = Math.sqrt(offset.x * offset.x + offset.z * offset.z)

          // Yaw rotation
          const yawDelta = dragX * ORBIT_SENSITIVITY
          const newAngle = initialOrbitAngle + yawDelta

          // Pitch rotation (clamped)
          const pitchDelta = -dragY * ORBIT_SENSITIVITY * 0.5
          const newPitch = Math.max(
            -PITCH_MAX,
            Math.min(PITCH_MAX, initialOrbitPitch + pitchDelta)
          )

          const x = Math.sin(newAngle) * horizontalDist
          const z = Math.cos(newAngle) * horizontalDist
          const y = Math.sin(newPitch) * horizontalDist

          camera.position.set(
            controls.target.x + x,
            controls.target.y + y,
            controls.target.z + z
          )
          camera.lookAt(controls.target)
        }
      }

      // Update stored touch positions
      twoFingerTouches.set(t1.identifier, { x: t1.clientX, y: t1.clientY })
      twoFingerTouches.set(t2.identifier, { x: t2.clientX, y: t2.clientY })

      return
    }

    // One-finger feed gestures (only if in feed mode)
    if (gestureMode === 'feed' && activeTouchId !== null) {
      const touch = Array.from(event.touches).find((t) => t.identifier === activeTouchId)
      if (!touch) return

      const deltaX = touch.clientX - touchStartX
      const deltaY = touch.clientY - touchStartY
      totalDeltaY = deltaY

      // Lock axis after threshold
      if (gestureLock === null) {
        const absX = Math.abs(deltaX)
        const absY = Math.abs(deltaY)
        const distance = Math.sqrt(absX * absX + absY * absY)

        if (distance > LOCK_THRESHOLD) {
          gestureLock = absY > absX ? 'vertical' : 'horizontal'
        }
      }

      // Handle horizontal rotation (yaw only)
      if (gestureLock === 'horizontal') {
        event.preventDefault()
        const camera = viewer.camera
        const controls = viewer.controls as unknown as {
          enabled: boolean
          target: THREE.Vector3
        } | null

        if (camera && controls) {
          // Rotate camera around Y axis (yaw) relative to target
          const rotationSpeed = 0.01
          const angle = deltaX * rotationSpeed

          // Get camera position relative to target
          const offset = camera.position.clone().sub(controls.target)

          // Rotate offset around Y axis
          const rotation = new THREE.Matrix4().makeRotationY(angle)
          offset.applyMatrix4(rotation)

          // Update camera position
          camera.position.copy(controls.target).add(offset)
          camera.lookAt(controls.target)

          // Update touch start for smooth continuous rotation
          touchStartX = touch.clientX
        }
      } else if (gestureLock === 'vertical') {
        // Prevent browser scroll during vertical gesture
        event.preventDefault()
      }
    }
  }

  const handleTouchEnd = (event: TouchEvent) => {
    const touchCount = event.touches.length

    // Two-finger gesture ended
    if (gestureMode === 'camera') {
      // Remove ended touches
      for (let i = 0; i < event.changedTouches.length; i++) {
        twoFingerTouches.delete(event.changedTouches[i].identifier)
      }

      // If no touches remain, exit camera mode
      if (touchCount === 0) {
        gestureMode = null
        twoFingerMode = null
        twoFingerTouches.clear()
        // Re-enable OrbitControls
        const orbitControls = viewer.controls as unknown as { enabled?: boolean } | null
        if (orbitControls) {
          orbitControls.enabled = true
        }
        if (DEBUG_GESTURE_MODE) {
          console.log('[GESTURE] Exit camera mode')
        }
      } else if (touchCount === 1) {
        // Transition to feed mode if only one touch remains
        gestureMode = 'feed'
        const remainingTouch = event.touches[0]
        activeTouchId = remainingTouch.identifier
        touchStartX = remainingTouch.clientX
        touchStartY = remainingTouch.clientY
        touchStartTime = performance.now()
        gestureLock = null
        totalDeltaY = 0
        twoFingerTouches.clear()
        if (DEBUG_GESTURE_MODE) {
          console.log('[GESTURE] Transition to feed mode (1 finger remaining)')
        }
      }
      return
    }

    // One-finger feed gesture ended
    if (gestureMode === 'feed' && activeTouchId !== null) {
      const touch = Array.from(event.changedTouches).find((t) => t.identifier === activeTouchId)
      if (!touch) {
        activeTouchId = null
        gestureLock = null
        gestureMode = null
        return
      }

      const deltaY = totalDeltaY
      const deltaTime = performance.now() - touchStartTime
      const velocity = Math.abs(deltaY) / deltaTime

      // Only trigger feed navigation if:
      // 1. Gesture was locked to vertical, AND
      // 2. Distance exceeds threshold OR velocity exceeds threshold
      if (gestureLock === 'vertical' && (Math.abs(deltaY) > SWIPE_THRESHOLD || velocity > VELOCITY_THRESHOLD)) {
        event.preventDefault()
        void navigateSplat(deltaY > 0 ? 'prev' : 'next', deltaY)
      }

      activeTouchId = null
      gestureLock = null
      gestureMode = null
      totalDeltaY = 0
    }
  }

  const handleTouchCancel = () => {
    activeTouchId = null
    gestureLock = null
    gestureMode = null
    twoFingerMode = null
    totalDeltaY = 0
    twoFingerTouches.clear()
    // Re-enable OrbitControls if we were in camera mode
    const orbitControls = viewer.controls as unknown as { enabled?: boolean } | null
    if (orbitControls) {
      orbitControls.enabled = true
    }
  }

  // Use non-passive listeners to prevent browser scroll
  viewerRoot.addEventListener('touchstart', handleTouchStart, { passive: false })
  viewerRoot.addEventListener('touchmove', handleTouchMove, { passive: false })
  viewerRoot.addEventListener('touchend', handleTouchEnd, { passive: false })
  viewerRoot.addEventListener('touchcancel', handleTouchCancel, { passive: false })
}

const start = async () => {
  console.log('[INIT] Device', isMobile ? 'mobile' : 'desktop')
  console.log('[INIT] Renderer pixel ratio', viewer.renderer?.getPixelRatio())
  console.log('[INIT] View-dependent loading enabled', ENABLE_VIEW_DEPENDENT_LOADING)
  splatEntries = await loadManifest()
  
  if (splatEntries.length === 0) {
    console.error('[INIT] No splat entries in manifest')
    showErrorToast('No splats found in manifest')
    return
  }

  console.log('[INIT] Loading first splat (index 0)')
  await loadSplat(0)
  currentPoses = splatEntries[0]?.cameraPoses
  
  setupOrbitControls()
  setupOrbitStabilization()
  setupPoseSnapping()
  setupSplatNavigation()
  hudResult.setResetHandler(resetView)
  viewer.start()
  
  const camera = viewer.camera
  if (camera) {
    console.log('[INIT] Camera position', camera.position.toArray())
    const target = (viewer.controls as unknown as { target?: THREE.Vector3 })?.target
    if (target) {
      camera.lookAt(target)
      console.log('[INIT] Camera target', target.toArray())
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
