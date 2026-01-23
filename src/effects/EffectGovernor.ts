/**
 * Effect Governor
 * Manages effect lifecycle, intensity, and conflicts.
 * Ensures splat remains visible and effects don't overwhelm.
 */

export type EffectType = 'primary' | 'secondary'

export interface ActiveEffect {
  id: string
  type: EffectType
  intensity: number // 0-1
  startTime: number
  duration?: number // Optional duration in ms
  onSuppress?: () => void // Called when effect is suppressed
}

export class EffectGovernor {
  private activeEffects: Map<string, ActiveEffect> = new Map()
  private maxPrimary = 1
  private maxSecondary = 2
  private globalIntensityCap = 0.85 // Max combined intensity
  
  // Debug
  private debugEnabled = false
  private debugCallback: ((effects: ActiveEffect[]) => void) | null = null
  
  /**
   * Register an effect. Returns true if allowed, false if suppressed.
   */
  registerEffect(effect: ActiveEffect): boolean {
    const existing = this.activeEffects.get(effect.id)
    
    // If same effect, update it
    if (existing && existing.id === effect.id) {
      this.activeEffects.set(effect.id, effect)
      this.updateDebug()
      return true
    }
    
    // Check limits
    const primaryCount = Array.from(this.activeEffects.values()).filter(e => e.type === 'primary').length
    const secondaryCount = Array.from(this.activeEffects.values()).filter(e => e.type === 'secondary').length
    
    // Suppress if limits exceeded
    if (effect.type === 'primary' && primaryCount >= this.maxPrimary) {
      // Suppress oldest primary
      const oldestPrimary = Array.from(this.activeEffects.values())
        .filter(e => e.type === 'primary')
        .sort((a, b) => a.startTime - b.startTime)[0]
      
      if (oldestPrimary) {
        this.suppressEffect(oldestPrimary.id)
      }
    }
    
    if (effect.type === 'secondary' && secondaryCount >= this.maxSecondary) {
      // Suppress oldest secondary
      const oldestSecondary = Array.from(this.activeEffects.values())
        .filter(e => e.type === 'secondary')
        .sort((a, b) => a.startTime - b.startTime)[0]
      
      if (oldestSecondary) {
        this.suppressEffect(oldestSecondary.id)
      }
    }
    
    // Check global intensity cap
    const totalIntensity = this.getTotalIntensity()
    if (totalIntensity + effect.intensity > this.globalIntensityCap) {
      // Scale down new effect
      effect.intensity = Math.max(0, this.globalIntensityCap - totalIntensity)
    }
    
    this.activeEffects.set(effect.id, effect)
    this.updateDebug()
    return true
  }
  
  /**
   * Unregister an effect.
   */
  unregisterEffect(id: string): void {
    this.activeEffects.delete(id)
    this.updateDebug()
  }
  
  /**
   * Suppress an effect (call onSuppress and remove).
   */
  suppressEffect(id: string): void {
    const effect = this.activeEffects.get(id)
    if (effect?.onSuppress) {
      effect.onSuppress()
    }
    this.activeEffects.delete(id)
    this.updateDebug()
  }
  
  /**
   * Get total intensity of all active effects.
   */
  getTotalIntensity(): number {
    return Array.from(this.activeEffects.values())
      .reduce((sum, e) => sum + e.intensity, 0)
  }
  
  /**
   * Get active effects list.
   */
  getActiveEffects(): ActiveEffect[] {
    return Array.from(this.activeEffects.values())
  }
  
  /**
   * Check if an effect is active.
   */
  isActive(id: string): boolean {
    return this.activeEffects.has(id)
  }
  
  /**
   * Update effect intensity.
   */
  updateIntensity(id: string, intensity: number): void {
    const effect = this.activeEffects.get(id)
    if (effect) {
      effect.intensity = Math.min(1, Math.max(0, intensity))
      this.updateDebug()
    }
  }
  
  /**
   * Clean up expired effects.
   */
  cleanup(): void {
    const now = performance.now()
    for (const [id, effect] of this.activeEffects.entries()) {
      if (effect.duration && now - effect.startTime >= effect.duration) {
        this.unregisterEffect(id)
      }
    }
  }
  
  /**
   * Enable/disable debug mode.
   */
  setDebug(enabled: boolean, callback?: (effects: ActiveEffect[]) => void): void {
    this.debugEnabled = enabled
    this.debugCallback = callback || null
    this.updateDebug()
  }
  
  private updateDebug(): void {
    if (this.debugEnabled && this.debugCallback) {
      this.debugCallback(this.getActiveEffects())
    }
  }
  
  /**
   * Clear all effects.
   */
  clearAll(): void {
    for (const effect of this.activeEffects.values()) {
      if (effect.onSuppress) {
        effect.onSuppress()
      }
    }
    this.activeEffects.clear()
    this.updateDebug()
  }
}
