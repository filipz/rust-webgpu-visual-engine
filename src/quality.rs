#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QualityTier {
    MobileLow,
    DesktopHigh,
    DesktopUltra,
}

#[derive(Debug, Clone, Copy)]
pub struct BudgetProfile {
    pub max_particles: u32,
    pub splat_resolution_divisor: u32,
    pub postprocess_passes: u32,
}

impl QualityTier {
    pub fn budget(self) -> BudgetProfile {
        match self {
            Self::MobileLow => BudgetProfile {
                max_particles: 50_000,
                splat_resolution_divisor: 2,
                postprocess_passes: 1,
            },
            Self::DesktopHigh => BudgetProfile {
                max_particles: 200_000,
                splat_resolution_divisor: 1,
                postprocess_passes: 2,
            },
            Self::DesktopUltra => BudgetProfile {
                max_particles: 500_000,
                splat_resolution_divisor: 1,
                postprocess_passes: 4,
            },
        }
    }
}
