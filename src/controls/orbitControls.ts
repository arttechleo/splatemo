import * as THREE from 'three'

type OrbitOptions = {
  rotateSpeed?: number
  damping?: number
  minPolarAngle?: number
  maxPolarAngle?: number
  allowLeftButton?: boolean
  minRadius?: number
  maxRadius?: number
  debug?: boolean
}

type OrbitState = {
  yaw: number
  pitch: number
  radius: number
  target: THREE.Vector3
  enabled: boolean
  dragging: boolean
}

export const createOrbitController = ({
  camera,
  domElement,
  target,
  options = {},
}: {
  camera: THREE.PerspectiveCamera
  domElement: HTMLElement
  target: THREE.Vector3
  options?: OrbitOptions
}) => {
  const rotateSpeed = options.rotateSpeed ?? 0.005
  const damping = options.damping ?? 0
  const minPolarAngle = options.minPolarAngle ?? 0.1
  const maxPolarAngle = options.maxPolarAngle ?? Math.PI - 0.1
  const minRadius = options.minRadius ?? 0.5
  const maxRadius = options.maxRadius ?? 50
  const allowLeftButton = options.allowLeftButton ?? false
  const debug = options.debug ?? false

  let enabled = true
  let dragging = false
  let activePointerId: number | null = null
  let lastX = 0
  let lastY = 0
  let yaw = 0
  let pitch = 0
  let radius = 1
  let velocityYaw = 0
  let velocityPitch = 0
  let lastLog = 0

  const updateFromCamera = () => {
    const offset = camera.position.clone().sub(target)
    radius = THREE.MathUtils.clamp(offset.length(), minRadius, maxRadius)
    const normalized = offset.normalize()
    yaw = Math.atan2(normalized.x, normalized.z)
    pitch = Math.asin(THREE.MathUtils.clamp(normalized.y, -1, 1))
    pitch = THREE.MathUtils.clamp(pitch, minPolarAngle - Math.PI / 2, Math.PI / 2 - (Math.PI - maxPolarAngle))
  }

  const applyCamera = () => {
    const cosPitch = Math.cos(pitch)
    const sinPitch = Math.sin(pitch)
    const cosYaw = Math.cos(yaw)
    const sinYaw = Math.sin(yaw)
    const x = radius * cosPitch * sinYaw
    const y = radius * sinPitch
    const z = radius * cosPitch * cosYaw
    camera.position.set(target.x + x, target.y + y, target.z + z)
    camera.lookAt(target)
  }

  updateFromCamera()
  applyCamera()

  const stopDrag = (reason: string) => {
    if (!dragging) return
    dragging = false
    activePointerId = null
    velocityYaw = 0
    velocityPitch = 0
    if (debug) console.log('Orbit drag end', reason)
  }

  const startDrag = (event: PointerEvent) => {
    if (!enabled) return
    if (event.pointerType === 'mouse') {
      if (event.button === 2) {
        // RMB rotate
      } else if (event.button === 0 && allowLeftButton) {
        // LMB rotate
      } else {
        return
      }
    }
    dragging = true
    activePointerId = event.pointerId
    lastX = event.clientX
    lastY = event.clientY
    if (debug) console.log('Orbit drag start', event.pointerId, event.button)
  }

  const onPointerDown = (event: PointerEvent) => {
    startDrag(event)
    if (dragging) {
      event.preventDefault()
    }
  }

  const onPointerMove = (event: PointerEvent) => {
    if (!enabled || !dragging) return
    if (event.pointerId !== activePointerId) return
    if (event.buttons === 0 && event.pointerType === 'mouse') {
      stopDrag('buttons=0')
      return
    }
    const dx = event.clientX - lastX
    const dy = event.clientY - lastY
    lastX = event.clientX
    lastY = event.clientY
    velocityYaw = -dx * rotateSpeed
    velocityPitch = -dy * rotateSpeed
    yaw += velocityYaw
    pitch += velocityPitch
    pitch = THREE.MathUtils.clamp(pitch, minPolarAngle - Math.PI / 2, Math.PI / 2 - (Math.PI - maxPolarAngle))
    applyCamera()
    if (debug) {
      const now = performance.now()
      if (now - lastLog > 200) {
        lastLog = now
        console.log('Orbit state', yaw.toFixed(3), pitch.toFixed(3), radius.toFixed(2))
      }
    }
  }

  const onPointerUp = (event: PointerEvent) => {
    if (event.pointerId !== activePointerId) return
    stopDrag('pointerup')
  }

  const onPointerCancel = (event: PointerEvent) => {
    if (event.pointerId !== activePointerId) return
    stopDrag('pointercancel')
  }

  const onContextMenu = (event: MouseEvent) => {
    if (dragging) {
      event.preventDefault()
      stopDrag('contextmenu')
    }
  }

  const onMouseLeave = () => {
    stopDrag('mouseleave')
  }

  const onWindowBlur = () => {
    stopDrag('blur')
  }

  domElement.addEventListener('pointerdown', onPointerDown)
  domElement.addEventListener('pointermove', onPointerMove)
  domElement.addEventListener('pointerup', onPointerUp)
  domElement.addEventListener('pointercancel', onPointerCancel)
  domElement.addEventListener('contextmenu', onContextMenu)
  domElement.addEventListener('mouseleave', onMouseLeave)
  window.addEventListener('blur', onWindowBlur)
  window.addEventListener('pointerup', onPointerUp)

  const update = (dt: number) => {
    if (!enabled) return
    if (dragging || damping === 0) return
    if (Math.abs(velocityYaw) < 0.00001 && Math.abs(velocityPitch) < 0.00001) return
    velocityYaw *= Math.pow(1 - damping, dt * 60)
    velocityPitch *= Math.pow(1 - damping, dt * 60)
    yaw += velocityYaw
    pitch += velocityPitch
    pitch = THREE.MathUtils.clamp(pitch, minPolarAngle - Math.PI / 2, Math.PI / 2 - (Math.PI - maxPolarAngle))
    applyCamera()
  }

  const dispose = () => {
    domElement.removeEventListener('pointerdown', onPointerDown)
    domElement.removeEventListener('pointermove', onPointerMove)
    domElement.removeEventListener('pointerup', onPointerUp)
    domElement.removeEventListener('pointercancel', onPointerCancel)
    domElement.removeEventListener('contextmenu', onContextMenu)
    domElement.removeEventListener('mouseleave', onMouseLeave)
    window.removeEventListener('blur', onWindowBlur)
    window.removeEventListener('pointerup', onPointerUp)
  }

  const setEnabled = (value: boolean) => {
    enabled = value
    if (!enabled) stopDrag('disabled')
  }

  const setTarget = (value: THREE.Vector3) => {
    target.copy(value)
    updateFromCamera()
    applyCamera()
  }

  const setRadius = (value: number) => {
    radius = THREE.MathUtils.clamp(value, minRadius, maxRadius)
    applyCamera()
  }

  const getState = (): OrbitState => ({
    yaw,
    pitch,
    radius,
    target: target.clone(),
    enabled,
    dragging,
  })

  return { update, dispose, setEnabled, setTarget, setRadius, getState }
}
