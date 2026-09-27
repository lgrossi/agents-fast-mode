use pretty_assertions::assert_eq;
use rstest::rstest;
use voice_host::resample::*;

#[rstest]
fn resamples_without_losing_stream_continuity() {
    let mut resampler = LinearResampler::new(48_000, 24_000).unwrap();
    let mut output = Vec::new();
    resampler.process(&[0.0, 1.0, 2.0], &mut output);
    resampler.process(&[3.0, 4.0], &mut output);
    assert_eq!(output, vec![0.0, 2.0]);
}

proptest::proptest! {
    #[test]
    fn chunking_preserves_samples(
        samples in proptest::collection::vec(-1.0f32..1.0, 1..1024),
        chunk in 1usize..64,
        rates in proptest::sample::select(vec![(48_000,24_000),(44_100,24_000),(24_000,48_000),(48_000,48_000)]),
    ) {
        let mut whole = LinearResampler::new(rates.0, rates.1).unwrap();
        let mut expected = Vec::new();
        whole.process(&samples, &mut expected);
        let mut split = LinearResampler::new(rates.0, rates.1).unwrap();
        let mut actual = Vec::new();
        for input in samples.chunks(chunk) {
            split.process(&[], &mut actual);
            split.process(input, &mut actual);
        }
        proptest::prop_assert_eq!(actual.len(), expected.len());
        proptest::prop_assert!(actual.iter().zip(&expected).all(|(a,b)| (a-b).abs() < 0.0001));
        split.reset();
        actual.clear();
        split.process(&samples, &mut actual);
        assert_eq!(actual, expected);
    }
}
