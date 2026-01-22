import './style.css'
import { SplatEngine } from './engine/SplatEngine'
import { createControls } from './ux/controls'
import { createTransitions } from './ux/transitions'
import { createAnnotations } from './ux/annotations'
import { createOverlay } from './ui/overlay'

const ENABLE_PARTICLE_TRANSITIONS = true
const ENABLE_2D_TO_3D_REVEAL = true
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

const hint = document.createElement('div')
hint.className = 'feed-hint'
hint.textContent = 'Swipe to next'
app.appendChild(hint)

const engine = new SplatEngine()
let controls: ReturnType<typeof createControls> | null = null
const annotations = createAnnotations({ engine, container: annotationsRoot })
const transitions = createTransitions({
  engine,
  container: viewerRoot,
  debug: true,
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
  controls = createControls({ engine, debug: true })
  const entries = engine.getManifestEntries()
  if (!entries.length) {
    throw new Error('No splat entries available.')
  }
  await engine.loadSplat(entries[0].id)
  annotations.setForEntry(entries[0].id)
  transitions.setEntries(entries)
  transitions.attach(viewerRoot)

  let last = performance.now()
  const tick = (time: number) => {
    const dt = (time - last) / 1000
    last = time
    engine.tick(dt)
    controls?.update(dt)
    if (ENABLE_PARTICLE_TRANSITIONS) {
      transitions.update()
    }
    annotations.update()
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)

  console.log('View-dependent loading enabled', ENABLE_VIEW_DEPENDENT_LOADING)
}

start().catch((error: unknown) => {
  console.error('Failed to start app', error)
})
