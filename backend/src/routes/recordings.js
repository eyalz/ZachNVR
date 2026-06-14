const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

const RECORDINGS_DIR = path.join(__dirname, '../../../recordings');

// GET /api/recordings — list all recordings grouped by camera
router.get('/', (_req, res) => {
  if (!fs.existsSync(RECORDINGS_DIR)) return res.json({ recordings: {} });

  const result = {};
  const cameraDirs = fs.readdirSync(RECORDINGS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  cameraDirs.forEach(cameraId => {
    const dir = path.join(RECORDINGS_DIR, cameraId);
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.mp4'))
      .map(f => {
        const filePath = path.join(dir, f);
        const stat = fs.statSync(filePath);
        return {
          filename: f,
          url: `/recordings/${cameraId}/${f}`,
          size: stat.size,
          createdAt: stat.birthtime,
        };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    result[cameraId] = files;
  });

  res.json({ recordings: result });
});

// GET /api/recordings/:cameraId — recordings for a specific camera
router.get('/:cameraId', (req, res) => {
  const dir = path.join(RECORDINGS_DIR, req.params.cameraId);
  if (!fs.existsSync(dir)) return res.json({ recordings: [] });

  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.mp4'))
    .map(f => {
      const filePath = path.join(dir, f);
      const stat = fs.statSync(filePath);
      return {
        filename: f,
        url: `/recordings/${req.params.cameraId}/${f}`,
        size: stat.size,
        createdAt: stat.birthtime,
      };
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.json({ recordings: files });
});

module.exports = router;
