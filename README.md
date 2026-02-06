# rust-webgpu-visual-engine

Rust + WebGPU rendering stack focused on:
- MTSDF text rendering with HTML/canvas metric alignment
- Particle simulation
- Point cloud rendering
- Gaussian splatting

## Current Status

- Repo initialized and connected to GitHub remote.
- Phase 1 scaffolding added:
  - `src/particles/config.rs`
  - `src/particles/simulation.rs`
  - `src/particles/compute.rs`
  - `shaders/particles_update.wgsl`

## Execution Order

1. Particle simulation core
2. Point cloud pass (instanced/compute-driven)
3. Gaussian splatting pass
4. Unified scene compositor and quality tiers

Detailed milestones and model-switch guidance are in `ROADMAP.md`.

## Local Build

```bash
cargo test
```

## Push To GitHub

```bash
git add .
git commit -m "feat: scaffold particle simulation phase"
git push -u origin main
```
