/**
 * discovery.js — ONVIF WS-Discovery for finding cameras on the local network.
 * Uses the `onvif` npm package.
 */
const { Discovery, Cam } = require('onvif');
const { v4: uuidv4 } = require('uuid');
const { buildDefaultHikvisionRtspUrl, hostFromXAddr } = require('./rtspDefaults');

function toXAddr(camInfo) {
  if (!camInfo) return null;

  if (typeof camInfo.xaddr === 'string' && camInfo.xaddr) {
    return camInfo.xaddr;
  }

  if (Array.isArray(camInfo.xaddrs) && camInfo.xaddrs.length > 0) {
    const first = camInfo.xaddrs[0];
    if (typeof first === 'string') return first;
    if (first && typeof first.href === 'string') return first.href;
    if (first && first.protocol && first.hostname) {
      const port = first.port ? `:${first.port}` : '';
      return `${first.protocol}//${first.hostname}${port}${first.pathname || ''}`;
    }
  }

  if (camInfo.hostname) {
    const protocol = camInfo.protocol || 'http:';
    const port = camInfo.port ? `:${camInfo.port}` : '';
    return `${protocol}//${camInfo.hostname}${port}${camInfo.path || '/onvif/device_service'}`;
  }

  return null;
}

/**
 * Scan the local network using ONVIF WS-Discovery.
 * Returns an array of camera descriptors.
 */
function discoverCameras(timeoutMs = 5000) {
  return new Promise((resolve) => {
    const found = [];
    const pending = [];
    let resolved = false;
    const done = () => {
      if (resolved) return;
      resolved = true;
      resolve(found);
    };

    // Global safety timeout: discovery timeout + a small grace window for
    // per-camera profile/stream URI requests.
    const timer = setTimeout(done, timeoutMs + 7000);

    try {
      Discovery.probe({ timeout: timeoutMs }, (err, cameras) => {
        const hasCameras = Array.isArray(cameras) && cameras.length > 0;

        // Some networks return non-fatal WS-Discovery parse errors while still
        // discovering valid cameras. Keep the valid camera list when present.
        if (!hasCameras) {
          clearTimeout(timer);
          return done();
        }

        if (err) {
          console.warn('[Discovery] probe reported non-fatal errors:', err);
        }

        cameras.forEach((camInfo) => {
          const xaddr = toXAddr(camInfo);
          const promise = new Promise((res) => {
            try {
              const name = camInfo.name || camInfo.urn || camInfo.hostname || 'ONVIF Camera';
              const existingCam = camInfo && typeof camInfo.getStreamUri === 'function' ? camInfo : null;
              let settled = false;
              const resolveOnce = () => {
                if (settled) return;
                settled = true;
                res();
              };

              const finalize = (online, rtspUrl = null) => {
                const fallbackHost = hostFromXAddr(xaddr) || camInfo.hostname || '10.0.0.64';
                const resolvedRtspUrl = rtspUrl || buildDefaultHikvisionRtspUrl(fallbackHost);
                found.push({
                  id: uuidv4(),
                  name,
                  xaddr,
                  urn: camInfo.urn || null,
                  rtspUrl: resolvedRtspUrl,
                  username: '',
                  password: '',
                  record: false,
                  online,
                });
                resolveOnce();
              };

              // Some devices can be slow or not fully ONVIF-compliant for
              // getStreamUri; do not block the whole scan indefinitely.
              const perCameraTimeout = setTimeout(() => finalize(true, null), 5000);

              const finalizeWithCleanup = (online, rtspUrl = null) => {
                clearTimeout(perCameraTimeout);
                finalize(online, rtspUrl);
              };

              const withCam = (cam) => {
                try {
                  cam.getStreamUri({ protocol: 'RTSP' }, (err2, stream) => {
                    finalizeWithCleanup(true, err2 ? null : (stream && stream.uri ? stream.uri : null));
                  });
                } catch {
                  finalizeWithCleanup(true, null);
                }
              };

              if (existingCam) {
                return withCam(existingCam);
              }

              if (!xaddr) {
                return finalizeWithCleanup(false, null);
              }

              const cam = new Cam({ hostname: '', xaddr }, function (camErr) {
                if (camErr) {
                  clearTimeout(perCameraTimeout);
                  found.push({
                    id: uuidv4(),
                    name,
                    xaddr,
                    urn: camInfo.urn || null,
                    rtspUrl: buildDefaultHikvisionRtspUrl(hostFromXAddr(xaddr) || camInfo.hostname || '10.0.0.64'),
                    username: '',
                    password: '',
                    record: false,
                    online: true,
                  });
                  return resolveOnce();
                }

                withCam(this);
              });
            } catch {
              found.push({
                id: uuidv4(),
                name: camInfo?.name || camInfo?.hostname || 'ONVIF Camera',
                xaddr,
                urn: camInfo?.urn || null,
                rtspUrl: buildDefaultHikvisionRtspUrl(hostFromXAddr(xaddr) || camInfo?.hostname || '10.0.0.64'),
                username: '',
                password: '',
                record: false,
                online: true,
              });
              res();
            }
          });
          pending.push(promise);
        });

        Promise.allSettled(pending).then(() => {
          clearTimeout(timer);
          done();
        });
      });
    } catch (_e) {
      clearTimeout(timer);
      done();
    }
  });
}

module.exports = { discoverCameras };
