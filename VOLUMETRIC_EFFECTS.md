# Volumetric Effects Playground

## Overview

8 new experimental effects that manipulate splat perception through depth-based modulation, opacity accumulation, temporal oscillation, and grouped selection. All effects are overlay-only, safe, and designed to feel cinematic, perceptual, and volumetric.

---

## Effect Catalog

### 1. **Depth Pulse** (Breathing Presence)
**What it feels like:** The splat gently breathes, as if it has internal pressure that expands and contracts.

**Mechanism:** Samples depth from rendered canvas, modulates opacity of depth bands in a slow sine wave. Creates a meditative, living presence.

**Parameters:**
- `intensity` (0-1): Overall effect strength (default: 0.4)
- `breathRate` (0.3-0.8): Cycles per second (default: 0.5 - slow, meditative)
- `depthBandCount` (3-6): Number of depth bands (default: 4)
- `opacityRange` (0-1): How much opacity varies (default: 0.15 - subtle)

**Performance:** Throttled sampling (10fps), mobile-safe particle caps, DPR capped at 1.5

**Status:** Presentable - subtle, premium feel

---

### 2. **Volumetric Drift** (Slow Depth Oscillation)
**What it feels like:** Different depth layers slowly drift apart and together, like a living volume.

**Mechanism:** Samples depth bands, applies slow horizontal/vertical oscillation to each band. Each band has independent phase for organic motion.

**Parameters:**
- `intensity` (0-1): Overall effect strength (default: 0.3)
- `driftSpeed` (0.1-0.5): Speed of drift (default: 0.2 - slow, meditative)
- `bandCount` (3-5): Number of drift bands (default: 3)
- `maxDisplacement` (pixels): Maximum drift distance (default: 12px)

**Performance:** Throttled updates (8fps), mobile DPR cap (1.5), soft wisps (not dots)

**Status:** Presentable - subtle volumetric motion

---

### 3. **Opacity Accumulation** (Depth Layer Build-up)
**What it feels like:** Depth layers gradually accumulate opacity, as if the splat is materializing from within.

**Mechanism:** Samples depth bands, gradually increases opacity overlay for each band over time. Random target opacities create organic, unpredictable build-up.

**Parameters:**
- `intensity` (0-1): Overall effect strength (default: 0.5)
- `accumulationRate` (0.1-0.5): How fast opacity builds (default: 0.2)
- `bandCount` (4-6): Number of accumulation bands (default: 5)
- `maxOpacity` (0-1): Maximum opacity per band (default: 0.12 - subtle)

**Performance:** Throttled sampling (6fps), mobile-safe, lightweight gradients

**Status:** Experimental - may need tuning for visibility

---

### 4. **Covariance Stretch** (Simulated Anisotropic Deformation)
**What it feels like:** The splat appears to stretch and flatten along certain axes, like viewing through a lens.

**Mechanism:** Applies canvas transform to simulate covariance stretching (overlay-only). Oscillates stretch amount for dynamic feel.

**Parameters:**
- `intensity` (0-1): Overall effect strength (default: 0.4)
- `stretchAxis` (0-360): Direction of stretch in degrees (default: 45 - diagonal)
- `stretchAmount` (1.0-1.5): How much to stretch (default: 1.2)
- `oscillationSpeed` (0.1-0.5): Speed of oscillation (default: 0.3)

**Performance:** Full-rate updates, lightweight transforms, DPR cap (1.5)

**Status:** Presentable - clear visual effect, cinematic

---

### 5. **Temporal Persistence** (Ghost Trails)
**What it feels like:** Depth layers leave faint ghost trails as they move, like imperfect vision or memory.

**Mechanism:** Samples depth bands over time, accumulates faint copies with fade-out. Creates ethereal, memory-like trails.

**Parameters:**
- `intensity` (0-1): Overall effect strength (default: 0.3)
- `persistenceDuration` (500-2000ms): How long trails persist (default: 1200ms)
- `trailCount` (3-8): Maximum simultaneous trails (default: 5)
- `fadeRate` (0.1-0.3): How fast trails fade (default: 0.15)

**Performance:** Throttled sampling (8fps), limited trail count (max 8), soft wisps

**Status:** Experimental - may need tuning to avoid visual noise

---

### 6. **Depth Ambiguity** (Soft Focus on Boundaries)
**What it feels like:** Depth boundaries become soft and ambiguous, like viewing through slightly unfocused eyes.

**Mechanism:** Samples depth boundaries, applies soft blur/gradient overlays at depth transitions. Uses CSS filter for performance.

**Parameters:**
- `intensity` (0-1): Overall effect strength (default: 0.4)
- `blurRadius` (2-8px): Blur amount (default: 4px)
- `boundaryThreshold` (0.1-0.3): Sensitivity to depth changes (default: 0.15)

**Performance:** Throttled sampling (6fps), CSS filter (GPU-accelerated), lightweight

**Status:** Presentable - subtle, perceptual effect

---

### 7. **Pressure Wave** (Depth Compression/Expansion)
**What it feels like:** The splat compresses and expands like it's under pressure, creating a volumetric pulse.

**Mechanism:** Samples depth, applies radial compression/expansion overlay that oscillates. Multiple simultaneous waves create complex pressure patterns.

**Parameters:**
- `intensity` (0-1): Overall effect strength (default: 0.5)
- `waveSpeed` (0.2-0.8): Cycles per second (default: 0.4)
- `compressionAmount` (0.8-1.2): How much to compress/expand (default: 1.15)
- `waveCount` (1-3): Number of simultaneous waves (default: 2)

**Performance:** Throttled updates (10fps), mobile-safe, soft gradients

**Status:** Presentable - clear volumetric effect

---

### 8. **Grouped Selection** (Stochastic Depth Highlighting)
**What it feels like:** Random depth groups are briefly highlighted, revealing the splat's internal structure.

**Mechanism:** Randomly selects depth bands, applies subtle highlight overlay that fades in/out. Stochastic selection creates organic, unpredictable reveals.

**Parameters:**
- `intensity` (0-1): Overall effect strength (default: 0.4)
- `highlightDuration` (800-2000ms): How long highlights last (default: 1500ms)
- `groupCount` (2-4): Simultaneous highlights (default: 3)
- `selectionRate` (0.5-2.0): Highlights per second (default: 1.0)

**Performance:** Throttled selection (2-3 per second), limited group count, soft highlights

**Status:** Presentable - subtle discovery effect

---

## Integration

**Where it plugs in:**
- Effects dropdown in HUD (new "Volumetric Effects" optgroup)
- `VolumetricEffectsManager` manages all effects with single-effect enforcement
- Integrated with `EffectsController` preset system
- Pauses during feed transitions, resumes after settle
- Respects performance quality tiers (HIGH/MED/LOW)

**Default values:**
All effects use conservative defaults optimized for demo visibility:
- Intensity: 0.3-0.5 (subtle to medium)
- Update rates: 6-10fps (throttled for performance)
- DPR cap: 1.5 (mobile-safe)
- Soft wisps/gradients (no dots, no confetti)

**Interaction rules:**
- Only one volumetric effect active at a time (enforced by manager)
- Effects auto-decay/settle (fade out naturally)
- Pause during feed transitions
- Resume after splat is settled and visible
- Explicitly triggered via HUD dropdown

---

## Status Summary

**Presentable (ready for demo):**
- Depth Pulse
- Volumetric Drift
- Covariance Stretch
- Depth Ambiguity
- Pressure Wave
- Grouped Selection

**Experimental (may need tuning):**
- Opacity Accumulation
- Temporal Persistence

---

## Performance Guardrails

All effects include:
- Throttled sampling/updates (6-10fps for expensive operations)
- Mobile DPR cap (1.5 max)
- Particle/wisp count limits
- Frame skipping when quality is low
- Pause during transitions
- Graceful degradation under load

---

## Success Condition

✅ Effects clearly change how the splat is perceived, not just decorated  
✅ The viewer feels the splat has depth, presence, and life  
✅ The demo remains smooth, readable, and Instagram-level in polish  
✅ No visible dots, sparks, or noise  
✅ Splat remains the hero at all times
