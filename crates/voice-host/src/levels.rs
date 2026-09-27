use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::time::Duration;

use tokio::sync::mpsc;

use crate::protocol::Event;

/// Peak audio observed between UI samples. Audio callbacks never wait for the UI.
#[derive(Default)]
pub struct AudioPeak(AtomicU16);

impl AudioPeak {
    pub fn record(&self, peak: f32) {
        let peak = (peak.abs().clamp(0.0, 1.0) * f32::from(i16::MAX)) as u16;
        self.0.fetch_max(peak, Ordering::Relaxed);
    }

    pub fn take(&self) -> u8 {
        // Match Codex's speech-focused meter range; this is display gain, not audio gain.
        let peak = u32::from(self.0.swap(0, Ordering::Relaxed));
        ((peak.saturating_sub(512) * 255).div_ceil(8192 - 512)).min(255) as u8
    }
}

pub fn spawn_levels(
    microphone: Arc<AudioPeak>,
    speaker: Arc<AudioPeak>,
    muted: Arc<AtomicBool>,
    events: mpsc::Sender<Event>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_millis(100));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            ticker.tick().await;
            let microphone = microphone.take();
            // Drop meter updates under backpressure; never hold up audio or control events.
            let _ = events.try_send(Event::Levels {
                microphone: if muted.load(Ordering::Relaxed) {
                    0
                } else {
                    microphone
                },
                speaker: speaker.take(),
            });
            if events.is_closed() {
                break;
            }
        }
    })
}
