/**
 * Exploration Lab
 * Hidden Debug/Lab toggle panel for testing individual features.
 * Accessible via keyboard shortcut or secret gesture.
 */

export interface LabConfig {
  // Phase 1 - Feed & Navigation
  ghostPreview: boolean
  scaleInAnimation: boolean
  tapFocus: boolean
  doubleTapLike: boolean
  
  // Phase 2 - Interaction Rewards
  rippleBurst: boolean
  revealSpotlight: boolean
  depthScrubbing: boolean
  memoryEchoes: boolean
  
  // Phase 3 - Subtle Magic
  breathingPresence: boolean
  rarePulse: boolean
  gyroGravityBias: boolean
}

export class ExplorationLab {
  private panel: HTMLElement | null = null
  private isVisible = false
  private config: LabConfig = {
    ghostPreview: true,
    scaleInAnimation: true,
    tapFocus: true,
    doubleTapLike: true,
    rippleBurst: false, // OFF by default - clean demo
    revealSpotlight: false, // OFF by default - clean demo
    depthScrubbing: false, // OFF by default - clean demo
    memoryEchoes: false, // OFF by default - clean demo
    breathingPresence: false, // OFF by default - clean demo
    rarePulse: false, // OFF by default - clean demo
    gyroGravityBias: false, // OFF by default - clean demo
  }
  
  private configChangeCallbacks: Array<(config: LabConfig) => void> = []
  
  constructor() {
    this.createPanel()
    this.setupKeyboardToggle()
  }
  
  private createPanel(): void {
    this.panel = document.createElement('div')
    this.panel.className = 'exploration-lab'
    this.panel.style.position = 'fixed'
    this.panel.style.top = '50%'
    this.panel.style.left = '50%'
    this.panel.style.transform = 'translate(-50%, -50%)'
    this.panel.style.width = '90%'
    this.panel.style.maxWidth = '400px'
    this.panel.style.maxHeight = '80vh'
    this.panel.style.background = 'rgba(20, 20, 25, 0.95)'
    this.panel.style.backdropFilter = 'blur(24px)'
    this.panel.style.border = '1px solid rgba(255, 255, 255, 0.18)'
    this.panel.style.borderRadius = '16px'
    this.panel.style.padding = '24px'
    this.panel.style.zIndex = '1000'
    this.panel.style.display = 'none'
    this.panel.style.overflowY = 'auto'
    this.panel.style.color = 'rgba(255, 255, 255, 0.95)'
    this.panel.style.fontFamily = 'var(--font-family)'
    this.panel.style.fontSize = '14px'
    this.panel.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.6)'
    
    this.updatePanelContent()
    document.body.appendChild(this.panel)
  }
  
  private updatePanelContent(): void {
    if (!this.panel) return
    
    this.panel.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <h3 style="margin: 0; font-size: 18px; font-weight: 600;">Exploration Lab</h3>
        <button id="lab-close" style="background: transparent; border: none; color: rgba(255, 255, 255, 0.7); font-size: 24px; cursor: pointer; padding: 0; width: 32px; height: 32px;">×</button>
      </div>
      
      <div style="margin-bottom: 24px;">
        <h4 style="margin: 0 0 12px 0; font-size: 14px; font-weight: 600; color: rgba(255, 255, 255, 0.9);">Phase 1: Feed & Navigation</h4>
        ${this.createToggle('ghostPreview', 'Ghost Preview')}
        ${this.createToggle('scaleInAnimation', 'Scale-In Animation')}
        ${this.createToggle('tapFocus', 'Tap = Focus')}
        ${this.createToggle('doubleTapLike', 'Double Tap = Like')}
      </div>
      
      <div style="margin-bottom: 24px;">
        <h4 style="margin: 0 0 12px 0; font-size: 14px; font-weight: 600; color: rgba(255, 255, 255, 0.9);">Phase 2: Interaction Rewards</h4>
        ${this.createToggle('rippleBurst', 'Ripple Burst')}
        ${this.createToggle('revealSpotlight', 'Reveal Spotlight')}
        ${this.createToggle('depthScrubbing', 'Depth Scrubbing')}
        ${this.createToggle('memoryEchoes', 'Memory Echoes')}
      </div>
      
      <div>
        <h4 style="margin: 0 0 12px 0; font-size: 14px; font-weight: 600; color: rgba(255, 255, 255, 0.9);">Phase 3: Subtle Magic</h4>
        ${this.createToggle('breathingPresence', 'Breathing Presence')}
        ${this.createToggle('rarePulse', 'Rare Pulse')}
        ${this.createToggle('gyroGravityBias', 'Gyro Gravity Bias')}
      </div>
    `
    
    // Wire up close button
    const closeButton = this.panel.querySelector<HTMLButtonElement>('#lab-close')
    if (closeButton) {
      closeButton.addEventListener('click', () => {
        this.hide()
      })
    }
    
    // Wire up toggles
    Object.keys(this.config).forEach(key => {
      const toggle = this.panel?.querySelector<HTMLInputElement>(`#lab-toggle-${key}`)
      if (toggle) {
        toggle.addEventListener('change', () => {
          (this.config as any)[key] = toggle.checked
          this.notifyConfigChange()
        })
      }
    })
  }
  
  private createToggle(key: keyof LabConfig, label: string): string {
    const checked = this.config[key] ? 'checked' : ''
    return `
      <label style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; cursor: pointer;">
        <span>${label}</span>
        <input type="checkbox" id="lab-toggle-${key}" ${checked} style="cursor: pointer;">
      </label>
    `
  }
  
  private setupKeyboardToggle(): void {
    // Toggle with 'L' key (Lab)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'l' || e.key === 'L') {
        if (e.target && (e.target as HTMLElement).tagName === 'INPUT') {
          return // Don't toggle when typing in inputs
        }
        this.toggle()
      }
    })
  }
  
  toggle(): void {
    if (this.isVisible) {
      this.hide()
    } else {
      this.show()
    }
  }
  
  show(): void {
    if (!this.panel) return
    this.isVisible = true
    this.panel.style.display = 'block'
    this.updatePanelContent() // Refresh to show current state
  }
  
  hide(): void {
    if (!this.panel) return
    this.isVisible = false
    this.panel.style.display = 'none'
  }
  
  getConfig(): LabConfig {
    return { ...this.config }
  }
  
  setConfig(config: Partial<LabConfig>): void {
    Object.assign(this.config, config)
    this.updatePanelContent()
    this.notifyConfigChange()
  }
  
  onConfigChange(callback: (config: LabConfig) => void): void {
    this.configChangeCallbacks.push(callback)
  }
  
  private notifyConfigChange(): void {
    this.configChangeCallbacks.forEach(cb => cb(this.getConfig()))
  }
  
  destroy(): void {
    if (this.panel && this.panel.parentNode) {
      this.panel.parentNode.removeChild(this.panel)
    }
    this.panel = null
  }
}
