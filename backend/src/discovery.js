/**
 * discovery.js — ONVIF WS-Discovery for finding cameras on the local network.
 */
const onvif = require('node-onvif');
const { v4: uuidv4 } = require('uuid');

/**
 * Scan the local network using ONVIF WS-Discovery.
 * Returns an array of camera descriptors.
 */
async function discoverCameras(timeoutMs = 5000) {
  return new Promise((resolve) => {
    const found = [];

    try {
      onvif.startProbe().then((deviceList) => {
        const promises = deviceList.map(async (info) => {
          try {
            const device = new onvif.OnvifDevice({ xaddr: info.xaddrs[0] });
            await device.init();
            const profiles = device.getProfileList();
            const streamUri = profiles.length > 0
              ? await device.getUdpStreamUri(profiles[0].token).catch(() => null)
              : null;

            const rtspUrl = streamUri ? streamUri.uri : null;

            found.push({
              id: uuidv4(),
              name: info.name || info.urn || 'ONVIF Camera',
              xaddr: info.xaddrs[0],
              urn: info.urn,
              rtspUrl,
              username: '',
              password: '',
              record: false,
              online: true,
            });
          } catch (_err) {
            // Device init failed — still record basic info
            found.push({
              id: uuidv4(),
              name: info.name || info.urn || 'ONVIF Camera',
              xaddr: info.xaddrs[0],
              urn: info.urn,
              rtspUrl: null,
              username: '',
              password: '',
              record: false,
              online: false,
            });
          }
        });

        Promise.allSettled(promises).then(() => resolve(found));
      }).catch(() => resolve([]));
    } catch (_e) {
      resolve([]);
    }

    // Hard timeout fallback
    setTimeout(() => resolve(found), timeoutMs + 1000);
  });
}

module.exports = { discoverCameras };
