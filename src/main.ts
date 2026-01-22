import './style.css'
import { SplatEngine } from './engine/SplatEngine'
import { createControls } from './ux/controls'
import { createTransitions } from './ux/transitions'
import { createAnnotations } from './ux/annotations'
import { createOverlay } from './ui/overlay'

const params = new URLSearchParams(window.location.search)
const DEBUG_MODE = params.get('debug') === '1'
const SAFE_MODE = params.get('safe') === '1'

const ENABLE_PARTICLE_TRANSITIONS = !SAFE_MODE
const ENABLE_2D_TO_3D_REVEAL = !SAFE_MODE
const ENABLE_VIEW_DEPENDENT_LOADING = false

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
if (SAFE_MODE) {
  overlay.style.display = 'none'
}

const hint = document.createElement('div')
hint.className = 'feed-hint'
hint.textContent = 'Swipe to next'
app.appendChild(hint)
if (SAFE_MODE) {
  hint.style.display = 'none'
}

const engine = new SplatEngine({ debug: DEBUG_MODE })
let controls: ReturnType<typeof createControls> | null = null
const annotations = createAnnotations({ engine, container: annotationsRoot })
if (SAFE_MODE) {
  annotationsRoot.style.display = 'none'
}
const transitions = createTransitions({
  engine,
  container: viewerRoot,
  debug: DEBUG_MODE,
  onEntryChange: (entryId) => annotations.setForEntry(entryId),
})

engine.onProgress((p) => {
  const statusEl = poster.querySelector<HTMLParagraphElement>('.poster__status')
  if (statusEl) statusEl.textContent = `Loading ${Math.round(p)}%`
})

engine.onReady(() => {
  if (!ENABLE_2D_TO_3D_REVEAL) {
    poster.classList.add('poster--hidden')
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
    }
  }
  requestAnimationFrame(fade)
})

engine.onError((err) => {
  console.error('Engine error', err)
})

const start = async () => {
  await engine.mount(viewerRoot)
  controls = createControls({ engine, debug: DEBUG_MODE })
  const entries = engine.getManifestEntries()
  if (!entries.length) {
    throw new Error('No splat entries available.')
  }
  await engine.loadSplat(entries[0].id)
  annotations.setForEntry(entries[0].id)
  transitions.setEntries(entries)
  if (!SAFE_MODE) {
    transitions.attach(viewerRoot)
  }

  let last = performance.now()
  const tick = (time: number) => {
    const dt = (time - last) / 1000
    last = time
    engine.tick(dt)
    if (engine.state === 'READY') {
      controls?.update(dt)
      if (ENABLE_PARTICLE_TRANSITIONS) {
        transitions.update()
      }
      if (!SAFE_MODE) {
        annotations.update()
      }
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)

  if (DEBUG_MODE) {
    const canvas = engine.getRendererDomElement()
    if (canvas) {
      const styles = window.getComputedStyle(canvas)
      console.log('Canvas style', {
        display: styles.display,
        visibility: styles.visibility,
        opacity: styles.opacity,
        zIndex: styles.zIndex,
      })
      const center = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)
      console.log('Element at center', center)
    }
  }
  console.log('View-dependent loading enabled', ENABLE_VIEW_DEPENDENT_LOADING)
}

start().catch((error: unknown) => {
  console.error('Failed to start app', error)
})

if (DEBUG_MODE) {
  window.addEventListener('keydown', (event) => {
    if (event.key.toLowerCase() !== 'd') return
    const next = overlay.style.display === 'none' ? '' : 'none'
    overlay.style.display = next
    annotationsRoot.style.display = next
    hint.style.display = next
    console.log('UI overlay toggle', next === '' ? 'shown' : 'hidden')
  })
}
