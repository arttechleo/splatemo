import type { SplatEntry } from './types'

type ViewerLike = {
  addSplatScene: (path: string, options: Record<string, unknown>) => Promise<unknown>
  removeSplatScene: (index: number, showLoadingUI?: boolean) => Promise<void>
  isLoadingOrUnloading?: () => boolean
}

type SplatManagerOptions = {
  rotation: [number, number, number, number]
  onProgress?: (value: number) => void
}

export class SplatManager {
  private viewer: ViewerLike
  private entries: SplatEntry[]
  private currentIndex = 0
  private preloaded = new Map<string, string>()
  private options: SplatManagerOptions

  constructor(viewer: ViewerLike, entries: SplatEntry[], options: SplatManagerOptions) {
    this.viewer = viewer
    this.entries = entries
    this.options = options
  }

  getCurrentEntry() {
    return this.entries[this.currentIndex]
  }

  getEntries() {
    return this.entries
  }

  async preload(index: number) {
    const entry = this.entries[index]
    if (!entry || this.preloaded.has(entry.id)) return
    const response = await fetch(`/splats/${entry.file}`)
    if (!response.ok) return
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    this.preloaded.set(entry.id, url)
  }

  private resolvePath(entry: SplatEntry) {
    return this.preloaded.get(entry.id) ?? `/splats/${entry.file}`
  }

  async loadInitial() {
    const entry = this.entries[0]
    await this.loadEntry(entry, true)
    this.preloadNext()
  }

  async transitionTo(index: number) {
    if (index === this.currentIndex) return
    const entry = this.entries[index]
    if (!entry) return

    await this.viewer.removeSplatScene(0, false)
    await this.loadEntry(entry, true)
    this.currentIndex = index
    this.preloadNext()
  }

  private async loadEntry(entry: SplatEntry, progressiveLoad: boolean) {
    const path = this.resolvePath(entry)
    await this.viewer.addSplatScene(path, {
      showLoadingUI: true,
      progressiveLoad,
      splatAlphaRemovalThreshold: 5,
      rotation: this.options.rotation,
      onProgress: this.options.onProgress,
    })
    const cachedUrl = this.preloaded.get(entry.id)
    if (cachedUrl) {
      URL.revokeObjectURL(cachedUrl)
      this.preloaded.delete(entry.id)
    }
  }

  private preloadNext() {
    const nextIndex = (this.currentIndex + 1) % this.entries.length
    void this.preload(nextIndex)
  }
}
