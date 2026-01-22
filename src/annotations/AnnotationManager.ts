import * as THREE from 'three'

export type Annotation = {
  id: string
  title: string
  body: string
  position: THREE.Vector3
  minAngle?: number
  maxAngle?: number
}

type ViewerLike = {
  camera?: THREE.PerspectiveCamera
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

export class AnnotationManager {
  private viewer: ViewerLike
  private container: HTMLElement
  private annotations: Annotation[]
  private elements = new Map<string, HTMLButtonElement>()

  constructor(viewer: ViewerLike, container: HTMLElement, annotations: Annotation[]) {
    this.viewer = viewer
    this.container = container
    this.annotations = annotations
    this.render()
  }

  render() {
    this.container.innerHTML = ''
    this.elements.clear()
    this.annotations.forEach((annotation) => {
      const button = document.createElement('button')
      button.className = 'annotation'
      button.type = 'button'
      button.innerHTML = `
        <span class="annotation__title">${annotation.title}</span>
        <span class="annotation__body">${annotation.body}</span>
      `
      button.addEventListener('click', () => {
        button.classList.toggle('annotation--expanded')
      })
      this.container.appendChild(button)
      this.elements.set(annotation.id, button)
    })
  }

  update() {
    const camera = this.viewer.camera
    if (!camera) return
    const forward = new THREE.Vector3()
    camera.getWorldDirection(forward)

    this.annotations.forEach((annotation) => {
      const element = this.elements.get(annotation.id)
      if (!element) return

      const screenPosition = annotation.position.clone().project(camera)
      const isBehind = screenPosition.z > 1 || screenPosition.z < -1
      const toAnnotation = annotation.position.clone().sub(camera.position).normalize()
      const angle = Math.acos(clamp(forward.dot(toAnnotation), -1, 1))

      const minAngle = annotation.minAngle ?? 0
      const maxAngle = annotation.maxAngle ?? Math.PI * 0.75
      const withinAngle = angle >= minAngle && angle <= maxAngle
      const visible = !isBehind && withinAngle

      element.style.opacity = visible ? '1' : '0'
      element.style.pointerEvents = visible ? 'auto' : 'none'

      const x = (screenPosition.x * 0.5 + 0.5) * 100
      const y = (-screenPosition.y * 0.5 + 0.5) * 100
      element.style.transform = `translate(-50%, -50%) translate(${x}vw, ${y}vh)`
    })
  }
}
