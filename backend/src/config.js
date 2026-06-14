/**
 * config.js — Persistent JSON store for camera configuration.
 * Stores the list of discovered cameras and their recording preferences.
 */
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '../../config.json');

function load() {
  if (!fs.existsSync(CONFIG_PATH)) return { cameras: [] };
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return { cameras: [] };
  }
}

function save(data) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2));
}

function getCameras() {
  return load().cameras;
}

function upsertCamera(camera) {
  const config = load();
  const idx = config.cameras.findIndex(c => c.id === camera.id);
  if (idx >= 0) {
    config.cameras[idx] = { ...config.cameras[idx], ...camera };
  } else {
    config.cameras.push(camera);
  }
  save(config);
  return config.cameras.find(c => c.id === camera.id);
}

function removeCamera(id) {
  const config = load();
  config.cameras = config.cameras.filter(c => c.id !== id);
  save(config);
}

function updateCamera(id, updates) {
  const config = load();
  const idx = config.cameras.findIndex(c => c.id === id);
  if (idx < 0) return null;
  config.cameras[idx] = { ...config.cameras[idx], ...updates };
  save(config);
  return config.cameras[idx];
}

module.exports = { getCameras, upsertCamera, removeCamera, updateCamera };
