pub struct LinearResampler {
    source_rate: u32,
    target_rate: u32,
    // Exact source position in units of 1 / target_rate; chunk boundaries cannot accumulate rounding drift.
    position: u64,
    previous: Option<f32>,
}

impl LinearResampler {
    pub fn new(source_rate: u32, target_rate: u32) -> anyhow::Result<Self> {
        if source_rate == 0 || target_rate == 0 {
            anyhow::bail!("audio sample rates must be non-zero");
        }
        Ok(Self {
            source_rate,
            target_rate,
            position: 0,
            previous: None,
        })
    }

    pub fn process(&mut self, input: &[f32], output: &mut Vec<f32>) {
        if input.is_empty() {
            return;
        }
        if self.source_rate == self.target_rate {
            output.extend_from_slice(input);
            self.previous = input.last().copied();
            return;
        }

        let scale = u64::from(self.target_rate);
        let mut samples = Vec::with_capacity(input.len() + usize::from(self.previous.is_some()));
        if let Some(previous) = self.previous {
            samples.push(previous);
        }
        samples.extend_from_slice(input);
        let end = (samples.len() - 1) as u64 * scale;
        while self.position < end {
            let left = (self.position / scale) as usize;
            let fraction = (self.position % scale) as f32 / self.target_rate as f32;
            output.push(samples[left] * (1.0 - fraction) + samples[left + 1] * fraction);
            self.position += u64::from(self.source_rate);
        }
        self.position -= end;
        self.previous = input.last().copied();
    }

    pub fn reset(&mut self) {
        self.position = 0;
        self.previous = None;
    }
}
