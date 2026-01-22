import * as THREE from 'three'
import type { SplatEngine } from '../engine/SplatEngine'
import { ParticleDisintegration } from '../transitions/ParticleDisintegration'

type FeedState = 'IDLE_VIEWING' | 'TRANSITION_OUT' | 'LOADING_NEXT' | 'TRANSITION_IN'

type ManifestEntry = { id: string }

export const createTransitions = ({
  engine,
  container,
  debug = false,
  onEntryChange,
}: {
  engine: SplatEngine
  container: HTMLElement
  debug?: boolean
  onEntryChange?: (entryId: string) => void
}) => {
  const state = {
    currentIndex: 0,
    feedState: 'IDLE_VIEWING' as FeedState,
    isTransitioning: false,
  }
  const mask = document.createElement('div')
  mask.className = 'transition-mask'
  container.appendChild(mask)

  const particleScene = new THREE.Scene()
  const particleCamera = new THREE.PerspectiveCamera(60, 1, 0.1, 100)
  particleCamera.position.set(0, 0, 5)
  const particleRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: false })
  particleRenderer.setPixelRatio(1)
  particleRenderer.setSize(container.clientWidth, container.clientHeight)
  particleRenderer.domElement.className = 'particle-layer'
  container.appendChild(particleRenderer.domElement)

  const particleSystem = new ParticleDisintegration(particleScene)

  const resize = () => {
    const { clientWidth, clientHeight } = container
    particleCamera.aspect = clientWidth / clientHeight
    particleCamera.updateProjectionMatrix()
    particleRenderer.setSize(clientWidth, clientHeight)
  }
  window.addEventListener('resize', resize)
  resize()

  let entries: ManifestEntry[] = []

  const setState = (next: FeedState) => {
    state.feedState = next
    if (debug) console.log('State', next)
  }

  const navigate = async (direction: 'next' | 'prev', delta: number) => {
    if (state.isTransitioning || entries.length < 2 || state.feedState !== 'IDLE_VIEWING') return
    state.isTransitioning = true
    setState('TRANSITION_OUT')
    if (debug) console.log('Scroll delta', delta)
    const targetIndex =
      direction === 'next'
        ? (state.currentIndex + 1) % entries.length
        : (state.currentIndex - 1 + entries.length) % entries.length
    if (debug) console.log('Navigate splat', state.currentIndex, '->', targetIndex)
    const count = particleSystem.start(
      {
        getSplatCount: () => 2000,
        getSplatCenter: (_: number, out: THREE.Vector3) => {
          out.set((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, Math.random() * 2)
        },
      },
      direction === 'next' ? 'down' : 'up'
    )
    if (debug) console.log('Particle disintegration start', count)

    const transitionStart = performance.now()
    const transitionDuration = 700
    mask.style.opacity = '0'
    mask.classList.add('transition-mask--active')

    const tickOut = async (time: number) => {
      particleSystem.update(time)
      particleRenderer.render(particleScene, particleCamera)
      const progress = Math.min(1, (time - transitionStart) / transitionDuration)
      mask.style.opacity = String(0.8 * progress)
      if (time - transitionStart < transitionDuration) {
        requestAnimationFrame(tickOut)
        return
      }
      setState('LOADING_NEXT')
      const nextEntry = entries[targetIndex]
      if (!nextEntry) {
        state.isTransitioning = false
        setState('IDLE_VIEWING')
        return
      }
      await engine.loadSplat(nextEntry.id)
      onEntryChange?.(nextEntry.id)
      state.currentIndex = targetIndex
      setState('TRANSITION_IN')
      const fadeStart = performance.now()
      const fadeDuration = 500
      const tickIn = (fadeTime: number) => {
        const fadeProgress = Math.min(1, (fadeTime - fadeStart) / fadeDuration)
        mask.style.opacity = String(0.8 * (1 - fadeProgress))
        if (fadeProgress < 1) {
          requestAnimationFrame(tickIn)
          return
        }
        mask.classList.remove('transition-mask--active')
        setState('IDLE_VIEWING')
        state.isTransitioning = false
      }
      requestAnimationFrame(tickIn)
    }
    requestAnimationFrame(tickOut)
  }

  const attach = (domElement: HTMLElement) => {
    let touchStartY = 0
    let touchStartTime = 0
    domElement.addEventListener(
      'wheel',
      (event) => {
        if (state.feedState !== 'IDLE_VIEWING') return
        if (Math.abs(event.deltaY) < 30) return
        void navigate(event.deltaY > 0 ? 'next' : 'prev', event.deltaY)
      },
      { passive: true }
    )
    domElement.addEventListener(
      'touchstart',
      (event) => {
        if (state.feedState !== 'IDLE_VIEWING') return
        if (event.touches.length === 1) {
          touchStartY = event.touches[0].clientY
          touchStartTime = performance.now()
        }
      },
      { passive: true }
    )
    domElement.addEventListener(
      'touchend',
      (event) => {
        if (state.feedState !== 'IDLE_VIEWING') return
        if (event.changedTouches.length !== 1) return
        const delta = touchStartY - event.changedTouches[0].clientY
        if (Math.abs(delta) < 50) return
        const dt = Math.max(1, performance.now() - touchStartTime)
        const velocity = Math.abs(delta) / dt
        if (debug) console.log('Swipe velocity', velocity.toFixed(3))
        if (velocity < 0.25) return
        void navigate(delta > 0 ? 'next' : 'prev', delta)
      },
      { passive: true }
    )
  }

  return {
    attach,
    update: () => {
      if (state.isTransitioning) {
        particleRenderer.render(particleScene, particleCamera)
      }
    },
    setEntries: (nextEntries: ManifestEntry[]) => {
      entries = nextEntries
    },
    getState: () => ({ ...state }),
  }
}
