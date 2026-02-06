use rust_webgpu_visual_engine::particles::{
    EmitterConfig, ForceConfig, ParticleSimConfig, ParticleState, SimulationClock,
};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let seconds = parse_arg(&args, "--seconds").unwrap_or(5.0);
    let fps = parse_arg(&args, "--fps").unwrap_or(120.0);

    let config = ParticleSimConfig::default();
    let emitter = EmitterConfig::default();
    let force = ForceConfig::default();

    let mut state = ParticleState::new(config);
    let mut clock = SimulationClock::new(1.0 / fps.max(1.0));
    let mut elapsed = 0.0f32;

    println!(
        "Particle sim smoke run: {:.1}s @ {:.1}fps (max_particles={})",
        seconds, fps, config.max_particles
    );

    while elapsed < seconds {
        let steps = clock.consume_steps(1.0 / fps.max(1.0));
        for _ in 0..steps {
            state.step_reference(clock.fixed_dt_seconds, config, emitter, force);
        }
        elapsed += 1.0 / fps.max(1.0);

        if (elapsed * 2.0).fract() < 0.001 {
            println!(
                "t={:.2}s alive={} dead={}",
                elapsed,
                state.alive_count(),
                config.max_particles as usize - state.alive_count()
            );
        }
    }

    println!("Done. Final alive count: {}", state.alive_count());
}

fn parse_arg(args: &[String], flag: &str) -> Option<f32> {
    args.iter()
        .position(|v| v == flag)
        .and_then(|i| args.get(i + 1))
        .and_then(|v| v.parse::<f32>().ok())
}
