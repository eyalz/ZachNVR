/**
 * recorder.js — Manages FFmpeg processes for recording and HLS streaming.
 *
 * Recording: RTSP → MP4 files in /recordings/<cameraId>/
 * Live HLS:  RTSP → HLS segments in /hls-segments/<cameraId>/
 */
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const { getCameras } = require('./config');

const FFMPEG_CANDIDATES = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'];
for (const candidate of FFMPEG_CANDIDATES) {
  if (fs.existsSync(candidate)) {
    ffmpeg.setFfmpegPath(candidate);
    break;
  }
}

const MOTION_ONLY_RECORDING = process.env.MOTION_ONLY_RECORDING !== 'false';

const RECORDINGS_DIR = path.join(__dirname, '../../recordings');
const HLS_DIR = path.join(__dirname, '../../hls-segments');

// Active FFmpeg processes: { cameraId: { record: FfmpegCommand|null, hls: FfmpegCommand|null } }
const processes = {};
const restartTimers = {};
const RECORDING_RESTART_DELAY_MS = Number(process.env.RECORDING_RESTART_DELAY_MS || 5000);

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function buildRtspUrl(camera) {
  if (!camera.rtspUrl) return null;
  try {
    const url = new URL(camera.rtspUrl);
    if (camera.username) url.username = camera.username;
    if (camera.password) url.password = camera.password;
    return url.toString();
  } catch {
    return camera.rtspUrl;
  }
}

function getCameraById(cameraId) {
  return getCameras().find(cam => cam.id === cameraId) || null;
}

function shouldRecordCamera(cameraId) {
  const camera = getCameraById(cameraId);
  return !!(camera && camera.record && camera.rtspUrl);
}

function clearRestartTimer(cameraId) {
  if (!restartTimers[cameraId]) return;
  clearTimeout(restartTimers[cameraId]);
  delete restartTimers[cameraId];
}

function scheduleRecordingRestart(cameraId) {
  if (restartTimers[cameraId]) return;
  restartTimers[cameraId] = setTimeout(() => {
    delete restartTimers[cameraId];
    if (!shouldRecordCamera(cameraId)) return;
    const camera = getCameraById(cameraId);
    if (!camera) return;
    startRecording(camera);
  }, RECORDING_RESTART_DELAY_MS);
}

// ── HLS Live Streaming ────────────────────────────────────────────────────────

function startHls(camera) {
  if (!camera.rtspUrl) return;
  if (processes[camera.id]?.hls) return; // already running

  const hlsDir = path.join(HLS_DIR, camera.id);
  ensureDir(hlsDir);

  const playlistPath = path.join(hlsDir, 'index.m3u8');
  const rtspUrl = buildRtspUrl(camera);

  const cmd = ffmpeg(rtspUrl)
    .inputOptions(['-rtsp_transport tcp', '-re'])
    .outputOptions([
      '-c:v copy',
      '-c:a aac',
      '-f hls',
      '-hls_time 2',
      '-hls_list_size 5',
      '-hls_flags delete_segments+append_list',
    ])
    .output(playlistPath)
    .on('error', (err) => {
      if (!err.message.includes('SIGKILL')) {
        console.error(`[HLS] Camera ${camera.id} error:`, err.message);
      }
      if (processes[camera.id]) processes[camera.id].hls = null;
    })
    .on('end', () => {
      if (processes[camera.id]) processes[camera.id].hls = null;
    });

  if (!processes[camera.id]) processes[camera.id] = {};
  processes[camera.id].hls = cmd;
  cmd.run();
  console.log(`[HLS] Started for camera ${camera.id}`);
}

function stopHls(cameraId) {
  const proc = processes[cameraId]?.hls;
  if (proc) {
    proc.kill('SIGKILL');
    processes[cameraId].hls = null;
    console.log(`[HLS] Stopped for camera ${cameraId}`);
  }
}

// ── Recording ─────────────────────────────────────────────────────────────────

function startRecording(camera) {
  if (!camera.rtspUrl) return;
  if (processes[camera.id]?.record) return;
  clearRestartTimer(camera.id);

  const recDir = path.join(RECORDINGS_DIR, camera.id);
  ensureDir(recDir);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = path.join(recDir, `${timestamp}.mp4`);
  const rtspUrl = buildRtspUrl(camera);

  const outputOptions = MOTION_ONLY_RECORDING
    ? [
      // Drop near-duplicate frames so output keeps only changes.
      // When no motion happens, very few frames are written.
      '-map 0:v:0',
      '-map 0:a:0?',
      '-vf mpdecimate=hi=768:lo=320:frac=0.1',
      '-fps_mode vfr',
      '-c:v libx264',
      '-preset veryfast',
      '-crf 24',
      '-c:a aac',
      '-b:a 128k',
      '-movflags +frag_keyframe+empty_moov+default_base_moof',
    ]
    : [
      '-map 0:v:0',
      '-map 0:a:0?',
      '-c:v copy',
      '-c:a aac',
      '-b:a 128k',
      '-movflags +frag_keyframe+empty_moov+default_base_moof',
    ];

  const cmd = ffmpeg(rtspUrl)
    .inputOptions(['-rtsp_transport tcp'])
    .outputOptions(outputOptions)
    .output(outputPath)
    .on('error', (err) => {
      if (!err.message.includes('SIGKILL')) {
        console.error(`[REC] Camera ${camera.id} error:`, err.message);
        scheduleRecordingRestart(camera.id);
      }
      if (processes[camera.id]) processes[camera.id].record = null;
    })
    .on('end', () => {
      if (processes[camera.id]) processes[camera.id].record = null;
      if (shouldRecordCamera(camera.id)) {
        scheduleRecordingRestart(camera.id);
      }
    });

  if (!processes[camera.id]) processes[camera.id] = {};
  processes[camera.id].record = cmd;
  cmd.run();
  console.log(`[REC] Started for camera ${camera.id} → ${outputPath}`);
}

function stopRecording(cameraId) {
  const proc = processes[cameraId]?.record;
  clearRestartTimer(cameraId);
  if (proc) {
    proc.kill('SIGKILL');
    processes[cameraId].record = null;
    console.log(`[REC] Stopped for camera ${cameraId}`);
  }
}

function isHlsActive(cameraId) {
  return !!processes[cameraId]?.hls;
}

function isRecordingActive(cameraId) {
  return !!processes[cameraId]?.record;
}

module.exports = { startHls, stopHls, startRecording, stopRecording, isHlsActive, isRecordingActive };
