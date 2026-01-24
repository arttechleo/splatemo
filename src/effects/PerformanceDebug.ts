/**
 * Performance Debug
 * Lightweight optional debug readout showing FPS, quality tier, and effect costs.
 * Must not be on by default.
 */

import type { QualityTier } from './OverlayCompositor'

export interface PerformanceDebugData {
  fps: number
  frameTime: number
  qualityTier: QualityTier
  activeEffects: Array<{
    name: string
    particleCount?: number
    overlayDPR?: number
    updateRate?: number
  }>
}

export class PerformanceDebug {
  private container: HTMLElement | null = null
  private debugPanel: HTMLDivElement | null = null
  private isVisible = false
  private updateInterval: ReturnType<typeof setInterval> | null = null
  
  constructor(container: HTMLElement) {
    this.container = container
    this.createPanel()
  }
  
  private createPanel(): void {
    if (!this.container) return
    
    this.debugPanel = document.createElement('div')
    this.debugPanel.className = 'performance-debug'
    this.debugPanel.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      background: rgba(0, 0, 0, 0.8);
      color: #0f0;
      font-family: monospace;
      font-size: 11px;
      padding: 8px 12px;
      border-radius: 4px;
      z-index: 10000;
      pointer-events: none;
      display: none;
      line-height: 1.4;
    `
    this.container.appendChild(this.debugPanel)
  }
  
  /**
   * Toggle debug panel visibility.
   */
  toggle(): void {
    this.isVisible = !this.isVisible
    if (!this.debugPanel) return
    
    this.debugPanel.style.display = this.isVisible ? 'block' : 'none'
    
    if (this.isVisible && !this.updateInterval) {
      this.startUpdates()
    } else if (!this.isVisible && this.updateInterval) {
      this.stopUpdates()
    }
  }
  
  /**
   * Update debug readout with current performance data.
   */
  update(data: PerformanceDebugData): void {
    if (!this.debugPanel || !this.isVisible) return
    
    const fpsColor = data.fps >= 30 ? '#0f0' : data.fps >= 20 ? '#ff0' : '#f00'
    const tierColor = data.qualityTier === 'HIGH' ? '#0f0' : data.qualityTier === 'MED' ? '#ff0' : '#f00'
    
    let html = `<div style="margin-bottom: 4px;"><strong>Performance Debug</strong></div>`
    html += `<div>FPS: <span style="color: ${fpsColor}">${data.fps.toFixed(1)}</span></div>`
    html += `<div>Frame Time: ${data.frameTime.toFixed(2)}ms</div>`
    html += `<div>Quality: <span style="color: ${tierColor}">${data.qualityTier}</span></div>`
    
    if (data.activeEffects.length > 0) {
      html += `<div style="margin-top: 6px; border-top: 1px solid #333; padding-top: 4px;"><strong>Effects:</strong></div>`
      for (const effect of data.activeEffects) {
        html += `<div style="margin-left: 8px;">• ${effect.name}`
        if (effect.particleCount !== undefined) {
          html += ` (${effect.particleCount} particles)`
        }
        if (effect.overlayDPR !== undefined) {
          html += ` (DPR: ${effect.overlayDPR.toFixed(2)})`
        }
        if (effect.updateRate !== undefined) {
          html += ` (${effect.updateRate.toFixed(1)}fps)`
        }
        html += `</div>`
      }
    }
    
    this.debugPanel.innerHTML = html
  }
  
  private startUpdates(): void {
    // Updates will be called externally via update() method
    // This is just a placeholder for future auto-update if needed
    void this.debugPanel // Suppress unused warning
  }
  
  private stopUpdates(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval)
      this.updateInterval = null
    }
  }
  
  /**
   * Destroy debug panel.
   */
  destroy(): void {
    this.stopUpdates()
    if (this.debugPanel && this.debugPanel.parentNode) {
      this.debugPanel.parentNode.removeChild(this.debugPanel)
    }
    this.debugPanel = null
  }
}
