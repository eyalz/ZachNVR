const DEFAULT_RTSP_PORT = 554;
const HIKVISION_MAIN_STREAM_PATH = '/Streaming/channels/101';

function buildDefaultHikvisionRtspUrl(host = '10.0.0.64', port = DEFAULT_RTSP_PORT) {
  return `rtsp://${host}:${port}${HIKVISION_MAIN_STREAM_PATH}`;
}

function hostFromXAddr(xaddr) {
  if (!xaddr) return null;
  try {
    const url = new URL(xaddr);
    return url.hostname || null;
  } catch {
    return null;
  }
}

module.exports = {
  DEFAULT_RTSP_PORT,
  HIKVISION_MAIN_STREAM_PATH,
  buildDefaultHikvisionRtspUrl,
  hostFromXAddr,
};