import './style.css'
import * as THREE from 'three'
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d'
import { AnnotationManager, type Annotation } from './annotations/AnnotationManager'
import { ParticleDisintegration } from './transitions/ParticleDisintegration'
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
  } catch (error) {
    console.error('[LOAD] failed', error)
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
  const oldIndex = currentIndex

  console.log('[LOAD] starting index', index, 'entry:', entry.id, 'loadId:', loadId)

  showPoster('Loading splat...')

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
  let isDragging = false

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
    isDragging = false
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
    isDragging = true

    try {
      viewerRoot.setPointerCapture(event.pointerId)
    } catch (error) {
      console.warn('setPointerCapture failed', event.pointerId, error)
      activePointerId = null
      isDragging = false
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

  const handleMouseUp = (event: MouseEvent) => {
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

const navigateSplat = async (direction: 'next' | 'prev', delta: number) => {
  if (isTransitioning || splatEntries.length < 2) return

  // If currently loading, queue the navigation
  if (loadState === 'LOADING') {
    console.log('[NAV] queuing navigation', direction, '(currently loading)')
    pendingNavigation = direction
    return
  }

  isTransitioning = true
  console.log('[NAV] start', direction, 'delta:', delta)

  const targetIndex =
    direction === 'next'
      ? (currentIndex + 1) % splatEntries.length
      : (currentIndex - 1 + splatEntries.length) % splatEntries.length

  console.log('[NAV] index', currentIndex, '->', targetIndex)

  if (currentSplatMesh) {
    const particleCount = particleSystem.start(currentSplatMesh, direction === 'next' ? 'down' : 'up')
    console.log('[NAV] particle disintegration start', particleCount)
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
    console.log('[NAV] particle disintegration end')
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
