use rust_webgpu_visual_engine::particles::{
    ForceConfig, ParticleGpuSim, ParticleSimConfig, ParticleStepInput, ParticleWorkgroup,
};

fn main() {
    if let Err(err) = pollster::block_on(run()) {
        eprintln!("gpu_smoke failed: {err}");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let instance = wgpu::Instance::default();
    let adapter = instance
        .request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            compatible_surface: None,
            force_fallback_adapter: false,
        })
        .await
        .ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "no suitable GPU adapter found",
            )
        })?;

    let (device, queue) = adapter
        .request_device(
            &wgpu::DeviceDescriptor {
                label: Some("particle.gpu_smoke.device"),
                required_features: wgpu::Features::empty(),
                required_limits: wgpu::Limits::downlevel_defaults(),
                memory_hints: wgpu::MemoryHints::Performance,
            },
            None,
        )
        .await?;

    let config = ParticleSimConfig {
        max_particles: 8192,
        ..ParticleSimConfig::default()
    };
    let sim = ParticleGpuSim::init(&device, &queue, config, ParticleWorkgroup::default())?;

    for _ in 0..120 {
        sim.step(
            &device,
            &queue,
            ParticleStepInput {
                dt_seconds: 1.0 / 120.0,
                force: ForceConfig::default(),
            },
        );
    }

    let sample = sim.readback_debug_sample(&device, &queue, 128)?;
    let alive = sample
        .iter()
        .filter(|p| p.age_seconds.is_finite() && p.age_seconds < p.lifetime_seconds)
        .count();

    println!(
        "gpu_smoke ok: particle_count={} sampled={} alive_in_sample={}",
        sim.particle_count(),
        sample.len(),
        alive
    );

    Ok(())
}
