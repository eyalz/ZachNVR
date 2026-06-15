const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { execFileSync, spawnSync } = require('child_process');
const { getFrigateRecordingStats, isFrigateAvailable } = require('../frigate');
const { getOrGenerateDescription, getCachedDescription } = require('../describer');

const RECORDINGS_DIR = path.join(__dirname, '../../../recordings');
const ANALYTICS_DIR = path.join(__dirname, '../../../recordings-analytics');
const MIN_PLAYABLE_BYTES = Number(process.env.MIN_PLAYABLE_RECORDING_BYTES || 1024 * 100); // 100KB
const FFPROBE_CANDIDATES = ['/opt/homebrew/bin/ffprobe', '/usr/local/bin/ffprobe'];
const FFMPEG_CANDIDATES = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'];
const FFPROBE_PATH = FFPROBE_CANDIDATES.find(p => fs.existsSync(p));
const FFMPEG_PATH = FFMPEG_CANDIDATES.find(p => fs.existsSync(p));
const PRECOMPUTE_INTERVAL_MS = Number(process.env.RECORDINGS_PRECOMPUTE_INTERVAL_MS || 5 * 60 * 1000);
const PRECOMPUTE_INITIAL_DELAY_MS = Number(process.env.RECORDINGS_PRECOMPUTE_INITIAL_DELAY_MS || 15000);
const PRECOMPUTE_YIELD_MS = Number(process.env.RECORDINGS_PRECOMPUTE_YIELD_MS || 100);

let precomputeRunning = false;
let precomputeTimer = null;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getRecordingPath(cameraId, filename) {
  const safeName = path.basename(filename || '');
  if (!safeName || !safeName.endsWith('.mp4')) return null;

  const filePath = path.resolve(path.join(RECORDINGS_DIR, cameraId, safeName));
  const expectedPrefix = path.resolve(path.join(RECORDINGS_DIR, cameraId)) + path.sep;
  if (!filePath.startsWith(expectedPrefix)) return null;
  return filePath;
}

function getDurationSeconds(filePath) {
  if (!FFPROBE_PATH) return 0;
  try {
    const output = execFileSync(
      FFPROBE_PATH,
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', filePath],
      { stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }
    ).toString().trim();

    const duration = Number(output);
    return Number.isFinite(duration) ? duration : 0;
  } catch {
    return 0;
  }
}

function extractSceneEvents(filePath) {
  if (!FFMPEG_PATH) return [];

  const result = spawnSync(
    FFMPEG_PATH,
    ['-hide_banner', '-i', filePath, '-vf', "select='gt(scene,0.35)',showinfo", '-f', 'null', '-'],
    { encoding: 'utf-8', timeout: 15000 }
  );

  const text = `${result.stdout || ''}\n${result.stderr || ''}`;
  const matches = text.match(/pts_time:([0-9]+(?:\.[0-9]+)?)/g) || [];
  return matches
    .map(m => Number(m.replace('pts_time:', '')))
    .filter(v => Number.isFinite(v))
    .map(t => ({ time: t, type: 'scene_change' }));
}

function buildMovementTimeline(duration, sceneEvents) {
  const binsCount = 96;
  const bins = Array.from({ length: binsCount }, () => 0);
  if (!duration || !sceneEvents.length) return bins;

  sceneEvents.forEach(evt => {
    const idx = Math.max(0, Math.min(binsCount - 1, Math.floor((evt.time / duration) * binsCount)));
    bins[idx] += 1;
  });

  const maxBin = Math.max(...bins, 1);
  return bins.map(v => Number((v / maxBin).toFixed(3)));
}

function getAnalyticsCachePath(cameraId, filename) {
  return path.join(ANALYTICS_DIR, cameraId, `${filename}.json`);
}

function readCachedAnalytics(cachePath, sourceMtimeMs) {
  if (!fs.existsSync(cachePath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    if (data.sourceMtimeMs !== sourceMtimeMs) return null;
    return data;
  } catch {
    return null;
  }
}

function writeCachedAnalytics(cachePath, payload) {
  ensureDir(path.dirname(cachePath));
  fs.writeFileSync(cachePath, JSON.stringify(payload, null, 2));
}

function analyzeRecording(cameraId, filename) {
  const filePath = getRecordingPath(cameraId, filename);
  if (!filePath || !fs.existsSync(filePath)) return null;

  const stat = fs.statSync(filePath);
  const cachePath = getAnalyticsCachePath(cameraId, filename);
  const cached = readCachedAnalytics(cachePath, stat.mtimeMs);
  if (cached) return cached;

  const duration = getDurationSeconds(filePath);
  const sceneEvents = extractSceneEvents(filePath);
  const payload = {
    cameraId,
    filename,
    duration,
    sceneEvents,
    movementTimeline: buildMovementTimeline(duration, sceneEvents),
    sourceMtimeMs: stat.mtimeMs,
    generatedAt: new Date().toISOString(),
  };

  writeCachedAnalytics(cachePath, payload);
  return payload;
}

function hasValidContainer(filePath) {
  if (!FFPROBE_PATH) return true;
  try {
    execFileSync(
      FFPROBE_PATH,
      ['-v', 'error', '-show_entries', 'format=format_name', '-of', 'default=nw=1:nk=1', filePath],
      { stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }
    );
    return true;
  } catch {
    return false;
  }
}

function isLikelyPlayableRecording(stat) {
  return !!stat && stat.size >= MIN_PLAYABLE_BYTES;
}

function readCameraRecordings(cameraId) {
  const dir = path.join(RECORDINGS_DIR, cameraId);
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.mp4'))
    .map(f => {
      const filePath = path.join(dir, f);
      const stat = fs.statSync(filePath);
      return {
        filePath,
        filename: f,
        url: `/recordings/${cameraId}/${f}`,
        size: stat.size,
        createdAt: stat.birthtime,
        mtime: stat.mtime,
      };
    })
    .filter(item => isLikelyPlayableRecording(item))
    .filter(item => hasValidContainer(item.filePath))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(({ mtime, filePath, ...rest }) => {
      const cachedDesc = getCachedDescription(cameraId, rest.filename);
      return {
        ...rest,
        description: cachedDesc?.description || '',
        descriptionGeneratedAt: cachedDesc?.generatedAt || null,
      };
    });
}

async function precomputeAllRecordingsOnce() {
  if (precomputeRunning) return;
  precomputeRunning = true;

  try {
    if (!fs.existsSync(RECORDINGS_DIR)) return;

    const cameraDirs = fs.readdirSync(RECORDINGS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    const tasks = [];
    for (const cameraId of cameraDirs) {
      const recordings = readCameraRecordings(cameraId);
      for (const rec of recordings) {
        tasks.push({ cameraId, filename: rec.filename });
      }
    }

    let processed = 0;
    for (const task of tasks) {
      const existing = getCachedDescription(task.cameraId, task.filename);
      if (existing?.description) continue;

      const analytics = analyzeRecording(task.cameraId, task.filename);
      if (!analytics) continue;

      try {
        await getOrGenerateDescription(task.cameraId, task.filename, analytics, `Camera ${task.cameraId}`);
        processed += 1;
      } catch (err) {
        console.error('[Precompute] Description generation failed:', task.cameraId, task.filename, err.message);
      }

      await new Promise(resolve => setTimeout(resolve, PRECOMPUTE_YIELD_MS));
    }

    if (processed > 0) {
      console.log(`[Precompute] Generated descriptions for ${processed} recordings`);
    }
  } finally {
    precomputeRunning = false;
  }
}

function startBackgroundPrecompute() {
  if (precomputeTimer) return;

  setTimeout(() => {
    precomputeAllRecordingsOnce().catch(err => {
      console.error('[Precompute] Initial run failed:', err.message);
    });
  }, PRECOMPUTE_INITIAL_DELAY_MS);

  precomputeTimer = setInterval(() => {
    precomputeAllRecordingsOnce().catch(err => {
      console.error('[Precompute] Scheduled run failed:', err.message);
    });
  }, PRECOMPUTE_INTERVAL_MS);

  if (typeof precomputeTimer.unref === 'function') {
    precomputeTimer.unref();
  }

  console.log(`[Precompute] Background worker started (initial delay ${PRECOMPUTE_INITIAL_DELAY_MS}ms, interval ${PRECOMPUTE_INTERVAL_MS}ms)`);
}

// GET /api/recordings — list all recordings grouped by camera
router.get('/', (_req, res) => {
  if (!fs.existsSync(RECORDINGS_DIR)) return res.json({ recordings: {} });

  const result = {};
  const cameraDirs = fs.readdirSync(RECORDINGS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  cameraDirs.forEach(cameraId => {
    result[cameraId] = readCameraRecordings(cameraId);
  });

  res.json({ recordings: result });
});

// GET /api/recordings/:cameraId — recordings for a specific camera
router.get('/:cameraId', (req, res) => {
  res.json({ recordings: readCameraRecordings(req.params.cameraId) });
});

// GET /api/recordings/:cameraId/:filename/analytics — scene/motion metadata for one recording
// Tries Frigate first, falls back to local analysis
// Also generates and caches video description using LLM
router.get('/:cameraId/:filename/analytics', async (req, res) => {
  const { cameraId, filename } = req.params;
  const decodedFilename = decodeURIComponent(filename);
  
  // Try Frigate first if available
  try {
    if (await isFrigateAvailable()) {
      const frigateStats = await getFrigateRecordingStats(cameraId, 0, Date.now() / 1000);
      if (frigateStats) {
        const analytics = {
          cameraId,
          filename: decodedFilename,
          source: 'frigate',
          duration: frigateStats.duration,
          movementTimeline: frigateStats.timeline,
          objectCounts: frigateStats.objectCounts,
          events: frigateStats.events,
          generatedAt: new Date().toISOString(),
        };
        
        // Generate description in background (don't wait)
        getOrGenerateDescription(cameraId, decodedFilename, analytics, `Camera ${cameraId}`)
          .catch(err => console.error('[Description] Generation error:', err.message));
        
        // Include cached description if available
        const cachedDesc = getCachedDescription(cameraId, decodedFilename);
        if (cachedDesc) {
          analytics.description = cachedDesc.description;
        }
        
        return res.json({ analytics });
      }
    }
  } catch (err) {
    console.log('[Analytics] Frigate unavailable, falling back to local analysis:', err.message);
  }
  
  // Fallback to local analysis
  const analytics = analyzeRecording(cameraId, decodedFilename);
  if (!analytics) return res.status(404).json({ error: 'Recording not found' });
  
  // Generate description in background (don't wait)
  getOrGenerateDescription(cameraId, decodedFilename, analytics, `Camera ${cameraId}`)
    .catch(err => console.error('[Description] Generation error:', err.message));
  
  // Include cached description if available
  const cachedDesc = getCachedDescription(cameraId, decodedFilename);
  if (cachedDesc) {
    analytics.description = cachedDesc.description;
  }
  
  res.json({ analytics });
});

router.startBackgroundPrecompute = startBackgroundPrecompute;
router.precomputeAllRecordingsOnce = precomputeAllRecordingsOnce;

module.exports = router;
