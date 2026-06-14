/**
 * discovery.js — ONVIF WS-Discovery for finding cameras on the local network.
 * Uses the `onvif` npm package.
 */
const { Discovery, Cam } = require('onvif');
const { v4: uuidv4 } = require('uuid');

/**
 * Scan the local network using ONVIF WS-Discovery.
 * Returns an array of camera descriptors.
 */
function discoverCameras(timeoutMs = 5000) {
  return new Promise((resolve) => {
    const found = [];
    const pending = [];

    const timer = setTimeout(() => resolve(found), timeoutMs);

    try {
      Discovery.probe({ timeout: timeoutMs }, (err, cameras) => {
        if (err || !cameras || cameras.length === 0) {
          clearTimeout(timer);
          return resolve(found);
        }

        cameras.forEach((camInfo) => {
          const xaddr = Array.isArray(camInfo.xaddrs) ? camInfo.xaddrs[0] : camInfo.xaddrs;
          const promise = new Promise((res) => {
            const cam = new Cam({ hostname: '', xaddr }, function (err) {
              if (err) {
                found.push({
                  id: uuidv4(),
                  name: camInfo.name || camInfo.urn || 'ONVIF Camera',
                  xaddr,
                  urn: camInfo.urn,
                  rtspUrl: null,
                  username: '',
                  password: '',
                  record: false,
                  online: false,
                });
                return res();
              }

              // Try to get a stream URI from the first profile
              this.getStreamUri({ protocol: 'RTSP' }, (err2, stream) => {
                found.push({
                  id: uuidv4(),
                  name: camInfo.name || camInfo.urn || 'ONVIF Camera',
                  xaddr,
                  urn: camInfo.urn,
                  rtspUrl: err2 ? null : (stream && stream.uri ? stream.uri : null),
                  username: '',
                  password: '',
                  record: false,
                  online: true,
                });
                res();
              });
            });
          });
          pending.push(promise);
        });

        Promise.allSettled(pending).then(() => {
          clearTimeout(timer);
          resolve(found);
        });
      });
    } catch (_e) {
      clearTimeout(timer);
      resolve([]);
    }
  });
}

module.exports = { discoverCameras };
