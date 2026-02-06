use crate::particles::ForceConfig;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PassId {
    MtsdfPass01,
    MtsdfPass02,
    MtsdfPass03,
    Recovery,
}

#[derive(Debug, Clone, Copy)]
pub struct FxProfile {
    pub displacement: f32,
    pub chromatic_aberration: f32,
    pub blur: f32,
    pub pixelate: f32,
}

impl FxProfile {
    pub fn lerp(self, next: Self, t: f32) -> Self {
        let t = t.clamp(0.0, 1.0);
        Self {
            displacement: self.displacement + (next.displacement - self.displacement) * t,
            chromatic_aberration: self.chromatic_aberration
                + (next.chromatic_aberration - self.chromatic_aberration) * t,
            blur: self.blur + (next.blur - self.blur) * t,
            pixelate: self.pixelate + (next.pixelate - self.pixelate) * t,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct PassPreset {
    pub id: PassId,
    pub label: &'static str,
    pub duration_seconds: f32,
    pub profile: FxProfile,
    pub particle_spawn_multiplier: f32,
    pub force: ForceConfig,
}

#[derive(Debug, Clone)]
pub struct VideoTimeline {
    passes: Vec<PassPreset>,
    total_duration: f32,
}

impl VideoTimeline {
    pub fn mtsdf_reference_sequence() -> Self {
        let passes = vec![
            PassPreset {
                id: PassId::MtsdfPass01,
                label: "Mtsdf pass 01",
                duration_seconds: 2.3,
                profile: FxProfile {
                    displacement: 0.35,
                    chromatic_aberration: 0.1,
                    blur: 0.05,
                    pixelate: 0.0,
                },
                particle_spawn_multiplier: 0.8,
                force: ForceConfig {
                    gravity: [0.0, -0.25, 0.0],
                    attractor: [0.15, 0.05, 0.0],
                    attractor_strength: 0.09,
                    noise_strength: 0.2,
                },
            },
            PassPreset {
                id: PassId::MtsdfPass02,
                label: "Mtsdf pass 02",
                duration_seconds: 2.6,
                profile: FxProfile {
                    displacement: 0.85,
                    chromatic_aberration: 0.7,
                    blur: 0.22,
                    pixelate: 0.15,
                },
                particle_spawn_multiplier: 1.1,
                force: ForceConfig {
                    gravity: [0.0, -0.05, 0.0],
                    attractor: [-0.2, 0.0, 0.0],
                    attractor_strength: 0.3,
                    noise_strength: 0.45,
                },
            },
            PassPreset {
                id: PassId::MtsdfPass03,
                label: "Mtsdf pass 03",
                duration_seconds: 2.2,
                profile: FxProfile {
                    displacement: 0.95,
                    chromatic_aberration: 0.85,
                    blur: 0.18,
                    pixelate: 0.6,
                },
                particle_spawn_multiplier: 1.35,
                force: ForceConfig {
                    gravity: [0.0, -0.15, 0.0],
                    attractor: [0.0, -0.1, 0.0],
                    attractor_strength: 0.42,
                    noise_strength: 0.35,
                },
            },
            PassPreset {
                id: PassId::Recovery,
                label: "Recovery",
                duration_seconds: 3.2,
                profile: FxProfile {
                    displacement: 0.08,
                    chromatic_aberration: 0.02,
                    blur: 0.01,
                    pixelate: 0.0,
                },
                particle_spawn_multiplier: 0.5,
                force: ForceConfig {
                    gravity: [0.0, -0.35, 0.0],
                    attractor: [0.0, 0.0, 0.0],
                    attractor_strength: 0.02,
                    noise_strength: 0.1,
                },
            },
        ];
        let total_duration = passes.iter().map(|p| p.duration_seconds).sum();
        Self {
            passes,
            total_duration,
        }
    }

    pub fn total_duration(&self) -> f32 {
        self.total_duration
    }

    pub fn passes(&self) -> &[PassPreset] {
        &self.passes
    }

    pub fn sample(&self, time_seconds: f32) -> TimelineSample {
        let mut t = time_seconds.max(0.0);
        if self.total_duration > 0.0 {
            t %= self.total_duration;
        }

        let mut acc = 0.0;
        for (idx, pass) in self.passes.iter().enumerate() {
            let end = acc + pass.duration_seconds;
            if t <= end || idx == self.passes.len() - 1 {
                let local = (t - acc).max(0.0);
                let phase = if pass.duration_seconds <= f32::EPSILON {
                    0.0
                } else {
                    (local / pass.duration_seconds).clamp(0.0, 1.0)
                };
                let next = self.passes[(idx + 1) % self.passes.len()];
                return TimelineSample {
                    current: *pass,
                    next,
                    phase,
                    blended_profile: pass.profile.lerp(next.profile, smoothstep(phase)),
                };
            }
            acc = end;
        }

        // Non-empty by construction.
        let pass = self.passes[0];
        TimelineSample {
            current: pass,
            next: pass,
            phase: 0.0,
            blended_profile: pass.profile,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct TimelineSample {
    pub current: PassPreset,
    pub next: PassPreset,
    pub phase: f32,
    pub blended_profile: FxProfile,
}

fn smoothstep(t: f32) -> f32 {
    let t = t.clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

#[cfg(test)]
mod tests {
    use super::{PassId, VideoTimeline};

    #[test]
    fn total_duration_matches_sum() {
        let timeline = VideoTimeline::mtsdf_reference_sequence();
        let sum: f32 = timeline.passes().iter().map(|p| p.duration_seconds).sum();
        assert!((sum - timeline.total_duration()).abs() < 1e-5);
    }

    #[test]
    fn starts_in_first_pass() {
        let timeline = VideoTimeline::mtsdf_reference_sequence();
        let sample = timeline.sample(0.0);
        assert_eq!(sample.current.id, PassId::MtsdfPass01);
    }

    #[test]
    fn loops_at_total_duration() {
        let timeline = VideoTimeline::mtsdf_reference_sequence();
        let a = timeline.sample(0.2);
        let b = timeline.sample(timeline.total_duration() + 0.2);
        assert_eq!(a.current.id, b.current.id);
    }
}
