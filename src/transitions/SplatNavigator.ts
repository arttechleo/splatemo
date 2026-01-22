import type { SplatManager } from '../splats/SplatManager'
import type { SplatParticles } from './SplatParticles'

import * as THREE from 'three'

type SplatMeshLike = {
  getSplatCount: () => number
  getSplatCenter: (index: number, out: THREE.Vector3) => void
}

type NavigatorOptions = {
  duration: number
  getSplatMesh: () => SplatMeshLike | null
  onTransitionStart?: () => void
  onTransitionEnd?: () => void
}

export class SplatNavigator {
  private manager: SplatManager
  private particles: SplatParticles
  private options: NavigatorOptions
  private isTransitioning = false
  private touchStartY = 0

  constructor(manager: SplatManager, particles: SplatParticles, options: NavigatorOptions) {
    this.manager = manager
    this.particles = particles
    this.options = options
  }

  attach(target: HTMLElement) {
    target.addEventListener('wheel', this.onWheel, { passive: true })
    target.addEventListener('touchstart', this.onTouchStart, { passive: true })
    target.addEventListener('touchend', this.onTouchEnd, { passive: true })
  }

  private onWheel = (event: WheelEvent) => {
    if (this.isTransitioning) return
    if (Math.abs(event.deltaY) < 40) return
    const direction = event.deltaY > 0 ? 'next' : 'prev'
    void this.triggerTransition(direction)
  }

  private onTouchStart = (event: TouchEvent) => {
    if (event.touches.length === 1) {
      this.touchStartY = event.touches[0].clientY
    }
  }

  private onTouchEnd = (event: TouchEvent) => {
    if (this.isTransitioning || event.changedTouches.length === 0) return
    const deltaY = this.touchStartY - event.changedTouches[0].clientY
    if (Math.abs(deltaY) < 50) return
    const direction = deltaY > 0 ? 'next' : 'prev'
    void this.triggerTransition(direction)
  }

  private async triggerTransition(direction: 'next' | 'prev') {
    if (this.isTransitioning) return
    if (this.manager.getEntries().length < 2) return
    this.isTransitioning = true
    this.options.onTransitionStart?.()

    const currentIndex = this.manager.getEntries().indexOf(this.manager.getCurrentEntry())
    const nextIndex =
      direction === 'next'
        ? (currentIndex + 1) % this.manager.getEntries().length
        : (currentIndex - 1 + this.manager.getEntries().length) %
          this.manager.getEntries().length

    const splatMesh = this.options.getSplatMesh()
    if (splatMesh) {
      this.particles.startFromSplat(
        splatMesh,
        direction === 'next' ? 'up' : 'down',
        this.options.duration
      )
    }

    await this.manager.transitionTo(nextIndex)

    this.options.onTransitionEnd?.()
    this.isTransitioning = false
  }
}
