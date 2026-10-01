use crossbeam_queue::ArrayQueue;
use pretty_assertions::assert_eq;
use rstest::rstest;
use std::time::{Duration, Instant};
use voice_host::codex_audio::buffers::{BLOCK, CaptureBoundary, Frame, FramePacker};
use voice_host::codex_audio::processing::Processor;

proptest::proptest! {
    #[test]
    fn frame_packing_preserves_samples_across_callback_sizes(samples in proptest::collection::vec(-1.0f32..1.0, 1..2048), size in 1usize..=BLOCK) {
        let queue = ArrayQueue::new(16);
        let mut packer = FramePacker::default();
        let start = Instant::now();
        for (n, chunk) in samples.chunks(size).enumerate() {
            let mut frame = Frame { samples: [0.0; BLOCK], len: chunk.len(), at: start + Duration::from_secs_f64((n * size) as f64 / 48000.0), generation: 2 };
            frame.samples[..chunk.len()].copy_from_slice(chunk);
            proptest::prop_assert!(packer.push(&frame, 48000.0, &queue));
        }
        let mut actual = Vec::new();
        while let Some(frame) = queue.pop() { proptest::prop_assert_eq!(frame.generation, 2); actual.extend_from_slice(&frame.samples[..frame.len]); }
        proptest::prop_assert_eq!(&actual, &samples[..samples.len()/BLOCK*BLOCK]);
    }
}

#[rstest]
fn unmute_rejects_audio_captured_before_the_new_boundary() {
    let mut boundary = CaptureBoundary::default();
    let ms = Duration::from_millis;
    assert!(!boundary.accepts(1, ms(10), ms(10)));
    assert!(!boundary.accepts(2, ms(20), ms(10)));
    assert!(!boundary.accepts(2, ms(30), ms(20)));
    assert!(boundary.accepts(2, ms(40), ms(40)));
    assert!(!boundary.accepts(2, ms(50), ms(39)));
    assert!(!boundary.accepts(3, ms(60), ms(60)));
    assert!(!boundary.accepts(4, ms(70), ms(69)));
}

#[rstest]
#[case(16_000)]
#[case(44_100)]
#[case(48_000)]
fn processed_audio_produces_finite_twenty_millisecond_opus_frames(#[case] rate: u32) {
    let mut processor = Processor::new(rate, rate).unwrap();
    let start = Instant::now();
    let mut decoder = opus::Decoder::new(48_000, opus::Channels::Mono).unwrap();
    let mut packets = 0;
    for index in 0..(rate as usize / BLOCK) {
        let at = start + Duration::from_secs_f64((index * BLOCK) as f64 / f64::from(rate));
        let mut samples = [0.0; BLOCK];
        for (i, sample) in samples.iter_mut().enumerate() {
            *sample = (((index * BLOCK + i) as f32 * 0.05).sin()) * 0.1;
        }
        let frame = Frame {
            samples,
            len: BLOCK,
            at,
            generation: 0,
        };
        processor
            .render(
                &Frame {
                    samples: [0.0; BLOCK],
                    len: BLOCK,
                    at,
                    generation: 0,
                },
                at + Duration::from_millis(20),
            )
            .unwrap();
        for packet in processor
            .capture(&frame, || at + Duration::from_millis(20))
            .unwrap()
        {
            let mut pcm = [0.0; 960];
            assert_eq!(
                decoder.decode_float(&packet.data, &mut pcm, false).unwrap(),
                960
            );
            assert!(
                pcm.iter()
                    .all(|sample| sample.is_finite() && sample.abs() <= 1.0)
            );
            packets += 1;
        }
    }
    assert!(packets > 35 && packets <= 50, "{packets} packets at {rate}");
    processor.reset().unwrap();
    let stale = Frame {
        samples: [0.5; BLOCK],
        len: BLOCK,
        at: start.checked_sub(Duration::from_secs(1)).unwrap(),
        generation: 0,
    };
    assert!(processor.capture(&stale, Instant::now).unwrap().is_empty());
}
