#[derive(Debug, Clone, Copy)]
pub struct ParticleSimConfig {
    pub max_particles: u32,
    pub spawn_rate_per_second: f32,
    pub drag: f32,
    pub lifetime_seconds: f32,
}

impl Default for ParticleSimConfig {
    fn default() -> Self {
        Self {
            max_particles: 100_000,
            spawn_rate_per_second: 8_000.0,
            drag: 0.96,
            lifetime_seconds: 3.0,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct EmitterConfig {
    pub center: [f32; 3],
    pub radius: f32,
    pub initial_speed: f32,
}

impl Default for EmitterConfig {
    fn default() -> Self {
        Self {
            center: [0.0, 0.0, 0.0],
            radius: 0.25,
            initial_speed: 1.0,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct ForceConfig {
    pub gravity: [f32; 3],
    pub attractor: [f32; 3],
    pub attractor_strength: f32,
    pub noise_strength: f32,
}

impl Default for ForceConfig {
    fn default() -> Self {
        Self {
            gravity: [0.0, -0.4, 0.0],
            attractor: [0.0, 0.0, 0.0],
            attractor_strength: 0.0,
            noise_strength: 0.15,
        }
    }
}
