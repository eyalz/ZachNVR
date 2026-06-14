/**
 * recorder.js — Manages FFmpeg processes for recording and HLS streaming.
 *
 * Recording: RTSP → MP4 files in /recordings/<cameraId>/
 * Live HLS:  RTSP → HLS segments in /hls-segments/<cameraId>/
 */
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');

const RECORDINGS_DIR = path.join(__dirname, '../../recordings');
const HLS_DIR = path.join(__dirname, '../../hls-segments');

// Active FFmpeg processes: { cameraId: { record: FfmpegCommand|null, hls: FfmpegCommand|null } }
const processes = {};

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

  const recDir = path.join(RECORDINGS_DIR, camera.id);
  ensureDir(recDir);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = path.join(recDir, `${timestamp}.mp4`);
  const rtspUrl = buildRtspUrl(camera);

  const cmd = ffmpeg(rtspUrl)
    .inputOptions(['-rtsp_transport tcp'])
    .outputOptions(['-c copy', '-movflags +faststart'])
    .output(outputPath)
    .on('error', (err) => {
      if (!err.message.includes('SIGKILL')) {
        console.error(`[REC] Camera ${camera.id} error:`, err.message);
      }
      if (processes[camera.id]) processes[camera.id].record = null;
    })
    .on('end', () => {
      if (processes[camera.id]) processes[camera.id].record = null;
    });

  if (!processes[camera.id]) processes[camera.id] = {};
  processes[camera.id].record = cmd;
  cmd.run();
  console.log(`[REC] Started for camera ${camera.id} → ${outputPath}`);
}

function stopRecording(cameraId) {
  const proc = processes[cameraId]?.record;
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
