import './style.css'
import * as THREE from 'three'
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d'
import { AnnotationManager, type Annotation } from './annotations/AnnotationManager'
import { ParticleDisintegration } from './transitions/ParticleDisintegration'
import { SplatTransitionOverlay } from './transitions/SplatTransitionOverlay'
import { AudioWavelength } from './effects/AudioWavelength'
import { AudioPulseDriver } from './effects/AudioPulseDriver'
import { OffAxisCamera } from './effects/OffAxisCamera'
import { ColorSampler } from './effects/ColorSampler'
import { EffectsController } from './effects/EffectsController'
import { TapInteractions } from './effects/TapInteractions'
import { EffectGovernor } from './effects/EffectGovernor'
import { TimeEffects } from './effects/TimeEffects'
import { InterpretiveEffects } from './effects/InterpretiveEffects'
import { MicroFeedback } from './effects/MicroFeedback'
import { FeedGhostPreview } from './effects/FeedGhostPreview'
import { SplatFocus } from './effects/SplatFocus'
import { LikeAffordance } from './effects/LikeAffordance'
import { ExplorationLab } from './effects/ExplorationLab'
import { IdleEffects } from './effects/IdleEffects'
import { MotionEffects } from './effects/MotionEffects'
import { FilmicOverlays } from './effects/FilmicOverlays'
import { CinematicSplitTransition } from './transitions/CinematicSplitTransition'
import { DepthDrift } from './effects/DepthDrift'
import { LooksLibrary } from './effects/LooksLibrary'
import { PerformanceOptimizer } from './effects/PerformanceOptimizer'
import { PerformanceController } from './effects/PerformanceController'
import { OverlayCompositor } from './effects/OverlayCompositor'
import { PerformanceDebug } from './effects/PerformanceDebug'
import { VolumetricEffectsManager } from './effects/VolumetricEffects'
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

hudResult.setOffAxisToggleHandler(async (enabled: boolean) => {
  if (!offAxisCamera && viewer.camera) {
    offAxisCamera = new OffAxisCamera(viewer.camera, viewer.controls as { target?: THREE.Vector3 } | null)
    // Set status update callback
    offAxisCamera.setOnStatusUpdate((status: 'idle' | 'tracking' | 'error') => {
      hudResult.updateOffAxisStatus(status)
    })
  }
  if (!offAxisCamera) {
    showErrorToast('Camera not available')
    hudResult.updateOffAxisStatus('error')
    return
  }
  if (enabled) {
    hudResult.updateOffAxisStatus('idle')
    const success = await offAxisCamera.enable()
    if (!success) {
      showErrorToast('Camera access required for off-axis mode')
      hudResult.updateOffAxisStatus('error')
      // Reset button state
      const offAxisButton = hud.querySelector<HTMLButtonElement>('.hud__button--off-axis')
      if (offAxisButton) {
        offAxisButton.classList.remove('hud__button--active')
      }
    } else {
      hudResult.updateOffAxisStatus('tracking')
    }
  } else {
    offAxisCamera.disable()
    hudResult.updateOffAxisStatus('idle')
  }
})

hudResult.setEffectsConfigChangeHandler((config) => {
  effectsController.setConfig({
    preset: config.preset as any,
    intensity: config.intensity,
    enabled: config.enabled,
    intensityPreset: (config.intensityPreset as any) || 'medium',
    boost: config.boost || 1.0,
  })
  
  // Depth Drift effect (handled separately, not in EffectsController)
  if (config.preset === 'depth-drift') {
    const intensityPreset = (config.intensityPreset as 'subtle' | 'medium' | 'vivid') || 'bold'
    // Higher ceiling for visibility: subtle 0.6x, medium 1.0x, vivid 2.5x
    // "Bold" preset (default): 1.2x for demo visibility
    const intensityMultipliers: Record<string, number> = { 
      subtle: 0.6, 
      medium: 1.0, 
      vivid: 2.5,
      bold: 1.2, // Default "Bold" preset
    }
    const effectiveIntensity = Math.min(1.0, config.intensity * (intensityMultipliers[intensityPreset] || 1.2))
    
    depthDrift.setConfig({
      enabled: config.enabled,
      intensity: effectiveIntensity,
    })
  } else {
    depthDrift.setConfig({ enabled: false })
  }
  
  // Discovery disabled - no mode-based effects
})

// Discovery mode disabled - removed handlers

hudResult.setVividModeToggleHandler((enabled: boolean) => {
  effectGovernor.setVividMode(enabled)
  
  // Apply vivid multiplier to overlay
  const vividMultiplier = effectGovernor.getVividMultiplier()
  splatTransitionOverlay.setVividMultiplier(vividMultiplier)
  
  // Idle effects disabled - no mode switching needed
  
  // Boost existing effects
  if (enabled) {
    // Increase intensity of active effects
    const activeEffects = effectGovernor.getActiveEffects()
    for (const effect of activeEffects) {
      const boostedIntensity = Math.min(1.0, effect.intensity * 1.3)
      effectGovernor.updateIntensity(effect.id, boostedIntensity)
    }
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

// Cinematic transitions and filmic overlays
const cinematicSplitTransition = new CinematicSplitTransition(app)
const filmicOverlays = new FilmicOverlays(app)

// Depth Drift effect
const depthDrift = new DepthDrift(app)

// Volumetric Effects Manager (splat-native visual effects)
const volumetricEffects = new VolumetricEffectsManager(app)

// Bottom loading indicator removed - using top HUD loading bar only

const isMobile = /Mobi|Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)

// Looks library (no arguments needed)
const looksLibrary = new LooksLibrary(app)

// Performance optimizer (adaptive quality controller) - legacy, kept for compatibility
const performanceOptimizer = new PerformanceOptimizer({
  targetFPS: isMobile ? 30 : 60,
  lowFPSThreshold: isMobile ? 25 : 50,
  recoveryFPSThreshold: isMobile ? 28 : 55,
})

// Performance controller with quality tiers (HIGH/MED/LOW)
const performanceController = new PerformanceController({
  targetFPS: isMobile ? 30 : 60,
  lowFPSThreshold: isMobile ? 25 : 50,
  recoveryFPSThreshold: isMobile ? 28 : 55,
})

// Overlay compositor (single RAF loop for all effects)
const overlayCompositor = new OverlayCompositor(app)
overlayCompositor.start()

// Wire performance controller to compositor
performanceController.onTierChange((tier) => {
  overlayCompositor.setQualityTier(tier)
})

// Performance debug (optional, off by default)
const performanceDebug = new PerformanceDebug(app)
// Use BASE_URL to handle any base path configuration (defaults to '/')
// Ensure BASE_URL ends with '/' for proper path joining
const BASE_URL = (import.meta.env.BASE_URL || '/').replace(/\/$/, '') + '/'
const manifestUrl = `${BASE_URL}splats/manifest.json`
console.log('[INIT] BASE_URL:', BASE_URL, 'manifestUrl:', manifestUrl)
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
  
    // Set source canvas for audio pulse driver, effects controller, and volumetric effects
    setTimeout(() => {
      audioPulseDriver.setSourceCanvas(viewer.renderer?.domElement ?? null)
      volumetricEffects.setSourceCanvas(viewer.renderer?.domElement ?? null)
    effectsController.setSourceCanvas(viewer.renderer?.domElement ?? null)
    effectsController.setCamera(viewer.camera, viewer.controls as { target?: THREE.Vector3; getAzimuthalAngle?: () => number } | null)
    
    // Depth Drift setup
    depthDrift.setSourceCanvas(viewer.renderer?.domElement ?? null)
    depthDrift.setCamera(viewer.camera, viewer.controls as { target?: THREE.Vector3 } | null)
    
  // Wire performance optimizer to depth drift (legacy)
  performanceOptimizer.onQualityChange((settings) => {
    depthDrift.setQualityMultiplier(settings.particleCountMultiplier)
  })
  
    // Wire performance controller to depth drift (new quality tier system)
  performanceController.onTierChange((tier) => {
    const tierMultipliers = { HIGH: 1.0, MED: 0.7, LOW: 0.4 }
    depthDrift.setQualityMultiplier(tierMultipliers[tier])
  })
  
  // Periodic debug update (if visible) - update every 500ms
  setInterval(() => {
    const fps = performanceController.getCurrentFPS()
    const frameTime = performanceController.getAverageFrameTime()
    const tier = performanceController.getCurrentTier()
    const config = overlayCompositor.getConfig()
    
    performanceDebug.update({
      fps,
      frameTime,
      qualityTier: tier,
      activeEffects: [
        {
          name: 'Depth Drift',
          particleCount: Math.floor(1200 * config.particleCountMultiplier),
          overlayDPR: config.overlayDPR,
          updateRate: config.maskRefreshRate * 60,
        },
        {
          name: 'Film Grain',
          updateRate: config.grainUpdateRate,
        },
        {
          name: 'Light Leak',
          updateRate: config.lightLeakUpdateRate,
        },
      ],
    })
  }, 500)
    
    tapInteractions.setSourceCanvas(viewer.renderer?.domElement ?? null)
    tapInteractions.setConfig({ enabled: true })
    
    // Phase 1: Wire tap focus and double tap like
    tapInteractions.setTapFocusHandler((_x: number, _y: number) => {
      if (explorationLab.getConfig().tapFocus) {
        // Recenter view
        resetView()
        // Clean focus animation (no particles)
        applyTapFocusAnimation()
      }
    })
    
    tapInteractions.setDoubleTapLikeHandler((x: number, y: number) => {
      // UI interactions must never spawn particles or dots. This is intentional for product polish.
      // Like affordance is now UI-only (no canvas drawing, no particles, no dots).
      // The likeAffordance.trigger() call is intentionally empty - all feedback is via UI button animations.
      if (explorationLab.getConfig().doubleTapLike) {
        likeAffordance.trigger(x, y) // No-op: UI-only feedback handled by button animations
      }
      
      // Double-tap zoom: zoom in to a sensible closer distance
      const camera = viewer.camera
      const controls = viewer.controls as unknown as { target?: THREE.Vector3 } | null
      if (camera && controls?.target) {
        const MIN_DISTANCE = 0.8
        const currentDistance = camera.position.distanceTo(controls.target)
        const zoomInDistance = Math.max(MIN_DISTANCE, currentDistance * 0.6) // Zoom to 60% of current distance
        
        // Set camera distance (inline function to avoid scope issues)
        const clamped = Math.max(MIN_DISTANCE, Math.min(20, zoomInDistance))
        const direction = camera.position.clone().sub(controls.target).normalize()
        camera.position.copy(controls.target).add(direction.multiplyScalar(clamped))
        camera.lookAt(controls.target)
        
        // Update OrbitControls if available
        const orbitControls = viewer.controls as unknown as { update?: () => void } | null
        if (orbitControls?.update) {
          orbitControls.update()
        }
      }
    })
    
    // Phase 2: Update lab config for tap interactions
    explorationLab.onConfigChange((config) => {
      tapInteractions.setLabConfig({
        rippleBurst: config.rippleBurst,
        revealSpotlight: config.revealSpotlight,
        depthScrubbing: config.depthScrubbing,
        memoryEchoes: config.memoryEchoes,
      })
      
      // Phase 1: Ghost preview
      feedGhostPreview.setEnabled(config.ghostPreview)
    })
    
    // Initialize lab config
    const initialLabConfig = explorationLab.getConfig()
    tapInteractions.setLabConfig({
      rippleBurst: initialLabConfig.rippleBurst,
      revealSpotlight: initialLabConfig.revealSpotlight,
      depthScrubbing: initialLabConfig.depthScrubbing,
      memoryEchoes: initialLabConfig.memoryEchoes,
    })
    feedGhostPreview.setEnabled(initialLabConfig.ghostPreview)
    
    timeEffects.setSourceCanvas(viewer.renderer?.domElement ?? null)
    interpretiveEffects.setSourceCanvas(viewer.renderer?.domElement ?? null)
    
    // Phase 3: Subtle Magic (controlled by lab config)
    idleEffects.setSourceCanvas(viewer.renderer?.domElement ?? null)
    
    explorationLab.onConfigChange((config) => {
      // Breathing presence
      if (config.breathingPresence) {
        idleEffects.start()
      } else {
        idleEffects.stop()
      }
      
      // Gyro gravity bias
      const isMobile = /Mobi|Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
      if (config.gyroGravityBias && isMobile) {
        motionEffects.enable()
      } else {
        motionEffects.disable()
      }
    })
    
    // Wire filmic overlays controls (legacy, kept for compatibility)
    // Note: Film grain is now part of Looks library
    
    // Wire Looks library controls
    hudResult.setLookChangeHandler((config: { type: string; intensity: number; enabled: boolean }) => {
      looksLibrary.setLook({
        type: config.type as any,
        intensity: config.intensity,
        enabled: config.enabled,
      })
    })
    
    // Set source canvas for looks that need it
    looksLibrary.setSourceCanvas(viewer.renderer?.domElement ?? null)
    
    // Wire depth drift tap excitement
    document.addEventListener('depth-drift-excite', () => {
      depthDrift.exciteNearestBand()
    })
    
    // Start time effects update loop
    const updateTimeEffects = () => {
      timeEffects.update()
      
      // Phase 3: Rare pulse disabled for clean demo (available in Lab toggle)
      // No automatic rare pulse - keep experience calm
      
      // Apply slow time factor to overlay (only if explicitly triggered)
      const slowTimeFactor = timeEffects.getSlowTimeFactor()
      splatTransitionOverlay.setSlowTimeFactor(slowTimeFactor)
      
      requestAnimationFrame(updateTimeEffects)
    }
    updateTimeEffects()
    
    // Start governor cleanup loop
    const cleanupGovernor = () => {
      effectGovernor.cleanup()
      requestAnimationFrame(cleanupGovernor)
    }
    cleanupGovernor()
    
    // Wire slow time activation
    document.addEventListener('slow-time-activate', () => {
      timeEffects.activateSlowTime()
    })
    
    // Wire density highlight (trigger on double-tap + hold)
    document.addEventListener('density-highlight-activate', () => {
      interpretiveEffects.activateDensityHighlight()
    })
    
    // Wire user interaction tracking
    document.addEventListener('user-interaction', () => {
      timeEffects.recordInteraction()
    })
    
    // Setup debug overlay (temporary)
    setupEffectDebugOverlay()
  }, 0)
  
  // Debug overlay setup
  const setupEffectDebugOverlay = () => {
    const debugCanvas = document.createElement('canvas')
    debugCanvas.id = 'effect-debug-overlay'
    debugCanvas.style.position = 'fixed'
    debugCanvas.style.top = '10px'
    debugCanvas.style.right = '10px'
    debugCanvas.style.width = '200px'
    debugCanvas.style.height = '150px'
    debugCanvas.style.background = 'rgba(0, 0, 0, 0.8)'
    debugCanvas.style.color = '#fff'
    debugCanvas.style.font = '11px monospace'
    debugCanvas.style.padding = '10px'
    debugCanvas.style.zIndex = '1000'
    debugCanvas.style.pointerEvents = 'none'
    debugCanvas.style.display = 'none' // Hidden by default
    document.body.appendChild(debugCanvas)
    
    // Toggle with 'D' key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'd' || e.key === 'D') {
        const isVisible = debugCanvas.style.display !== 'none'
        debugCanvas.style.display = isVisible ? 'none' : 'block'
        effectGovernor.setDebug(!isVisible, (effects) => {
          const ctx = debugCanvas.getContext('2d')
          if (!ctx) return
          
          const W = debugCanvas.width = 200
          const H = debugCanvas.height = 150
          ctx.clearRect(0, 0, W, H)
          ctx.fillStyle = '#000'
          ctx.fillRect(0, 0, W, H)
          ctx.fillStyle = '#fff'
          ctx.font = '11px monospace'
          
          let y = 20
          ctx.fillText('Active Effects:', 10, y)
          y += 18
          
          if (effects.length === 0) {
            ctx.fillText('  (none)', 10, y)
          } else {
            for (const effect of effects) {
              const age = ((performance.now() - effect.startTime) / 1000).toFixed(1)
              ctx.fillText(`  ${effect.id}`, 10, y)
              ctx.fillText(`${(effect.intensity * 100).toFixed(0)}%`, 120, y)
              ctx.fillText(`${age}s`, 160, y)
              y += 16
            }
          }
          
          y += 10
          ctx.fillText(`Total: ${effectGovernor.getTotalIntensity().toFixed(2)}`, 10, y)
        })
      }
    })
  }
}

// Color sampler for Recenter button
const colorSampler = new ColorSampler(null)
colorSampler.setOnColorUpdate((data) => {
  const resetButton = hud.querySelector<HTMLButtonElement>('.hud__button--reset')
  if (resetButton) {
    resetButton.style.background = data.contrastStyle.background
    resetButton.style.borderColor = data.contrastStyle.border
    resetButton.style.color = data.contrastStyle.color
    resetButton.style.boxShadow = `${data.contrastStyle.glow}, 0 0 0 1px ${data.contrastStyle.border}`
  }
})

// Update color sampler canvas reference
setTimeout(() => {
  colorSampler.setSourceCanvas(viewer.renderer?.domElement ?? null)
  colorSampler.start()
}, 1000)

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
const audioPulseDriver = new AudioPulseDriver(splatTransitionOverlay, null, null, null)
const effectsController = new EffectsController(splatTransitionOverlay)

// Effects System (Discovery disabled - no idle/motion auto-effects)
const effectGovernor = new EffectGovernor()
const timeEffects = new TimeEffects(splatTransitionOverlay, effectGovernor)
const interpretiveEffects = new InterpretiveEffects(splatTransitionOverlay, effectGovernor)
const tapInteractions = new TapInteractions(splatTransitionOverlay, effectGovernor)
const microFeedback = new MicroFeedback()

// Exploration Playground
const feedGhostPreview = new FeedGhostPreview()
const splatFocus = new SplatFocus(splatTransitionOverlay)
const likeAffordance = new LikeAffordance(splatTransitionOverlay)
const explorationLab = new ExplorationLab()

// Subtle Magic (Phase 3) - re-enabled but controlled
const idleEffects = new IdleEffects(splatTransitionOverlay, effectGovernor)
const motionEffects = new MotionEffects(effectGovernor)

// Off-axis camera will be initialized after viewer camera is ready
let offAxisCamera: OffAxisCamera | null = null

viewer.onSplatMeshChanged((splatMesh: typeof currentSplatMesh) => {
  currentSplatMesh = splatMesh
  
  // Update audio pulse driver with new mesh and camera
  if (splatMesh) {
    audioPulseDriver.setCamera(viewer.camera, viewer.controls as { target?: THREE.Vector3 } | null)
    audioPulseDriver.setSplatMesh(splatMesh)
  } else {
    audioPulseDriver.setSplatMesh(null)
  }
  
  // Update camera reference for effects (for parallax)
  effectsController.setCamera(viewer.camera, viewer.controls as { target?: THREE.Vector3; getAzimuthalAngle?: () => number } | null)
  // Discovery disabled - removed camera setup
  
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
  url?: string // Absolute HTTPS URL for production, or relative path for dev
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

// Resolve PLY URL: use manifest.url if provided (absolute or relative), otherwise fallback to relative path
const resolveSplatUrl = (entry: SplatEntry): string => {
  if (entry.url) {
    // If URL is absolute (starts with http:// or https://), use it directly
    if (entry.url.startsWith('http://') || entry.url.startsWith('https://')) {
      return entry.url
    }
    // If URL is relative, make it BASE_URL-safe
    return entry.url.startsWith('/') ? entry.url : `${BASE_URL}${entry.url}`
  }
  // Fallback: construct relative path for dev/local
  return `${BASE_URL}splats/${entry.file}`
}

const prefetchSplat = async (entry: SplatEntry) => {
  // Just prefetch to browser cache - don't create blob URLs
  // The viewer library doesn't support blob URLs, so we rely on HTTP cache
  if (splatCache.has(entry.id)) return
  const url = resolveSplatUrl(entry)
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
  const url = resolveSplatUrl(entry)
  const oldUrl = currentUrl

  console.log('[SWAP] start from', oldUrl || 'none', 'to', url, '(BASE_URL:', BASE_URL, ')')

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
        // Progress shown in HUD loading bar
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

/**
 * Apply scale-in animation when new splat lands.
 * Clean, non-particle settle animation.
 */
const applyScaleInAnimation = () => {
  const canvas = viewer.renderer?.domElement
  if (!canvas) return
  
  // Subtle scale settle: gentle zoom-in effect
  canvas.style.transition = 'transform 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94)'
  canvas.style.transform = 'scale(0.97)'
  
  // Trigger reflow
  void canvas.offsetWidth
  
  // Animate to scale(1)
  requestAnimationFrame(() => {
    canvas.style.transform = 'scale(1)'
    
    // Remove transition after animation
    setTimeout(() => {
      canvas.style.transition = ''
      canvas.style.transform = ''
    }, 350)
  })
}

/**
 * Apply subtle clarity boost on tap focus.
 * Clean, non-particle visual feedback.
 */
const applyTapFocusAnimation = () => {
  const canvas = viewer.renderer?.domElement
  if (!canvas) return
  
  // Cinematic focus: polished filmic easing with clarity boost
  canvas.style.transition = 'transform 0.35s cubic-bezier(0.22, 1.0, 0.36, 1.0), filter 0.35s cubic-bezier(0.22, 1.0, 0.36, 1.0)'
  canvas.style.transform = 'scale(0.98)'
  canvas.style.filter = 'brightness(1.05)'
  
  // Trigger reflow
  void canvas.offsetWidth
  
  // Animate back to normal
  requestAnimationFrame(() => {
    canvas.style.transform = 'scale(1)'
    canvas.style.filter = 'brightness(1)'
    
    // Remove transition after animation
    setTimeout(() => {
      canvas.style.transition = ''
      canvas.style.transform = ''
      canvas.style.filter = ''
    }, 350)
  })
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

  // Pause audio effects, off-axis, and effects during transition
  // Pause non-essential effects during navigation for smoother transitions
  audioWavelength.pause()
  audioPulseDriver.pause()
  offAxisCamera?.pause()
  performanceOptimizer.pause() // Pause FPS monitoring during transition
  performanceController.pause() // Pause performance controller during transition
  overlayCompositor.pause() // Pause compositor during transition
  effectsController.pause()
  depthDrift.pause() // Pause depth drift during transition
  volumetricEffects.pauseAll() // Pause all volumetric effects during transition
  // Looks library effects pause automatically via their RAF loops when disabled
  tapInteractions.setTransitioning(true)

  // Use cinematic split transition for feed navigation
  const splitDirection = direction === 'next' ? 'down' : 'up'
  cinematicSplitTransition.startTransition(splitDirection, sourceCanvas)
  
  // Trigger light leak sweep if enabled
  looksLibrary.triggerLightLeak(splitDirection)
  
  // Trigger chromatic whisper if enabled (motion-based)
  looksLibrary.triggerChromatic(splitDirection, 700)
  
  // Keep existing disintegrate as fallback/alternative
  if (isMobile) {
    splatTransitionOverlay.startTransition(
      direction === 'next' ? 'up' : 'down',
      sourceCanvas
    )
  } else if (currentSplatMesh) {
    particleSystem.start(currentSplatMesh, direction === 'next' ? 'down' : 'up')
  }

  const transitionStart = performance.now()
  const transitionDuration = 700 // 700ms for cinematic feel (600-800ms range)
  const renderModeSetter = viewer as unknown as { setRenderMode?: (mode: number) => void }
  renderModeSetter.setRenderMode?.(GaussianSplats3D.RenderMode.Always)
  
  // Reset ghost preview
  feedGhostPreview.reset()

  const tick = async (time: number) => {
    if (!isMobile) particleSystem.update(time)
    if (time - transitionStart < transitionDuration) {
      requestAnimationFrame(tick)
      return
    }
    await loadSplat(targetIndex)
    renderModeSetter.setRenderMode?.(GaussianSplats3D.RenderMode.OnChange)
    isTransitioning = false
    
    // End cinematic split transition
    cinematicSplitTransition.stop()
    
    if (isMobile) {
      splatTransitionOverlay.endTransition()
    }
    
    // Scale-in animation when new splat lands
    if (explorationLab.getConfig().scaleInAnimation) {
      applyScaleInAnimation()
    }
    // Resume audio effects, off-axis, and effects after transition
    audioWavelength.resume()
    audioPulseDriver.resume()
    offAxisCamera?.resume()
    effectsController.resume()
    // Resume effects after transition (splat is settled and visible)
    depthDrift.resume() // Resume depth drift after transition
    performanceOptimizer.resume() // Resume FPS monitoring after transition
    performanceController.resume() // Resume performance controller after transition
    overlayCompositor.resume() // Resume compositor after transition
    volumetricEffects.resumeAll() // Resume all volumetric effects after transition
    // Looks library will resume automatically when re-enabled
    tapInteractions.setTransitioning(false)
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
  
  // Double-tap zoom function (used by tapInteractions)
  const setCameraDistance = (distance: number): void => {
    const camera = viewer.camera
    const controls = viewer.controls as unknown as { target?: THREE.Vector3 } | null
    if (!camera || !controls?.target) return

    const clamped = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, distance))
    const direction = camera.position.clone().sub(controls.target).normalize()
    camera.position.copy(controls.target).add(direction.multiplyScalar(clamped))
    camera.lookAt(controls.target)
  }
  // Slower pinch zoom-out for more controlled feel
  // Asymmetric: zoom-in is faster, zoom-out is slower
  const ZOOM_IN_SENSITIVITY = 0.015 // Fingers apart = zoom in
  const ZOOM_OUT_SENSITIVITY = 0.008 // Fingers together = zoom out (slower)
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
  
  // setCameraDistance is defined above (before handleTouchStart)

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
        // Asymmetric sensitivity: zoom-out is slower for more controlled feel
        const sensitivity = distanceDelta > 0 ? ZOOM_IN_SENSITIVITY : ZOOM_OUT_SENSITIVITY
        const scaleFactor = 1 - distanceDelta * sensitivity
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
      const velocity = Math.abs(deltaY) / Math.max(deltaTime, 1) // Avoid division by zero

      // Instagram-style sticky feed: only trigger if gesture was locked to vertical
      // AND (distance exceeds threshold OR velocity exceeds threshold)
      if (gestureLock === 'vertical' && (Math.abs(deltaY) > SWIPE_THRESHOLD || velocity > VELOCITY_THRESHOLD)) {
        event.preventDefault()
        
        // Reset ghost preview
        feedGhostPreview.reset()
        
        // Subtle haptic for feed snap
        if ('vibrate' in navigator) {
          try {
            navigator.vibrate(5) // 5ms subtle haptic
          } catch {
            // Haptics not supported
          }
        }
        
        void navigateSplat(deltaY > 0 ? 'prev' : 'next', deltaY)
      }

      activeTouchId = null
      gestureLock = null
      gestureMode = null
      totalDeltaY = 0
      
      // Reset ghost preview
      feedGhostPreview.reset()
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
    
    // Initialize ghost preview
    feedGhostPreview.setViewer(viewer)
    feedGhostPreview.setCurrentIndex(currentIndex, splatEntries.length)
    
    // Set source canvas for focus and like
    splatFocus.setSourceCanvas(viewer.renderer?.domElement ?? null)
    likeAffordance.setSourceCanvas(viewer.renderer?.domElement ?? null)
    
    setupOrbitControls()
    setupOrbitStabilization()
    setupPoseSnapping()
    setupSplatNavigation()
  
  // Wire reset handler with micro-feedback
  const resetButton = hud.querySelector<HTMLButtonElement>('.hud__button--reset')
  if (resetButton) {
    resetButton.addEventListener('click', (e) => {
      const rect = resetButton.getBoundingClientRect()
      const tapX = (e as MouseEvent).clientX || rect.left + rect.width / 2
      const tapY = (e as MouseEvent).clientY || rect.top + rect.height / 2
      microFeedback.trigger('recenter', resetButton, tapX, tapY)
      resetView()
    })
  }
  
  hudResult.setResetHandler(() => {
    if (resetButton) {
      const rect = resetButton.getBoundingClientRect()
      microFeedback.trigger('recenter', resetButton, rect.left + rect.width / 2, rect.top + rect.height / 2)
    }
    resetView()
  })
  tapInteractions.setResetHandler(() => {
    if (resetButton) {
      const rect = resetButton.getBoundingClientRect()
      microFeedback.trigger('recenter', resetButton, rect.left + rect.width / 2, rect.top + rect.height / 2)
    }
    resetView()
  })
  
  // Wire micro-feedback to HUD buttons
  hudResult.setMicroFeedbackHandler((type, element, x, y) => {
    microFeedback.trigger(type, element, x, y)
  })
  
  // MicroFeedback no longer needs source canvas (UI-only, no particles)
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
