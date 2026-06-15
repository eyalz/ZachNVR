const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const discoveryRouter = require('./routes/discovery');
const camerasRouter = require('./routes/cameras');
const recordingsRouter = require('./routes/recordings');
const streamRouter = require('./routes/stream');
const chatRouter = require('./routes/chat');
const { isFrigateAvailable } = require('./frigate');
const { SNAPSHOT_DIR } = require('./snapshot');
const { getCameras } = require('./config');
const { startRecording } = require('./recorder');

const app = express();
const PORT = process.env.PORT || 3001;

// Ensure required directories exist
const RECORDINGS_DIR = path.join(__dirname, '../../recordings');
const HLS_DIR = path.join(__dirname, '../../hls-segments');
[RECORDINGS_DIR, HLS_DIR, SNAPSHOT_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

app.use(cors());
app.use(express.json());

// Serve HLS segments and recordings statically
app.use('/hls', express.static(HLS_DIR));
app.use('/recordings', express.static(RECORDINGS_DIR));
app.use('/snapshots', express.static(SNAPSHOT_DIR));

// API routes
app.use('/api/discovery', discoveryRouter);
app.use('/api/cameras', camerasRouter);
app.use('/api/recordings', recordingsRouter);
app.use('/api/stream', streamRouter);
app.use('/api/chat', chatRouter);

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.get('/api/frigate/status', async (_req, res) => {
  const available = await isFrigateAvailable();
  res.json({ 
    available,
    url: process.env.FRIGATE_URL || 'http://localhost:5000',
  });
});

app.listen(PORT, () => {
  console.log(`ZachNVR backend running on http://localhost:${PORT}`);

  if (typeof recordingsRouter.startBackgroundPrecompute === 'function') {
    recordingsRouter.startBackgroundPrecompute();
  }

  // Restore recording for cameras that are configured with record=true.
  getCameras()
    .filter(cam => cam.record)
    .forEach(cam => startRecording(cam));
});

module.exports = app;
