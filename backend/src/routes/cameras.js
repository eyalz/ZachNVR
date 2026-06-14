const express = require('express');
const router = express.Router();
const { getCameras, updateCamera, removeCamera, upsertCamera } = require('../config');
const { startRecording, stopRecording, startHls, stopHls, isHlsActive, isRecordingActive } = require('../recorder');
const { v4: uuidv4 } = require('uuid');

// GET /api/cameras — list all saved cameras with live status
router.get('/', (_req, res) => {
  const cameras = getCameras().map(cam => ({
    ...cam,
    hlsActive: isHlsActive(cam.id),
    recordingActive: isRecordingActive(cam.id),
  }));
  res.json({ cameras });
});

// POST /api/cameras — add a camera manually (with RTSP URL)
router.post('/', (req, res) => {
  const { name, rtspUrl, username = '', password = '' } = req.body;
  if (!rtspUrl) return res.status(400).json({ error: 'rtspUrl is required' });
  const camera = { id: uuidv4(), name: name || 'Manual Camera', rtspUrl, username, password, record: false, online: true, xaddr: null, urn: null };
  upsertCamera(camera);
  res.status(201).json({ camera });
});

// PATCH /api/cameras/:id — update settings (credentials, record flag, name)
router.patch('/:id', (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  const camera = updateCamera(id, updates);
  if (!camera) return res.status(404).json({ error: 'Camera not found' });

  // Start/stop recording based on record flag change
  if ('record' in updates) {
    if (updates.record) {
      startRecording(camera);
    } else {
      stopRecording(id);
    }
  }

  res.json({ camera });
});

// DELETE /api/cameras/:id
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  stopRecording(id);
  stopHls(id);
  removeCamera(id);
  res.json({ success: true });
});

// POST /api/cameras/:id/live/start — begin HLS stream for live view
router.post('/:id/live/start', (req, res) => {
  const cameras = getCameras();
  const camera = cameras.find(c => c.id === req.params.id);
  if (!camera) return res.status(404).json({ error: 'Camera not found' });
  startHls(camera);
  res.json({ hlsUrl: `/hls/${camera.id}/index.m3u8` });
});

// POST /api/cameras/:id/live/stop
router.post('/:id/live/stop', (req, res) => {
  stopHls(req.params.id);
  res.json({ success: true });
});

module.exports = router;
