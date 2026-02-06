# webgl-rust

Rust + WebGPU rendering stack focused on:
- MTSDF text rendering with HTML/canvas metric alignment
- Particle simulation
- Point cloud rendering
- Gaussian splatting

## Execution Order

1. Particle simulation core
2. Point cloud pass (instanced/compute-driven)
3. Gaussian splatting pass
4. Unified scene compositor and quality tiers

Detailed milestones and model-switch guidance are in `ROADMAP.md`.

## Git Remote Setup (when ready)

```bash
git remote add origin <your-repo-url>
git add .
git commit -m "chore: initialize project"
git push -u origin main
```
