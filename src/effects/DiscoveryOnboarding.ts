/**
 * Discovery Onboarding
 * One-time overlay tips to help users discover effects.
 * Small glass chips, dismiss on first interaction.
 */

export class DiscoveryOnboarding {
  private container: HTMLElement | null = null
  private hasShown = false
  private hasDismissed = false
  private tips: Array<{ id: string; text: string; show: boolean }> = []
  
  constructor() {
    this.init()
    this.checkLocalStorage()
  }
  
  private init(): void {
    // Check if gyro is supported
    const hasGyro = !!(window.DeviceOrientationEvent || window.DeviceMotionEvent)
    
    this.tips = [
      { id: 'tap', text: 'Tap: Ripple', show: true },
      { id: 'hold', text: 'Hold: Spotlight', show: true },
      { id: 'tilt', text: 'Tilt: Gravity', show: hasGyro },
    ]
  }
  
  private checkLocalStorage(): void {
    try {
      const shown = localStorage.getItem('discovery-onboarding-shown')
      this.hasShown = shown === 'true'
    } catch {
      // localStorage not available
    }
  }
  
  show(): void {
    if (this.hasShown || this.hasDismissed) return
    
    this.createOverlay()
    this.hasShown = true
    
    try {
      localStorage.setItem('discovery-onboarding-shown', 'true')
    } catch {
      // localStorage not available
    }
    
    // Auto-dismiss after 5 seconds
    setTimeout(() => {
      this.dismiss()
    }, 5000)
    
    // Dismiss on first interaction
    const dismissOnInteraction = () => {
      this.dismiss()
      document.removeEventListener('mousedown', dismissOnInteraction)
      document.removeEventListener('touchstart', dismissOnInteraction)
      document.removeEventListener('keydown', dismissOnInteraction)
    }
    
    document.addEventListener('mousedown', dismissOnInteraction, { once: true })
    document.addEventListener('touchstart', dismissOnInteraction, { once: true })
    document.addEventListener('keydown', dismissOnInteraction, { once: true })
  }
  
  private createOverlay(): void {
    this.container = document.createElement('div')
    this.container.className = 'discovery-onboarding'
    this.container.style.position = 'fixed'
    this.container.style.top = '0'
    this.container.style.left = '0'
    this.container.style.width = '100%'
    this.container.style.height = '100%'
    this.container.style.pointerEvents = 'none'
    this.container.style.zIndex = '20'
    document.body.appendChild(this.container)
    
    // Create tips
    const visibleTips = this.tips.filter(t => t.show)
    const tipSpacing = 100 / (visibleTips.length + 1)
    
    visibleTips.forEach((tip, index) => {
      const tipEl = document.createElement('div')
      tipEl.className = 'discovery-onboarding__tip'
      tipEl.textContent = tip.text
      tipEl.style.position = 'absolute'
      tipEl.style.top = `${20 + index * tipSpacing}%`
      tipEl.style.left = '50%'
      tipEl.style.transform = 'translateX(-50%)'
      tipEl.style.background = 'rgba(20, 20, 25, 0.85)'
      tipEl.style.backdropFilter = 'blur(24px)'
      tipEl.style.border = '1px solid rgba(255, 255, 255, 0.18)'
      tipEl.style.borderRadius = '12px'
      tipEl.style.padding = '12px 20px'
      tipEl.style.color = 'rgba(255, 255, 255, 0.95)'
      tipEl.style.fontSize = '14px'
      tipEl.style.fontWeight = '500'
      tipEl.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.4), 0 0 20px rgba(255, 255, 255, 0.1)'
      tipEl.style.opacity = '0'
      tipEl.style.transition = 'opacity 0.3s ease'
      
      this.container!.appendChild(tipEl)
      
      // Fade in
      setTimeout(() => {
        tipEl.style.opacity = '1'
      }, index * 200)
    })
  }
  
  private dismiss(): void {
    if (this.hasDismissed || !this.container) return
    
    this.hasDismissed = true
    
    // Fade out
    if (this.container) {
      this.container.style.transition = 'opacity 0.3s ease'
      this.container.style.opacity = '0'
      
      setTimeout(() => {
        if (this.container && this.container.parentNode) {
          this.container.parentNode.removeChild(this.container)
        }
        this.container = null
      }, 300)
    }
  }
  
  destroy(): void {
    this.dismiss()
  }
}
