# Roadmap

## Model / Reasoning Strategy

Use this default:
- High: day-to-day implementation, shaders, glue code, refactors, tests.
- Ultra High: one-off architecture decisions and debugging bottlenecks.

Switch to Ultra High only when:
1. You are choosing memory layout/API boundaries that are hard to change later.
2. You are diagnosing unstable frame time, GPU stalls, or blending artifacts.
3. You are designing gaussian splat sorting/binning and transparency strategy.

Switch back to High when:
1. Architecture is decided and tasks are mostly implementation.
2. You are iterating shaders with visible pass/fail outcomes.
3. You are wiring engine modules and writing tests/bench scripts.

Optional different-model rule:
- Use a faster/lower-cost coding model for repetitive boilerplate, docs, and mechanical refactors.
- Return to high-reasoning model for render math, pipeline ordering, and performance tuning.

## Build Sequence

### Phase 1: Particle Simulation (start now)
Goal: stable GPU simulation with deterministic controls.

Deliverables:
1. Compute pass for particle state update (position, velocity, lifetime).
2. Emitter + force fields (noise, attractor, drag).
3. Debug visualization (points + vector field overlay).
4. Fixed-timestep simulation loop decoupled from render framerate.

Exit criteria:
1. 50k-200k particles at stable frame budget target.
2. No NaN/infinite positions after long soak run.

### Phase 2: Point Cloud Module
Start when Phase 1 exit criteria are met.

Deliverables:
1. Point attribute format (position, radius, color, opacity).
2. Camera-aware attenuation and depth handling.
3. LOD and culling path (frustum + screen-size threshold).

Exit criteria:
1. Visual density remains readable under camera motion.
2. Quality tier fallback for lower-end GPUs.

### Phase 3: Gaussian Splatting
Start after point cloud camera/depth pipeline is stable.

Deliverables:
1. Splat representation (mean, covariance/proxy axes, color, alpha).
2. Blend strategy and ordering policy.
3. Performance path: binning/sorting or approximate order-independent mode.

Exit criteria:
1. No severe popping/flicker during camera movement.
2. Predictable performance envelope across quality tiers.

### Phase 4: Integration With Typography + Web UX
Start after at least one stable visual mode exists in each module.

Deliverables:
1. Pass graph integration with MTSDF text pipeline.
2. DOM-to-canvas sync hooks (scroll/pointer/section states).
3. Preset scenes for web sections (hero, transition, content background).

Exit criteria:
1. Text legibility maintained during effect peaks.
2. Desktop + mobile profiles produce intentional, consistent style.

## Immediate Next Tasks

1. Define particle state buffer schema and alignment.
2. Implement minimal compute shader update pass.
3. Add a debug UI panel for emitter/force parameters.
4. Add a perf capture script (frame time + particle count + GPU timing if available).
