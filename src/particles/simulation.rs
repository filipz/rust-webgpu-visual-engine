use super::config::{EmitterConfig, ForceConfig, ParticleSimConfig};

#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct Particle {
    pub position: [f32; 3],
    pub age_seconds: f32,
    pub velocity: [f32; 3],
    pub lifetime_seconds: f32,
}

impl Particle {
    pub fn dead() -> Self {
        Self {
            position: [0.0, 0.0, 0.0],
            age_seconds: f32::MAX,
            velocity: [0.0, 0.0, 0.0],
            lifetime_seconds: 0.0,
        }
    }

    pub fn is_alive(self) -> bool {
        self.age_seconds < self.lifetime_seconds
    }
}

#[derive(Debug)]
pub struct ParticleState {
    pub particles: Vec<Particle>,
    spawn_accumulator: f32,
}

impl ParticleState {
    pub fn new(config: ParticleSimConfig) -> Self {
        Self {
            particles: vec![Particle::dead(); config.max_particles as usize],
            spawn_accumulator: 0.0,
        }
    }

    pub fn alive_count(&self) -> usize {
        self.particles.iter().filter(|p| p.is_alive()).count()
    }

    pub fn step_reference(
        &mut self,
        dt: f32,
        config: ParticleSimConfig,
        emitter: EmitterConfig,
        force: ForceConfig,
    ) {
        let clamped_dt = dt.max(0.0).min(1.0 / 15.0);

        for particle in &mut self.particles {
            if !particle.is_alive() {
                continue;
            }

            particle.age_seconds += clamped_dt;
            if !particle.is_alive() {
                continue;
            }

            let to_attractor = sub(force.attractor, particle.position);
            let attraction = mul_scalar(normalize_or_zero(to_attractor), force.attractor_strength);
            let accel = add(force.gravity, attraction);
            particle.velocity = add(mul_scalar(particle.velocity, config.drag), mul_scalar(accel, clamped_dt));
            particle.position = add(particle.position, mul_scalar(particle.velocity, clamped_dt));
        }

        self.spawn_accumulator += config.spawn_rate_per_second * clamped_dt;
        let spawn_count = self.spawn_accumulator.floor() as usize;
        self.spawn_accumulator -= spawn_count as f32;
        self.spawn(spawn_count, config, emitter, force);
    }

    fn spawn(
        &mut self,
        mut count: usize,
        config: ParticleSimConfig,
        emitter: EmitterConfig,
        force: ForceConfig,
    ) {
        if count == 0 {
            return;
        }

        for (i, particle) in self.particles.iter_mut().enumerate() {
            if count == 0 {
                break;
            }
            if particle.is_alive() {
                continue;
            }

            // Deterministic pseudo-random sequence for reproducible test runs.
            let s = hash01(i as u32 + (count as u32 * 17));
            let t = hash01(i as u32 + (count as u32 * 73));
            let u = hash01(i as u32 + (count as u32 * 193));

            let angle = s * std::f32::consts::TAU;
            let radial = emitter.radius * t.sqrt();
            let offset = [radial * angle.cos(), radial * angle.sin(), (u - 0.5) * emitter.radius];
            let direction = normalize_or_zero(add(offset, [0.001, 0.001, 0.001]));
            let noise_push = mul_scalar(direction, force.noise_strength);

            *particle = Particle {
                position: add(emitter.center, offset),
                age_seconds: 0.0,
                velocity: add(mul_scalar(direction, emitter.initial_speed), noise_push),
                lifetime_seconds: config.lifetime_seconds,
            };
            count -= 1;
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct SimulationClock {
    pub fixed_dt_seconds: f32,
    accumulator_seconds: f32,
}

impl SimulationClock {
    pub fn new(fixed_dt_seconds: f32) -> Self {
        Self {
            fixed_dt_seconds,
            accumulator_seconds: 0.0,
        }
    }

    pub fn consume_steps(&mut self, frame_dt_seconds: f32) -> u32 {
        self.accumulator_seconds += frame_dt_seconds.max(0.0);
        let mut steps = 0u32;
        while self.accumulator_seconds >= self.fixed_dt_seconds {
            self.accumulator_seconds -= self.fixed_dt_seconds;
            steps += 1;
            if steps >= 8 {
                self.accumulator_seconds = 0.0;
                break;
            }
        }
        steps
    }
}

fn add(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

fn sub(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn mul_scalar(v: [f32; 3], s: f32) -> [f32; 3] {
    [v[0] * s, v[1] * s, v[2] * s]
}

fn normalize_or_zero(v: [f32; 3]) -> [f32; 3] {
    let len_sq = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
    if len_sq <= 1e-8 {
        return [0.0, 0.0, 0.0];
    }
    mul_scalar(v, len_sq.sqrt().recip())
}

fn hash01(seed: u32) -> f32 {
    let mut x = seed.wrapping_mul(747_796_405).wrapping_add(2_891_336_453);
    x ^= x >> 16;
    x = x.wrapping_mul(224_682_2519);
    x ^= x >> 13;
    (x as f32) / (u32::MAX as f32)
}

#[cfg(test)]
mod tests {
    use super::{EmitterConfig, ForceConfig, ParticleSimConfig, ParticleState, SimulationClock};

    #[test]
    fn fixed_clock_caps_steps() {
        let mut clock = SimulationClock::new(1.0 / 120.0);
        let steps = clock.consume_steps(0.5);
        assert_eq!(steps, 8);
    }

    #[test]
    fn reference_step_spawns_particles() {
        let config = ParticleSimConfig {
            max_particles: 256,
            spawn_rate_per_second: 120.0,
            ..ParticleSimConfig::default()
        };
        let mut state = ParticleState::new(config);
        state.step_reference(1.0 / 60.0, config, EmitterConfig::default(), ForceConfig::default());
        assert!(state.alive_count() > 0);
    }
}
