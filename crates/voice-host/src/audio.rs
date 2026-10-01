use crate::codex_audio::buffers::{BLOCK, CaptureBoundary, Frame, FramePacker};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};

#[derive(Clone)]
pub struct AudioFrames {
    pub queue: Arc<ArrayQueue<Frame>>,
    pub dropped: Arc<AtomicBool>,
    pub failed: Arc<AtomicBool>,
    pub generation: Arc<AtomicU64>,
}
impl AudioFrames {
    fn new(rate: u32) -> Self {
        Self {
            queue: Arc::new(ArrayQueue::new(rate as usize / BLOCK / 5 + 1)),
            dropped: Arc::new(AtomicBool::new(false)),
            failed: Arc::new(AtomicBool::new(false)),
            generation: Arc::new(AtomicU64::new(0)),
        }
    }
}

use anyhow::{Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{
    Device, ErrorKind, FromSample, Sample, SampleFormat, SizedSample, Stream, SupportedStreamConfig,
};
use crossbeam_queue::ArrayQueue;
use tokio::sync::mpsc;

use crate::levels::AudioPeak;
use crate::protocol::{AudioDevice, Event, MAX_DEVICE_BYTES, MAX_DEVICES};

const CAPTURE_QUEUE_MS: usize = 100;
const PLAYBACK_QUEUE_MS: usize = 500;
const PLAYBACK_START_MS: usize = 100;

pub struct Capture {
    pub frames: AudioFrames,
    _stream: Stream,
    pub samples: Arc<ArrayQueue<f32>>,
    pub sample_rate: u32,
    pub peak: Arc<AudioPeak>,
}

pub struct Playback {
    pub rendered: AudioFrames,
    _stream: Stream,
    pub samples: Arc<ArrayQueue<f32>>,
    pub sample_rate: u32,
    pub peak: Arc<AudioPeak>,
}

pub fn devices() -> Result<(Vec<AudioDevice>, Vec<AudioDevice>)> {
    let host = cpal::default_host();
    let default_input_id = host
        .default_input_device()
        .and_then(|device| device.id().ok());
    let default_output_id = host
        .default_output_device()
        .and_then(|device| device.id().ok());
    let inputs = host
        .input_devices()?
        .filter_map(|device| describe_device(&device, default_input_id.as_ref()))
        .take(MAX_DEVICES)
        .collect();
    let outputs = host
        .output_devices()?
        .filter_map(|device| describe_device(&device, default_output_id.as_ref()))
        .take(MAX_DEVICES)
        .collect();
    Ok((inputs, outputs))
}

fn describe_device(device: &Device, default_id: Option<&cpal::DeviceId>) -> Option<AudioDevice> {
    let id = device.id().ok()?;
    let id = id.to_string();
    if id.len() > MAX_DEVICE_BYTES {
        return None;
    }
    let mut name = device
        .description()
        .map_or_else(|_| id.clone(), |description| description.name().to_owned());
    while name.len() > MAX_DEVICE_BYTES {
        name.pop();
    }
    Some(AudioDevice {
        is_default: default_id.is_some_and(|candidate| candidate.to_string() == id),
        name,
        id,
    })
}

pub fn capture(device_id: Option<&str>) -> Result<Capture> {
    let host = cpal::default_host();
    if let Some(id) = device_id {
        let device = host
            .input_devices()?
            .find(|device| {
                device
                    .id()
                    .is_ok_and(|candidate| candidate.to_string() == id)
            })
            .context("no microphone device available")?;
        return capture_device(&device);
    }
    let device = host
        .default_input_device()
        .context("no default microphone configured")?;
    capture_device(&device).context("failed to open the default microphone")
}

fn capture_device(device: &Device) -> Result<Capture> {
    let supported = device
        .default_input_config()
        .context("microphone has no default input format")?;
    let sample_rate = supported.sample_rate();
    let samples = Arc::new(ArrayQueue::new(
        sample_rate as usize * CAPTURE_QUEUE_MS / 1_000,
    ));
    let peak = Arc::new(AudioPeak::default());
    let frames = AudioFrames::new(sample_rate);
    let stream = build_input_stream(
        device,
        &supported,
        Arc::clone(&samples),
        Arc::clone(&peak),
        frames.clone(),
    )?;
    stream.play().context("failed to start microphone")?;
    Ok(Capture {
        frames,
        _stream: stream,
        samples,
        sample_rate,
        peak,
    })
}

pub fn playback(device_id: Option<&str>, events: mpsc::Sender<Event>) -> Result<Playback> {
    let host = cpal::default_host();
    if let Some(id) = device_id {
        let device = host
            .output_devices()?
            .find(|device| {
                device
                    .id()
                    .is_ok_and(|candidate| candidate.to_string() == id)
            })
            .context("no speaker device available")?;
        return playback_device(&device, events);
    }
    let device = host
        .default_output_device()
        .context("no default speaker configured")?;
    playback_device(&device, events).context("failed to open the default speaker")
}

fn playback_device(device: &Device, events: mpsc::Sender<Event>) -> Result<Playback> {
    let supported = device
        .default_output_config()
        .context("speaker has no default output format")?;
    let sample_rate = supported.sample_rate();
    let samples = Arc::new(ArrayQueue::new(
        sample_rate as usize * PLAYBACK_QUEUE_MS / 1_000,
    ));
    let peak = Arc::new(AudioPeak::default());
    let rendered = AudioFrames::new(sample_rate);
    let stream = build_output_stream(
        device,
        &supported,
        Arc::clone(&samples),
        Arc::clone(&peak),
        events,
        rendered.clone(),
    )?;
    stream.play().context("failed to start speaker")?;
    Ok(Playback {
        rendered,
        _stream: stream,
        samples,
        sample_rate,
        peak,
    })
}

fn build_input_stream(
    device: &Device,
    supported: &SupportedStreamConfig,
    queue: Arc<ArrayQueue<f32>>,
    peak: Arc<AudioPeak>,
    frames: AudioFrames,
) -> Result<Stream> {
    let channels = supported.channels() as usize;
    let config = (*supported).into();
    let stream = match supported.sample_format() {
        SampleFormat::F32 => input_stream::<f32>(device, &config, channels, queue, peak, frames),
        SampleFormat::I16 => input_stream::<i16>(device, &config, channels, queue, peak, frames),
        SampleFormat::U16 => input_stream::<u16>(device, &config, channels, queue, peak, frames),
        format => anyhow::bail!("unsupported microphone sample format {format}"),
    }?;
    Ok(stream)
}

fn input_stream<T>(
    device: &Device,
    config: &cpal::StreamConfig,
    channels: usize,
    queue: Arc<ArrayQueue<f32>>,
    peak: Arc<AudioPeak>,
    frames: AudioFrames,
) -> Result<Stream, cpal::Error>
where
    T: SizedSample,
    f32: FromSample<T>,
{
    let rate = f64::from(config.sample_rate);
    let mut capture = FramePacker::default();
    let mut boundary = CaptureBoundary::default();
    let mut origin = None;
    let failure = Arc::clone(&frames.failed);
    device.build_input_stream(
        *config,
        move |input: &[T], info: &cpal::InputCallbackInfo| {
            let current = frames.generation.load(Ordering::Acquire);
            let timestamp = info.timestamp();
            let origin = origin.get_or_insert(timestamp.capture);
            let accepted = match (
                timestamp.callback.checked_duration_since(*origin),
                timestamp.capture.checked_duration_since(*origin),
            ) {
                (Some(callback), Some(captured)) => boundary.accepts(current, callback, captured),
                _ => false,
            };
            let start = Instant::now()
                .checked_sub(
                    timestamp
                        .callback
                        .checked_duration_since(timestamp.capture)
                        .unwrap_or_default(),
                )
                .unwrap_or_else(Instant::now);
            if !accepted {
                capture.reset();
            }
            capture.discard_capture_gap(start, rate);
            let mut amplitude = 0_f32;
            for (index, chunk) in input.chunks(BLOCK * channels).enumerate() {
                let mut frame = Frame {
                    samples: [0.0; BLOCK],
                    len: chunk.len() / channels,
                    at: start + Duration::from_secs_f64((index * BLOCK) as f64 / rate),
                    generation: current,
                };
                for (output, source) in frame.samples.iter_mut().zip(chunk.chunks_exact(channels)) {
                    *output =
                        source.iter().copied().map(f32::from_sample).sum::<f32>() / channels as f32;
                    if !output.is_finite() {
                        failure.store(true, Ordering::Release);
                        capture.reset();
                        return;
                    }
                    amplitude = amplitude.max(output.abs());
                    push_latest(&queue, *output);
                }
                if accepted && !capture.push(&frame, rate, &frames.queue) {
                    capture.reset();
                    frames.dropped.store(true, Ordering::Release);
                }
            }
            peak.record(amplitude);
        },
        move |error| {
            eprintln!("microphone stream error: {error}");
            if error.kind() != ErrorKind::Xrun {
                frames.failed.store(true, Ordering::Release);
            }
        },
        None,
    )
}

fn build_output_stream(
    device: &Device,
    supported: &SupportedStreamConfig,
    queue: Arc<ArrayQueue<f32>>,
    peak: Arc<AudioPeak>,
    events: mpsc::Sender<Event>,
    rendered: AudioFrames,
) -> Result<Stream> {
    let channels = supported.channels() as usize;
    let config = (*supported).into();
    let stream = match supported.sample_format() {
        SampleFormat::F32 => {
            output_stream::<f32>(device, &config, channels, queue, peak, events, rendered)
        }
        SampleFormat::I16 => {
            output_stream::<i16>(device, &config, channels, queue, peak, events, rendered)
        }
        SampleFormat::U16 => {
            output_stream::<u16>(device, &config, channels, queue, peak, events, rendered)
        }
        format => anyhow::bail!("unsupported speaker sample format {format}"),
    }?;
    Ok(stream)
}

fn output_stream<T>(
    device: &Device,
    config: &cpal::StreamConfig,
    channels: usize,
    queue: Arc<ArrayQueue<f32>>,
    peak: Arc<AudioPeak>,
    events: mpsc::Sender<Event>,
    rendered: AudioFrames,
) -> Result<Stream, cpal::Error>
where
    T: SizedSample + FromSample<f32>,
    f32: FromSample<T>,
{
    let start_samples = config.sample_rate as usize * PLAYBACK_START_MS / 1_000;
    let mut playing = false;
    let mut error_reported = false;
    let rate = f64::from(config.sample_rate);
    let mut reference = FramePacker::default();
    device.build_output_stream(
        *config,
        move |output: &mut [T], info: &cpal::OutputCallbackInfo| {
            let timestamp = info.timestamp();
            let start = Instant::now()
                + timestamp
                    .playback
                    .checked_duration_since(timestamp.callback)
                    .unwrap_or_default();
            let mut amplitude = 0_f32;
            for (index, chunk) in output.chunks_mut(BLOCK * channels).enumerate() {
                let mut frame = Frame {
                    samples: [0.0; BLOCK],
                    len: chunk.len() / channels,
                    at: start + Duration::from_secs_f64((index * BLOCK) as f64 / rate),
                    generation: 0,
                };
                for (output, reference_sample) in
                    chunk.chunks_exact_mut(channels).zip(&mut frame.samples)
                {
                    if !playing && queue.len() >= start_samples {
                        playing = true;
                    }
                    let sample = if playing {
                        queue.pop().unwrap_or_else(|| {
                            playing = false;
                            0.0
                        })
                    } else {
                        0.0
                    };
                    let sample = if sample.is_finite() {
                        sample.clamp(-1.0, 1.0)
                    } else {
                        0.0
                    };
                    let actual = T::from_sample(sample);
                    output.fill(actual);
                    *reference_sample = f32::from_sample(actual);
                    amplitude = amplitude.max(sample.abs());
                }
                if !reference.push(&frame, rate, &rendered.queue) {
                    reference.reset();
                    rendered.dropped.store(true, Ordering::Release);
                }
            }
            peak.record(amplitude);
        },
        move |error| {
            eprintln!("speaker stream error: {error}");
            if error.kind() != ErrorKind::DeviceChanged && !error_reported {
                error_reported = true;
                let _ = events.try_send(Event::Error {
                    message: format!("speaker stream error: {error}"),
                });
            }
        },
        None,
    )
}

pub fn push_latest(queue: &ArrayQueue<f32>, sample: f32) {
    if queue.push(sample).is_err() {
        let _ = queue.pop();
        let _ = queue.push(sample);
    }
}

pub fn drain(queue: &ArrayQueue<f32>, limit: usize, output: &mut Vec<f32>) {
    for _ in 0..limit {
        let Some(sample) = queue.pop() else { break };
        output.push(sample);
    }
}
