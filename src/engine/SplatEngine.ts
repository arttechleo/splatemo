import * as THREE from 'three'
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d'

export type EngineState = 'BOOT' | 'LOADING' | 'READY' | 'ERROR'
export type CameraPose = {
  position: [number, number, number]
  target: [number, number, number]
}
export type QualityProfile = 'HIGH' | 'MED' | 'LOW' | 'MOTION'

type ManifestEntry = {
  id: string
  name?: string
  file: string
  cameraPoses?: CameraPose[]
}

type Callback<T> = (value: T) => void
type SplatMeshRef = {
  parent?: unknown
  visible?: boolean
  material?: { opacity?: number; depthWrite?: boolean }
}

const QUALITY: Record<QualityProfile, { pixelRatio: number; kernel2DSize: number; shDegree: number }> =
  {
    HIGH: { pixelRatio: 1.5, kernel2DSize: 0.24, shDegree: 1 },
    MED: { pixelRatio: 1.25, kernel2DSize: 0.2, shDegree: 1 },
    LOW: { pixelRatio: 1, kernel2DSize: 0.18, shDegree: 0 },
    MOTION: { pixelRatio: 1, kernel2DSize: 0.16, shDegree: 0 },
  }

export class SplatEngine {
  state: EngineState = 'BOOT'
  private viewer: any | null = null
  private scene: THREE.Scene | null = null
  private container: HTMLElement | null = null
  private manifest: ManifestEntry[] = []
  private currentEntryId: string | null = null
  private target = new THREE.Vector3(0, 0, 0)
  private splatMesh: SplatMeshRef | null = null
  private splatResolveStart = 0
  private onProgressCbs: Callback<number>[] = []
  private onReadyCbs: Array<() => void> = []
  private onErrorCbs: Callback<unknown>[] = []
  private lastInvariantLog = 0
  private defaultPose: CameraPose = { position: [0, 0, 6], target: [0, 0, 0] }
  private debug = false
  private renderProbeLogged = false

  constructor(options?: { debug?: boolean }) {
    this.debug = options?.debug ?? false
  }

  async mount(container: HTMLElement): Promise<void> {
    if (this.state !== 'BOOT') return
    this.container = container
    this.scene = new THREE.Scene()
    this.viewer = new GaussianSplats3D.Viewer({
      rootElement: container,
      threeScene: this.scene,
      selfDrivenMode: false,
      cameraUp: [0, 1, 0],
      initialCameraPosition: this.defaultPose.position,
      initialCameraLookAt: this.defaultPose.target,
      sharedMemoryForWorkers: false,
      gpuAcceleratedSort: false,
      useBuiltInControls: false,
      renderMode: GaussianSplats3D.RenderMode.OnChange,
      sceneRevealMode: GaussianSplats3D.SceneRevealMode.Instant,
      sphericalHarmonicsDegree: 1,
      splatSortDistanceMapPrecision: 16,
      halfPrecisionCovariancesOnGPU: false,
      antialiased: false,
      kernel2DSize: 0.24,
      webXRMode: GaussianSplats3D.WebXRMode.None,
      logLevel: GaussianSplats3D.LogLevel.None,
    })

    if (this.viewer.renderer) {
      this.viewer.renderer.setClearColor(0x000000, 1)
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5)
      this.viewer.renderer.setPixelRatio(pixelRatio)
      if (this.debug) {
        const canvas = this.viewer.renderer.domElement
        const rect = canvas.getBoundingClientRect()
        console.log('Canvas size', rect.width, rect.height)
        console.log('Renderer size', canvas.width, canvas.height)
        console.log('Device pixel ratio', window.devicePixelRatio || 1)
      }
      this.viewer.renderer.domElement.addEventListener('webglcontextlost', (event: Event) => {
        event.preventDefault()
        this.emitError(new Error('WebGL context lost'))
      })
    }

    this.viewer.onSplatMeshChanged((mesh: typeof this.splatMesh) => {
      this.splatMesh = mesh
      if (mesh?.material) {
        mesh.material.depthWrite = false
      }
      this.onReadyCbs.forEach((cb) => cb())
    })

    if (this.debug) {
      this.addSanityMesh()
    }

    await this.loadManifest()
  }

  dispose(): void {
    this.viewer?.dispose?.()
    this.viewer = null
    this.scene = null
    this.container = null
    this.state = 'BOOT'
  }

  async loadSplat(entryId: string): Promise<void> {
    if (!this.viewer) return
    if (this.state === 'LOADING') return
    const entry = this.manifest.find((item) => item.id === entryId)
    if (!entry) {
      this.emitError(new Error(`Entry not found: ${entryId}`))
      return
    }
    this.state = 'LOADING'
    await this.unloadCurrent()
    const url = `/splats/${entry.file}`
    await this.viewer.addSplatScene(url, {
      showLoadingUI: true,
      progressiveLoad: true,
      splatAlphaRemovalThreshold: 5,
      rotation: [1, 0, 0, 0],
      onProgress: (percent: number) => {
        this.onProgressCbs.forEach((cb) => cb(percent))
      },
    })
    this.currentEntryId = entryId
    this.splatResolveStart = performance.now()
    await this.waitForSplatObject()
    if (!this.splatMesh) {
      this.emitError(new Error('Splat object missing after load.'))
      return
    }
    this.attachSplatRenderable()
    this.frameCamera()
    this.state = 'READY'
    this.assertInvariants('loadSplat')
  }

  async unloadCurrent(): Promise<void> {
    if (!this.viewer) return
    if (this.currentEntryId) {
      await this.viewer.removeSplatScene(0, false)
      this.currentEntryId = null
    }
  }

  setCameraPose(pose: CameraPose): void {
    const camera = this.getCamera()
    if (!camera) return
    camera.position.set(...pose.position)
    this.setTarget(pose.target)
    camera.lookAt(this.target)
  }

  frameCamera(center?: THREE.Vector3, radius = 5): void {
    const camera = this.getCamera()
    if (!camera) return
    const target = center ?? new THREE.Vector3(0, 0, 0)
    this.setTarget([target.x, target.y, target.z])
    const distance = Math.max(6, radius * 2.5)
    camera.position.set(target.x, target.y, target.z + distance)
    camera.lookAt(target)
    if (this.debug) {
      console.log('Frame camera', {
        center: target.toArray(),
        radius,
        position: camera.position.toArray(),
      })
    }
  }

  setTarget(target: [number, number, number]): void {
    this.target.set(...target)
    const camera = this.getCamera()
    if (camera) camera.lookAt(this.target)
  }

  setYawOnly(_: boolean): void {}

  setQuality(profile: QualityProfile): void {
    if (!this.viewer) return
    const quality = QUALITY[profile]
    if (this.viewer.renderer) {
      this.viewer.renderer.setPixelRatio(Math.min(quality.pixelRatio, window.devicePixelRatio || 1))
    }
    const mesh = this.viewer.splatMesh as { kernel2DSize?: number } | undefined
    if (mesh && typeof mesh.kernel2DSize === 'number') {
      mesh.kernel2DSize = quality.kernel2DSize
    }
    const setSH = (this.viewer as unknown as { setActiveSphericalHarmonicsDegrees?: (value: number) => void })
      .setActiveSphericalHarmonicsDegrees
    setSH?.(quality.shDegree)
  }

  getCamera(): THREE.PerspectiveCamera | null {
    return (this.viewer?.camera as THREE.PerspectiveCamera) ?? null
  }

  getRendererDomElement(): HTMLCanvasElement | null {
    return (this.viewer?.renderer?.domElement as HTMLCanvasElement) ?? null
  }

  getTarget(): THREE.Vector3 {
    return this.target.clone()
  }

  getManifestEntries(): ManifestEntry[] {
    return this.manifest
  }

  getEntryById(id: string): ManifestEntry | undefined {
    return this.manifest.find((entry) => entry.id === id)
  }

  onProgress(cb: Callback<number>): void {
    this.onProgressCbs.push(cb)
  }

  onReady(cb: () => void): void {
    this.onReadyCbs.push(cb)
  }

  onError(cb: Callback<unknown>): void {
    this.onErrorCbs.push(cb)
  }

  tick(_dt: number): void {
    if (!this.viewer) return
    const update = (this.viewer as unknown as { update?: () => void }).update
    const render = (this.viewer as unknown as { render?: () => void }).render
    if (update && render) {
      update.call(this.viewer)
      render.call(this.viewer)
      if (this.debug && !this.renderProbeLogged) {
        this.renderProbeLogged = true
        console.log('Rendering via SPLAT_VIEWER.update/render')
      }
    } else if (this.viewer?.renderer && this.viewer?.camera && this.getCanonicalScene()) {
      this.viewer.renderer.render(this.getCanonicalScene(), this.viewer.camera)
      if (this.debug && !this.renderProbeLogged) {
        this.renderProbeLogged = true
        console.log(
          'Rendering via THREE.WebGLRenderer',
          this.getCanonicalScene()?.uuid,
          (this.viewer.camera as THREE.Camera).uuid
        )
      }
    }
    if (this.state === 'READY') {
      this.assertInvariants('tick')
    }
  }

  private async loadManifest(): Promise<void> {
    const response = await fetch('/splats/manifest.json', { cache: 'no-store' })
    if (!response.ok) {
      this.emitError(new Error(`Manifest fetch failed: ${response.status}`))
      this.state = 'ERROR'
      return
    }
    this.manifest = (await response.json()) as ManifestEntry[]
  }

  private assertInvariants(stage: string): void {
    const now = performance.now()
    if (now - this.lastInvariantLog < 500) return
    this.lastInvariantLog = now
    const mesh = this.splatMesh ?? this.resolveSplatObject()
    const canonicalScene = this.getCanonicalScene()
    if (!mesh) {
      const elapsed = performance.now() - this.splatResolveStart
      if (elapsed < 1500) {
        console.warn(`RENDER INVARIANT [${stage}]: waiting for splat object...`)
      } else {
        console.error(`RENDER INVARIANT FAILED [${stage}]: splat object missing.`)
        this.logDiagnostics()
        this.tryRecovery()
      }
      return
    }
    if (!canonicalScene) {
      console.error(`RENDER INVARIANT FAILED [${stage}]: canonical scene missing.`)
    } else if (!this.isAttachedToScene(mesh as THREE.Object3D, canonicalScene)) {
      console.error(`RENDER INVARIANT FAILED [${stage}]: splat not attached to canonical scene.`)
      this.attachSplatRenderable()
    }
    if (mesh.visible === false) {
      console.error(`RENDER INVARIANT FAILED [${stage}]: splat visibility false.`)
      mesh.visible = true
    }
    if (mesh.material && typeof mesh.material.opacity === 'number' && mesh.material.opacity <= 0) {
      console.error(`RENDER INVARIANT FAILED [${stage}]: splat opacity zero.`)
      mesh.material.opacity = 1
    }
    const camera = this.getCamera()
    if (camera) {
      const toTarget = this.target.clone().sub(camera.position)
      if (toTarget.length() < 0.01) {
        console.error(`RENDER INVARIANT FAILED [${stage}]: camera at target.`)
        this.setCameraPose(this.defaultPose)
      }
    }
    if (this.viewer?.renderer?.getContext().isContextLost()) {
      console.error(`RENDER INVARIANT FAILED [${stage}]: WebGL context lost.`)
    }
    if (this.container && this.viewer?.renderer?.domElement) {
      const attached = this.container.contains(this.viewer.renderer.domElement)
      if (!attached) {
        console.error(`RENDER INVARIANT FAILED [${stage}]: renderer DOM not attached to container.`)
      }
    }
  }

  private tryRecovery(): void {
    this.attachSplatRenderable()
    this.setCameraPose(this.defaultPose)
  }

  private resolveSplatObject(): typeof this.splatMesh {
    if (!this.viewer) return null
    const viewerAny = this.viewer as { splatMesh?: SplatMeshRef }
    if (viewerAny.splatMesh) {
      this.splatMesh = viewerAny.splatMesh
      return viewerAny.splatMesh
    }
    return null
  }

  private getCanonicalScene(): THREE.Scene | null {
    if (!this.viewer) return this.scene
    const viewerAny = this.viewer as { scene?: THREE.Scene; threeScene?: THREE.Scene }
    return viewerAny.threeScene ?? viewerAny.scene ?? this.scene
  }

  private attachSplatRenderable(): void {
    const mesh = this.resolveSplatObject()
    const scene = this.getCanonicalScene()
    if (!mesh || !scene) return
    const object = mesh as THREE.Object3D
    if (!this.isAttachedToScene(object, scene)) {
      scene.add(object)
      if (mesh.visible === false) mesh.visible = true
      if (mesh.material && typeof mesh.material.opacity === 'number' && mesh.material.opacity <= 0) {
        mesh.material.opacity = 1
      }
      object.layers.enableAll()
      const camera = this.getCamera()
      camera?.layers.enableAll()
      console.log('Attached splat renderable to canonical scene.')
      if (this.debug) {
        console.log('Renderable', object.type, object.uuid)
        this.logParentChain(object)
        console.log('Renderable visible', mesh.visible, 'position', object.position.toArray())
        console.log('Renderable scale', object.scale.toArray())
        console.log('Renderable layers', object.layers.mask, 'camera layers', camera?.layers.mask)
      }
    }
  }

  private isAttachedToScene(obj: THREE.Object3D, scene: THREE.Scene): boolean {
    let current: THREE.Object3D | null = obj
    while (current) {
      if (current === scene) return true
      current = current.parent
    }
    return false
  }

  private async waitForSplatObject(): Promise<void> {
    const start = performance.now()
    while (performance.now() - start < 1500) {
      this.resolveSplatObject()
      if (this.splatMesh) return
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }

  private logDiagnostics(): void {
    const viewerAny = this.viewer as { splatMesh?: unknown; scene?: THREE.Scene }
    const scene = this.getCanonicalScene()
    console.error('Diagnostics: viewer.splatMesh', viewerAny?.splatMesh)
    console.error('Diagnostics: scene id', scene?.uuid, 'children', scene?.children?.map((child) => child.type))
    if (this.viewer?.renderer) {
      console.error('Diagnostics: renderer', this.viewer.renderer.domElement)
    }
    const camera = this.getCamera()
    if (camera) {
      console.error('Diagnostics: camera position', camera.position.toArray())
      console.error('Diagnostics: camera target', this.target.toArray())
    }
  }

  private logParentChain(obj: THREE.Object3D): void {
    const chain: string[] = []
    let current: THREE.Object3D | null = obj
    while (current) {
      chain.push(`${current.type}:${current.uuid}`)
      current = current.parent
    }
    console.log('Renderable chain', chain.join(' -> '))
  }

  private addSanityMesh(): void {
    if (!this.scene) return
    const geometry = new THREE.BoxGeometry(1, 1, 1)
    const material = new THREE.MeshStandardMaterial({ color: 0x44aaff })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(0, 0, 0)
    this.scene.add(mesh)
    const ambient = new THREE.AmbientLight(0xffffff, 0.6)
    const directional = new THREE.DirectionalLight(0xffffff, 0.8)
    directional.position.set(2, 4, 3)
    this.scene.add(ambient, directional)
    console.log('Sanity mesh added')
  }

  private emitError(err: unknown): void {
    this.state = 'ERROR'
    this.onErrorCbs.forEach((cb) => cb(err))
  }
}
