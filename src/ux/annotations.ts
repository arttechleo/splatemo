import * as THREE from 'three'
import { AnnotationManager, type Annotation } from '../annotations/AnnotationManager'
import type { SplatEngine } from '../engine/SplatEngine'

export const createAnnotations = ({
  engine,
  container,
}: {
  engine: SplatEngine
  container: HTMLElement
}) => {
  const manager = new AnnotationManager(container)

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

  return {
    setForEntry: (entryId: string) => {
      manager.setAnnotations(annotationSets[entryId] ?? [])
    },
    update: () => {
      const camera = engine.getCamera()
      if (camera) manager.update(camera)
    },
  }
}
