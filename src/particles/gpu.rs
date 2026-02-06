use std::borrow::Cow;
use std::mem::size_of;
use std::sync::mpsc;

use bytemuck::{bytes_of, cast_slice, Pod, Zeroable};

use super::compute::{ParticleBufferLayout, ParticleComputePlan, ParticleWorkgroup};
use super::config::{ForceConfig, ParticleSimConfig};
use super::simulation::Particle;

#[derive(Debug, Clone, Copy)]
pub struct ParticleStepInput {
    pub dt_seconds: f32,
    pub force: ForceConfig,
}

impl Default for ParticleStepInput {
    fn default() -> Self {
        Self {
            dt_seconds: 1.0 / 120.0,
            force: ForceConfig::default(),
        }
    }
}

#[derive(Debug)]
pub enum ParticleGpuError {
    InvalidWorkgroupSize { expected: u32, got: u32 },
    MapFailed,
    ChannelClosed,
}

impl std::fmt::Display for ParticleGpuError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidWorkgroupSize { expected, got } => write!(
                f,
                "invalid particle workgroup size: expected {}, got {}",
                expected, got
            ),
            Self::MapFailed => write!(f, "failed to map GPU staging buffer"),
            Self::ChannelClosed => write!(f, "staging-map channel closed before completion"),
        }
    }
}

impl std::error::Error for ParticleGpuError {}

pub struct ParticleGpuSim {
    config: ParticleSimConfig,
    compute_plan: ParticleComputePlan,
    particle_buffer: wgpu::Buffer,
    sim_uniform_buffer: wgpu::Buffer,
    bind_group: wgpu::BindGroup,
    pipeline: wgpu::ComputePipeline,
}

impl ParticleGpuSim {
    pub fn init(
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        config: ParticleSimConfig,
        workgroup: ParticleWorkgroup,
    ) -> Result<Self, ParticleGpuError> {
        if workgroup.x != 256 {
            return Err(ParticleGpuError::InvalidWorkgroupSize {
                expected: 256,
                got: workgroup.x,
            });
        }

        let compute_plan = ParticleComputePlan::new(config.max_particles, workgroup);
        let layout = ParticleBufferLayout::default();
        let particles_size = layout.particle_stride_bytes * config.max_particles as u64;
        let initial_particles = vec![Particle::dead(); config.max_particles as usize];

        let particle_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("particles.storage"),
            size: particles_size,
            usage: wgpu::BufferUsages::STORAGE
                | wgpu::BufferUsages::COPY_SRC
                | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        queue.write_buffer(&particle_buffer, 0, cast_slice(&initial_particles));

        let initial_uniform = GpuSimUniform::new(ParticleStepInput::default(), config);
        let sim_uniform_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("particles.uniform"),
            size: layout.sim_uniform_bytes,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        queue.write_buffer(&sim_uniform_buffer, 0, bytes_of(&initial_uniform));

        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("particles.compute.bgl"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: false },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });

        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("particles.compute.bg"),
            layout: &bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: particle_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: sim_uniform_buffer.as_entire_binding(),
                },
            ],
        });

        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("particles.compute.pl"),
            bind_group_layouts: &[&bind_group_layout],
            push_constant_ranges: &[],
        });

        let shader_source = include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/shaders/particles_update.wgsl"
        ));
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("particles.update.shader"),
            source: wgpu::ShaderSource::Wgsl(Cow::Borrowed(shader_source)),
        });

        let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("particles.update.pipeline"),
            layout: Some(&pipeline_layout),
            module: &shader,
            entry_point: "main",
            compilation_options: wgpu::PipelineCompilationOptions::default(),
            cache: None,
        });

        Ok(Self {
            config,
            compute_plan,
            particle_buffer,
            sim_uniform_buffer,
            bind_group,
            pipeline,
        })
    }

    pub fn particle_count(&self) -> u32 {
        self.compute_plan.particle_count
    }

    pub fn particle_buffer(&self) -> &wgpu::Buffer {
        &self.particle_buffer
    }

    pub fn encode_step(
        &self,
        queue: &wgpu::Queue,
        encoder: &mut wgpu::CommandEncoder,
        input: ParticleStepInput,
    ) {
        if self.compute_plan.dispatch_x == 0 {
            return;
        }

        let clamped_dt = input.dt_seconds.clamp(0.0, 1.0 / 15.0);
        let uniform = GpuSimUniform::new(
            ParticleStepInput {
                dt_seconds: clamped_dt,
                ..input
            },
            self.config,
        );
        queue.write_buffer(&self.sim_uniform_buffer, 0, bytes_of(&uniform));

        let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
            label: Some("particles.update.pass"),
            timestamp_writes: None,
        });
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, &self.bind_group, &[]);
        pass.dispatch_workgroups(self.compute_plan.dispatch_x, 1, 1);
    }

    pub fn step(
        &self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        input: ParticleStepInput,
    ) -> wgpu::SubmissionIndex {
        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("particles.step.encoder"),
        });
        self.encode_step(queue, &mut encoder, input);
        queue.submit(Some(encoder.finish()))
    }

    pub fn readback_debug_sample(
        &self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        sample_count: u32,
    ) -> Result<Vec<Particle>, ParticleGpuError> {
        let sample_count = sample_count.min(self.compute_plan.particle_count);
        if sample_count == 0 {
            return Ok(Vec::new());
        }

        let bytes_to_copy = (sample_count as u64) * size_of::<Particle>() as u64;
        let staging = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("particles.debug.staging"),
            size: bytes_to_copy,
            usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("particles.debug.copy.encoder"),
        });
        encoder.copy_buffer_to_buffer(&self.particle_buffer, 0, &staging, 0, bytes_to_copy);
        queue.submit(Some(encoder.finish()));

        let slice = staging.slice(..);
        let (tx, rx) = mpsc::channel();
        slice.map_async(wgpu::MapMode::Read, move |result| {
            let _ = tx.send(result);
        });

        #[allow(deprecated)]
        {
            device.poll(wgpu::Maintain::Wait);
        }

        let map_result = rx.recv().map_err(|_| ParticleGpuError::ChannelClosed)?;
        map_result.map_err(|_| ParticleGpuError::MapFailed)?;

        let data = slice.get_mapped_range();
        let particles: &[Particle] = cast_slice(&data);
        let out = particles.to_vec();
        drop(data);
        staging.unmap();

        Ok(out)
    }
}

#[repr(C)]
#[derive(Debug, Clone, Copy, Pod, Zeroable)]
struct GpuSimUniform {
    dt: f32,
    drag: f32,
    spawn_rate: f32,
    lifetime: f32,
    gravity: [f32; 3],
    _pad0: f32,
    attractor: [f32; 3],
    attractor_strength: f32,
    noise_strength: f32,
    _pad1: [f32; 3],
}

impl GpuSimUniform {
    fn new(step: ParticleStepInput, config: ParticleSimConfig) -> Self {
        Self {
            dt: step.dt_seconds,
            drag: config.drag,
            spawn_rate: config.spawn_rate_per_second,
            lifetime: config.lifetime_seconds,
            gravity: step.force.gravity,
            _pad0: 0.0,
            attractor: step.force.attractor,
            attractor_strength: step.force.attractor_strength,
            noise_strength: step.force.noise_strength,
            _pad1: [0.0; 3],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::GpuSimUniform;

    #[test]
    fn sim_uniform_size_is_64_bytes() {
        assert_eq!(std::mem::size_of::<GpuSimUniform>(), 64);
    }
}
