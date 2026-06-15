/**
 * captureUtils.js — Screenshot capture from video elements
 */

export function captureVideoFrame(videoElement, quality = 0.95) {
  /**
   * Capture current frame from video element as canvas
   * Returns: { canvas, timestamp, blob (promise) }
   */
  if (!videoElement) return null;
  
  const canvas = document.createElement('canvas');
  canvas.width = videoElement.videoWidth || videoElement.width || 1280;
  canvas.height = videoElement.videoHeight || videoElement.height || 720;
  
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  
  ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
  
  const timestamp = new Date();
  const blobPromise = new Promise(resolve => {
    canvas.toBlob(resolve, 'image/jpeg', quality);
  });
  
  return {
    canvas,
    timestamp,
    blob: blobPromise,
  };
}

export function downloadScreenshot(blob, filename) {
  /**
   * Download blob as file
   */
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function generateScreenshotFilename(cameraName = 'capture', timestamp = null) {
  /**
   * Generate filename: camera_YYYYMMDD_HHMMSS.jpg
   */
  const ts = timestamp instanceof Date ? timestamp : new Date();
  const year = ts.getFullYear();
  const month = String(ts.getMonth() + 1).padStart(2, '0');
  const day = String(ts.getDate()).padStart(2, '0');
  const hours = String(ts.getHours()).padStart(2, '0');
  const mins = String(ts.getMinutes()).padStart(2, '0');
  const secs = String(ts.getSeconds()).padStart(2, '0');
  
  const sanitized = (cameraName || 'capture').replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
  return `${sanitized}_${year}${month}${day}_${hours}${mins}${secs}.jpg`;
}

export function captureAndDownload(videoElement, cameraName) {
  /**
   * Capture frame and immediately download
   */
  const capture = captureVideoFrame(videoElement);
  if (!capture) return false;
  
  const filename = generateScreenshotFilename(cameraName, capture.timestamp);
  capture.blob.then(blob => {
    downloadScreenshot(blob, filename);
  });
  
  return true;
}
