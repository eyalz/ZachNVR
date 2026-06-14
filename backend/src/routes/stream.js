const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

const HLS_DIR = path.join(__dirname, '../../../hls-segments');

// GET /api/stream/:cameraId/status — check if HLS playlist exists
router.get('/:cameraId/status', (req, res) => {
  const playlist = path.join(HLS_DIR, req.params.cameraId, 'index.m3u8');
  res.json({
    ready: fs.existsSync(playlist),
    hlsUrl: `/hls/${req.params.cameraId}/index.m3u8`,
  });
});

module.exports = router;
