use rust_webgpu_visual_engine::particles::{
    EmitterConfig, ParticleSimConfig, ParticleState, SimulationClock,
};
use rust_webgpu_visual_engine::timeline::VideoTimeline;

fn main() {
    let timeline = VideoTimeline::mtsdf_reference_sequence();
    let mut config = ParticleSimConfig::default();
    let emitter = EmitterConfig::default();
    let mut state = ParticleState::new(config);
    let mut clock = SimulationClock::new(1.0 / 120.0);

    let total = timeline.total_duration();
    let mut t = 0.0f32;
    let mut last_label = "";

    println!(
        "Running video-style flow for {:.2}s with {} passes",
        total,
        timeline.passes().len()
    );

    while t < total {
        let sample = timeline.sample(t);
        if sample.current.label != last_label {
            println!(
                "\n[{}] -> next={} phase={:.2}",
                sample.current.label, sample.next.label, sample.phase
            );
            println!(
                "  fx displacement={:.2} chroma={:.2} blur={:.2} pixelate={:.2}",
                sample.blended_profile.displacement,
                sample.blended_profile.chromatic_aberration,
                sample.blended_profile.blur,
                sample.blended_profile.pixelate
            );
            last_label = sample.current.label;
        }

        config.spawn_rate_per_second = ParticleSimConfig::default().spawn_rate_per_second
            * sample.current.particle_spawn_multiplier;

        for _ in 0..clock.consume_steps(1.0 / 120.0) {
            state.step_reference(
                clock.fixed_dt_seconds,
                config,
                emitter,
                sample.current.force,
            );
        }

        if (t * 2.0).fract() < 0.008 {
            println!(
                "  t={:.2}s alive={} spawn_rate={:.0}",
                t,
                state.alive_count(),
                config.spawn_rate_per_second
            );
        }

        t += 1.0 / 120.0;
    }

    println!("\nDone. Final alive count={}", state.alive_count());
}
