/**
 * Effect Governor
 * Manages effect lifecycle, intensity, and conflicts.
 * Ensures splat remains visible and effects don't overwhelm.
 */

export type EffectType = 'primary' | 'secondary'
export type EffectPriority = 'touch' | 'time' | 'interpretive' | 'motion' | 'idle'

export interface ActiveEffect {
  id: string
  type: EffectType
  priority: EffectPriority // Priority for preemption
  intensity: number // 0-1
  startTime: number
  duration?: number // Optional duration in ms
  onSuppress?: () => void // Called when effect is suppressed
  userTriggered?: boolean // True if user explicitly triggered this
}

export class EffectGovernor {
  private activeEffects: Map<string, ActiveEffect> = new Map()
  private maxPrimary = 1
  private maxSecondary = 2
  private globalIntensityCap = 0.85 // Max combined intensity (increased in Vivid mode)
  private vividMode = false
  
  // Priority order (higher = more important)
  private readonly PRIORITY_ORDER: Record<EffectPriority, number> = {
    touch: 5,
    time: 4,
    interpretive: 3,
    motion: 2,
    idle: 1,
  }
  
  // Debug
  private debugEnabled = false
  private debugCallback: ((effects: ActiveEffect[]) => void) | null = null
  private debugLabelCallback: ((text: string) => void) | null = null
  
  /**
   * Set Vivid Mode (boosts visibility).
   */
  setVividMode(enabled: boolean): void {
    this.vividMode = enabled
    this.globalIntensityCap = enabled ? 1.25 : 0.85
  }
  
  /**
   * Get Vivid Mode state.
   */
  getVividMode(): boolean {
    return this.vividMode
  }
  
  /**
   * Get intensity multiplier for Vivid Mode.
   */
  getVividMultiplier(): number {
    return this.vividMode ? 2.0 : 1.0
  }
  
  /**
   * Register an effect. Returns true if allowed, false if suppressed.
   * Touch/time effects preempt lower priority effects.
   */
  registerEffect(effect: ActiveEffect): boolean {
    const existing = this.activeEffects.get(effect.id)
    
    // If same effect, update it
    if (existing && existing.id === effect.id) {
      this.activeEffects.set(effect.id, effect)
      this.updateDebug()
      this.updateDebugLabel()
      return true
    }
    
    // User-triggered effects (touch/time) must not be suppressed
    if (effect.userTriggered) {
      // Suppress lower priority effects to make room
      this.makeRoomForEffect(effect)
    }
    
    // Check limits
    const primaryCount = Array.from(this.activeEffects.values()).filter(e => e.type === 'primary').length
    const secondaryCount = Array.from(this.activeEffects.values()).filter(e => e.type === 'secondary').length
    
    // Suppress if limits exceeded (but protect user-triggered effects)
    if (effect.type === 'primary' && primaryCount >= this.maxPrimary) {
      // Find suppressible primary (not user-triggered, lower priority)
      const suppressible = Array.from(this.activeEffects.values())
        .filter(e => e.type === 'primary' && !e.userTriggered && 
          this.PRIORITY_ORDER[e.priority] < this.PRIORITY_ORDER[effect.priority])
        .sort((a, b) => a.startTime - b.startTime)[0]
      
      if (suppressible) {
        this.suppressEffect(suppressible.id)
      } else if (!effect.userTriggered) {
        // If new effect is not user-triggered, suppress oldest
        const oldestPrimary = Array.from(this.activeEffects.values())
          .filter(e => e.type === 'primary')
          .sort((a, b) => a.startTime - b.startTime)[0]
        if (oldestPrimary) {
          this.suppressEffect(oldestPrimary.id)
        }
      }
    }
    
    if (effect.type === 'secondary' && secondaryCount >= this.maxSecondary) {
      // Find suppressible secondary
      const suppressible = Array.from(this.activeEffects.values())
        .filter(e => e.type === 'secondary' && !e.userTriggered &&
          this.PRIORITY_ORDER[e.priority] < this.PRIORITY_ORDER[effect.priority])
        .sort((a, b) => a.startTime - b.startTime)[0]
      
      if (suppressible) {
        this.suppressEffect(suppressible.id)
      } else if (!effect.userTriggered) {
        const oldestSecondary = Array.from(this.activeEffects.values())
          .filter(e => e.type === 'secondary')
          .sort((a, b) => a.startTime - b.startTime)[0]
        if (oldestSecondary) {
          this.suppressEffect(oldestSecondary.id)
        }
      }
    }
    
    // Check global intensity cap
    const totalIntensity = this.getTotalIntensity()
    const cap = this.globalIntensityCap
    if (totalIntensity + effect.intensity > cap) {
      // Scale down lower priority effects first
      if (!effect.userTriggered) {
        // Scale down new effect if not user-triggered
        effect.intensity = Math.max(0, cap - totalIntensity)
      } else {
        // Scale down existing lower priority effects
        for (const existing of this.activeEffects.values()) {
          if (!existing.userTriggered && 
              this.PRIORITY_ORDER[existing.priority] < this.PRIORITY_ORDER[effect.priority]) {
            existing.intensity *= 0.7
          }
        }
      }
    }
    
    this.activeEffects.set(effect.id, effect)
    this.updateDebug()
    this.updateDebugLabel()
    return true
  }
  
  /**
   * Make room for a high-priority effect by suppressing lower priority ones.
   */
  private makeRoomForEffect(effect: ActiveEffect): void {
    const effectPriority = this.PRIORITY_ORDER[effect.priority]
    
    // Suppress lower priority effects
    for (const existing of Array.from(this.activeEffects.values())) {
      if (this.PRIORITY_ORDER[existing.priority] < effectPriority && !existing.userTriggered) {
        this.suppressEffect(existing.id)
      }
    }
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
  setDebug(enabled: boolean, callback?: (effects: ActiveEffect[]) => void, labelCallback?: (text: string) => void): void {
    this.debugEnabled = enabled
    this.debugCallback = callback || null
    this.debugLabelCallback = labelCallback || null
    this.updateDebug()
    this.updateDebugLabel()
  }
  
  private updateDebugLabel(): void {
    if (!this.debugEnabled || !this.debugLabelCallback) return
    
    const effects = this.getActiveEffects()
    if (effects.length === 0) {
      this.debugLabelCallback('')
      return
    }
    
    // Show primary effect first
    const primary = effects.find(e => e.type === 'primary')
    const secondary = effects.filter(e => e.type === 'secondary')
    
    let label = ''
    if (primary) {
      label = `Active: ${primary.id} (primary)`
    }
    if (secondary.length > 0 && label) {
      label += `, ${secondary.length} secondary`
    } else if (secondary.length > 0) {
      label = `Active: ${secondary[0].id} (secondary)`
    }
    
    this.debugLabelCallback(label)
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
