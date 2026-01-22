import * as THREE from 'three'

export type Annotation = {
  id: string
  label: string
  body: string
  position: THREE.Vector3
}

export class AnnotationManager {
  private container: HTMLElement
  private annotations: Annotation[] = []
  private nodes = new Map<string, HTMLButtonElement>()

  constructor(container: HTMLElement) {
    this.container = container
  }

  setAnnotations(annotations: Annotation[]) {
    this.annotations = annotations
    this.render()
  }

  private render() {
    this.container.innerHTML = ''
    this.nodes.clear()
    this.annotations.forEach((annotation) => {
      const button = document.createElement('button')
      button.className = 'annotation'
      button.type = 'button'
      button.innerHTML = `
        <span class="annotation__label">${annotation.label}</span>
        <span class="annotation__body">${annotation.body}</span>
      `
      button.addEventListener('click', () => {
        button.classList.toggle('annotation--expanded')
        console.log('Annotation toggle', annotation.id, button.classList.contains('annotation--expanded'))
      })
      this.container.appendChild(button)
      this.nodes.set(annotation.id, button)
    })
  }

  update(camera: THREE.PerspectiveCamera) {
    const forward = new THREE.Vector3()
    camera.getWorldDirection(forward)

    this.annotations.forEach((annotation) => {
      const node = this.nodes.get(annotation.id)
      if (!node) return

      const screen = annotation.position.clone().project(camera)
      const isBehind = screen.z > 1 || screen.z < -1
      const toPoint = annotation.position.clone().sub(camera.position).normalize()
      const facing = forward.dot(toPoint)
      const visible = !isBehind && facing > 0.1

      node.style.opacity = visible ? '1' : '0'
      node.style.pointerEvents = visible ? 'auto' : 'none'

      const x = (screen.x * 0.5 + 0.5) * 100
      const y = (-screen.y * 0.5 + 0.5) * 100
      node.style.transform = `translate(-50%, -50%) translate(${x}vw, ${y}vh)`
    })
  }
}
