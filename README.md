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

## Run Simulation Smoke Test

```bash
cargo run -- --seconds 8 --fps 120
```

Useful variants:

```bash
cargo run -- --seconds 3 --fps 60
cargo run -- --seconds 12 --fps 144
```

## Run Video-Style Pass Flow (aligned with your reference direction)

```bash
cargo run --example mtsdf_video_flow
```

This runs the `Mtsdf pass 01/02/03 + Recovery` timeline and drives particle behavior per pass.

## Run GPU Compute Smoke Test (low-level sanity check)

```bash
cargo run --example gpu_smoke
```

Expected output shape:

```text
gpu_smoke ok: particle_count=... sampled=128 alive_in_sample=...
```

## Push To GitHub

```bash
git add .
git commit -m "feat: scaffold particle simulation phase"
git push -u origin main
```
