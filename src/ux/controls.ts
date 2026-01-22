import * as THREE from 'three'
import { createOrbitController } from '../controls/orbitControls'
import type { SplatEngine } from '../engine/SplatEngine'

export const createControls = ({
  engine,
  debug = false,
}: {
  engine: SplatEngine
  debug?: boolean
}) => {
  const camera = engine.getCamera()
  const domElement = engine.getRendererDomElement()
  if (!camera || !domElement) {
    throw new Error('Controls could not access camera or renderer element.')
  }
  const target = engine.getTarget()
  const controller = createOrbitController({
    camera,
    domElement,
    target,
    options: {
      rotateSpeed: 0.005,
      damping: 0,
      allowLeftButton: true,
      debug,
    },
  })

  return {
    update: (dt: number) => controller.update(dt),
    setEnabled: (value: boolean) => controller.setEnabled(value),
    setTarget: (value: THREE.Vector3) => controller.setTarget(value),
    setRadius: (value: number) => controller.setRadius(value),
    getState: () => controller.getState(),
    dispose: () => controller.dispose(),
  }
}
