const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const discoveryRouter = require('./routes/discovery');
const camerasRouter = require('./routes/cameras');
const recordingsRouter = require('./routes/recordings');
const streamRouter = require('./routes/stream');

const app = express();
const PORT = process.env.PORT || 3001;

// Ensure required directories exist
const RECORDINGS_DIR = path.join(__dirname, '../../recordings');
const HLS_DIR = path.join(__dirname, '../../hls-segments');
[RECORDINGS_DIR, HLS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

app.use(cors());
app.use(express.json());

// Serve HLS segments and recordings statically
app.use('/hls', express.static(HLS_DIR));
app.use('/recordings', express.static(RECORDINGS_DIR));

// API routes
app.use('/api/discovery', discoveryRouter);
app.use('/api/cameras', camerasRouter);
app.use('/api/recordings', recordingsRouter);
app.use('/api/stream', streamRouter);

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`ZachNVR backend running on http://localhost:${PORT}`);
});

module.exports = app;
