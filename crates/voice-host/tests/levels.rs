use pretty_assertions::assert_eq;
use proptest::prelude::*;
use rstest::rstest;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use voice_host::levels::AudioPeak;
use voice_host::levels::spawn_levels;
use voice_host::protocol::Event;

#[rstest]
#[case(false, 255)]
#[case(true, 0)]
#[tokio::test]
async fn metering_discards_muted_input_without_hiding_output(
    #[case] muted: bool,
    #[case] expected: u8,
) {
    let microphone = Arc::new(AudioPeak::default());
    let speaker = Arc::new(AudioPeak::default());
    let mute = Arc::new(AtomicBool::new(muted));
    microphone.record(1.0);
    speaker.record(1.0);
    let (tx, mut rx) = tokio::sync::mpsc::channel(1);
    let task = spawn_levels(Arc::clone(&microphone), speaker, Arc::clone(&mute), tx);
    // Tokio intervals emit their first tick immediately; no wall-clock wait.
    let Some(Event::Levels {
        microphone: input,
        speaker: output,
    }) = rx.recv().await
    else {
        panic!("missing levels")
    };
    task.abort();
    let _ = task.await;
    assert_eq!(input, expected);
    assert_eq!(output, 255);
    mute.store(false, Ordering::Relaxed);
    assert_eq!(microphone.take(), 0);
}

#[rstest]
#[case(0.0, 0)]
#[case(512.0 / 32767.0, 0)]
#[case(8192.0 / 32767.0, 255)]
#[case(1.0, 255)]
fn meter_uses_speech_range_and_resets(#[case] sample: f32, #[case] expected: u8) {
    let meter = AudioPeak::default();
    meter.record(sample);
    assert_eq!(meter.take(), expected);
    assert_eq!(meter.take(), 0);
}

proptest! {
    #[test]
    fn samples_preserve_peak_independent_of_order_and_sign(samples in prop::collection::vec(-1_f32..1_f32, 0..100)) {
        let forward = AudioPeak::default();
        let reverse = AudioPeak::default();
        let maximum = AudioPeak::default();
        for sample in &samples { forward.record(*sample); }
        for sample in samples.iter().rev() { reverse.record(-*sample); }
        maximum.record(samples.iter().fold(0_f32, |peak, sample| peak.max(sample.abs())));
        let expected = maximum.take();
        prop_assert_eq!(forward.take(), expected);
        prop_assert_eq!(reverse.take(), expected);
    }
}
