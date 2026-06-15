const express = require('express');
const router = express.Router();
const { discoverCameras } = require('../discovery');
const { upsertCamera, getCameras, removeCamera } = require('../config');

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
      const saved = existing.find(e => {
        const sameUrn = cam.urn && e.urn && e.urn === cam.urn;
        const sameXaddr = cam.xaddr && e.xaddr && e.xaddr === cam.xaddr;
        return sameUrn || sameXaddr;
      });
      if (saved) {
        const preferredName = (saved.name || '').trim() ? saved.name : cam.name;
        return {
          ...saved,
          ...cam,
          id: saved.id,
          name: preferredName,
          username: saved.username,
          password: saved.password,
          record: saved.record,
        };
      }
      return cam;
    });

    // Upsert all discovered cameras into config
    merged.forEach(cam => upsertCamera(cam));

    // Cleanup stale duplicates that share the same discovery identity (xaddr/urn)
    // but were not part of the current merged set.
    const mergedIds = new Set(merged.map(c => c.id));
    const mergedXaddrs = new Set(merged.map(c => c.xaddr).filter(Boolean));
    const mergedUrns = new Set(merged.map(c => c.urn).filter(Boolean));
    existing.forEach(saved => {
      const sameDiscoveryTarget = (saved.xaddr && mergedXaddrs.has(saved.xaddr))
        || (saved.urn && mergedUrns.has(saved.urn));
      if (sameDiscoveryTarget && !mergedIds.has(saved.id)) {
        removeCamera(saved.id);
      }
    });

    res.json({ cameras: merged });
  } catch (err) {
    console.error('[Discovery] scan error:', err);
    res.status(500).json({ error: 'Discovery failed', detail: err.message });
  }
});

module.exports = router;
