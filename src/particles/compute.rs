#[derive(Debug, Clone, Copy)]
pub struct ParticleWorkgroup {
    pub x: u32,
    pub y: u32,
    pub z: u32,
}

impl Default for ParticleWorkgroup {
    fn default() -> Self {
        Self { x: 256, y: 1, z: 1 }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct ParticleComputePlan {
    pub particle_count: u32,
    pub workgroup: ParticleWorkgroup,
    pub dispatch_x: u32,
}

impl ParticleComputePlan {
    pub fn new(particle_count: u32, workgroup: ParticleWorkgroup) -> Self {
        let dispatch_x = if particle_count == 0 {
            0
        } else {
            ((particle_count - 1) / workgroup.x) + 1
        };
        Self {
            particle_count,
            workgroup,
            dispatch_x,
        }
    }
}

pub const PARTICLE_UPDATE_SHADER_PATH: &str = "shaders/particles_update.wgsl";

#[derive(Debug, Clone, Copy)]
pub struct ParticleBufferLayout {
    pub particle_stride_bytes: u64,
    pub sim_uniform_bytes: u64,
}

impl Default for ParticleBufferLayout {
    fn default() -> Self {
        Self {
            // position.xyz + age + velocity.xyz + lifetime
            particle_stride_bytes: 32,
            // Keep this aligned to 16-byte boundaries for std140-like packing.
            sim_uniform_bytes: 64,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{ParticleComputePlan, ParticleWorkgroup};

    #[test]
    fn compute_plan_rounds_up_dispatch() {
        let plan = ParticleComputePlan::new(1_001, ParticleWorkgroup::default());
        assert_eq!(plan.dispatch_x, 4);
    }
}
