const express = require('express');
const router = express.Router();
const { discoverCameras } = require('../discovery');
const { upsertCamera, getCameras } = require('../config');
const { v4: uuidv4 } = require('uuid');

/**
 * POST /api/discovery/scan
 * Runs ONVIF WS-Discovery and merges results with saved config.
 */
router.post('/scan', async (_req, res) => {
  try {
    const discovered = await discoverCameras(5000);
    const existing = getCameras();

    // Merge: preserve saved settings (credentials, record flag) for known URNs
    const merged = discovered.map(cam => {
      const saved = existing.find(e => e.urn === cam.urn || e.xaddr === cam.xaddr);
      if (saved) {
        return { ...cam, id: saved.id, username: saved.username, password: saved.password, record: saved.record };
      }
      return cam;
    });

    // Upsert all discovered cameras into config
    merged.forEach(cam => upsertCamera(cam));

    res.json({ cameras: merged });
  } catch (err) {
    console.error('[Discovery] scan error:', err);
    res.status(500).json({ error: 'Discovery failed', detail: err.message });
  }
});

module.exports = router;
