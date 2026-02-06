struct Particle {
  position : vec3<f32>,
  age : f32,
  velocity : vec3<f32>,
  lifetime : f32,
}

struct SimUniform {
  dt : f32,
  drag : f32,
  spawn_rate : f32,
  lifetime : f32,
  gravity : vec3<f32>,
  _pad0 : f32,
  attractor : vec3<f32>,
  attractor_strength : f32,
  noise_strength : f32,
  _pad1 : vec3<f32>,
}

@group(0) @binding(0)
var<storage, read_write> particles : array<Particle>;

@group(0) @binding(1)
var<uniform> sim : SimUniform;

fn safe_normalize(v: vec3<f32>) -> vec3<f32> {
  let len_sq = dot(v, v);
  if (len_sq < 1e-8) {
    return vec3<f32>(0.0);
  }
  return v * inverseSqrt(len_sq);
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= arrayLength(&particles)) {
    return;
  }

  var p = particles[i];
  if (p.age >= p.lifetime) {
    particles[i] = p;
    return;
  }

  p.age = p.age + sim.dt;
  if (p.age >= p.lifetime) {
    particles[i] = p;
    return;
  }

  let to_attr = sim.attractor - p.position;
  let attraction = safe_normalize(to_attr) * sim.attractor_strength;
  let accel = sim.gravity + attraction;
  p.velocity = p.velocity * sim.drag + accel * sim.dt;
  p.position = p.position + p.velocity * sim.dt;

  particles[i] = p;
}
