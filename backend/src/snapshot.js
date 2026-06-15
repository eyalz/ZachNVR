const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const SNAPSHOT_DIR = path.join(__dirname, '../../hls-segments/snapshots');
const SNAPSHOT_CACHE_MS = Number(process.env.SNAPSHOT_CACHE_MS || 10000);
const FFMPEG_CANDIDATES = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', 'ffmpeg'];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function resolveFfmpegPath() {
  for (const candidate of FFMPEG_CANDIDATES) {
    if (candidate === 'ffmpeg') return candidate;
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'ffmpeg';
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

function getSnapshotPath(cameraId) {
  ensureDir(SNAPSHOT_DIR);
  return path.join(SNAPSHOT_DIR, `${cameraId}.jpg`);
}

function isFreshSnapshot(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const stat = fs.statSync(filePath);
  return Date.now() - new Date(stat.mtime).getTime() <= SNAPSHOT_CACHE_MS;
}

function captureFrame(rtspUrl, outputPath) {
  return new Promise((resolve, reject) => {
    const ffmpegPath = resolveFfmpegPath();
    const args = [
      '-y',
      '-rtsp_transport', 'tcp',
      '-i', rtspUrl,
      '-frames:v', '1',
      '-q:v', '2',
      outputPath,
    ];

    execFile(ffmpegPath, args, { timeout: 12000, windowsHide: true }, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

async function getCameraSnapshot(camera) {
  const rtspUrl = buildRtspUrl(camera);
  if (!rtspUrl) throw new Error('Missing RTSP URL');

  const outputPath = getSnapshotPath(camera.id);
  if (!isFreshSnapshot(outputPath)) {
    await captureFrame(rtspUrl, outputPath);
  }

  const ts = fs.existsSync(outputPath) ? fs.statSync(outputPath).mtimeMs : Date.now();
  return `/snapshots/${camera.id}.jpg?t=${Math.floor(ts)}`;
}

module.exports = { SNAPSHOT_DIR, getCameraSnapshot };
