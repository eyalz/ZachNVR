import { useEffect, useRef, useCallback, forwardRef } from 'react';
import Hls from 'hls.js';

let cocoModelPromise = null;
let faceApiPromise = null;

const DETECTION_LIMIT = 20;
const PERSON_THRESHOLD = 0.5;
const DOG_THRESHOLD = 0.28;
const DOG_SOFT_THRESHOLD = 0.14;
const DOG_STABILITY_WINDOW = 3;
const DOG_STABILITY_REQUIRED = 2;
const LIVE_FACE_INPUT_SIZE = 512;
const LIVE_FACE_SCORE_THRESHOLD = 0.16;
const LIVE_FACE_MIN_BOX = 22;
const LIVE_FACE_MAX_ASPECT_RATIO = 1.8;
const LIVE_FACE_MIN_ASPECT_RATIO = 0.55;
const LIVE_FACE_CONFIRM_IOU = 0.18;

function toErrorMessage(prefix, err) {
  const message = err && typeof err === 'object' && 'message' in err ? err.message : String(err || 'Unknown error');
  return `${prefix}: ${message}`;
}

function buildLiveSubtitle({ people, dogs, faces, motion, hasTv, hasCouch }) {
  if (people > 0 && hasTv && hasCouch) {
    return people === 1
      ? 'A person is sitting on a sofa watching TV.'
      : `${people} people are sitting on the sofa watching TV.`;
  }

  if (people > 0 && dogs > 0) {
    return dogs === 1
      ? 'A person and a dog are in the room.'
      : `A person and ${dogs} dogs are in the room.`;
  }

  if (people > 0) {
    if (faces > 0) {
      return people === 1 ? 'A person is in the room.' : `${people} people are in the room.`;
    }
    return people === 1 ? 'A person is visible in the scene.' : `${people} people are visible in the scene.`;
  }

  if (dogs > 0) {
    return dogs === 1 ? 'A dog is in the room.' : `${dogs} dogs are in the room.`;
  }

  if (motion > 0.2) {
    return 'Motion detected in the room.';
  }

  return 'No significant activity detected.';
}

async function getCocoModel() {
  if (!cocoModelPromise) {
    cocoModelPromise = (async () => {
      const tf = await import('@tensorflow/tfjs');
      await tf.ready();
      const coco = await import('@tensorflow-models/coco-ssd');
      return coco.load({ base: 'lite_mobilenet_v2' });
    })();
  }
  return cocoModelPromise;
}

async function getFaceApi() {
  if (!faceApiPromise) {
    faceApiPromise = (async () => {
      const tf = await import('@tensorflow/tfjs');
      await tf.ready();
      const faceapi = await import('face-api.js');
      const modelUrl = 'https://justadudewhohacks.github.io/face-api.js/models';
      await faceapi.nets.tinyFaceDetector.loadFromUri(modelUrl);
      return faceapi;
    })();
  }
  return faceApiPromise;
}

/**
 * HLS video player component.
 * Props:
 *  - src: HLS playlist URL (string)
 *  - style: optional inline styles
 *  - analyticsMode: 'off' | 'motion' | 'full'
 *  - onAnalytics: callback with { motion, people, faces }
 * Exposes: video element via ref
 */
const HlsPlayer = forwardRef(function HlsPlayer({ src, style = {}, analyticsMode = 'off', onAnalytics, onAnalyticsError }, ref) {
  const videoRef = ref || useRef(null);
  const hlsRef = useRef(null);
  const sampleCanvasRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const previousFrameRef = useRef(null);
  const previousFaceBoxesRef = useRef([]);
  const dogSignalHistoryRef = useRef([]);
  const detectBusyRef = useRef(false);

  const boxIou = (a, b) => {
    const ax2 = a.x + a.width;
    const ay2 = a.y + a.height;
    const bx2 = b.x + b.width;
    const by2 = b.y + b.height;

    const ix1 = Math.max(a.x, b.x);
    const iy1 = Math.max(a.y, b.y);
    const ix2 = Math.min(ax2, bx2);
    const iy2 = Math.min(ay2, by2);

    const iw = Math.max(0, ix2 - ix1);
    const ih = Math.max(0, iy2 - iy1);
    const inter = iw * ih;
    if (!inter) return 0;

    const areaA = Math.max(1, a.width * a.height);
    const areaB = Math.max(1, b.width * b.height);
    const union = areaA + areaB - inter;
    return inter / Math.max(1, union);
  };

  const looksLikeFaceBox = (box) => {
    if (!box) return false;
    if (box.width < LIVE_FACE_MIN_BOX || box.height < LIVE_FACE_MIN_BOX) return false;
    const ratio = box.width / Math.max(1, box.height);
    return ratio >= LIVE_FACE_MIN_ASPECT_RATIO && ratio <= LIVE_FACE_MAX_ASPECT_RATIO;
  };

  const setupHls = useCallback(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    // Destroy previous instance
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (Hls.isSupported()) {
      const hls = new Hls({
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 5,
        enableWorker: true,
      });
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        onAnalyticsError?.(null);
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data) return;
        if (data.fatal) {
          onAnalyticsError?.(`Live stream error: ${data.type || 'unknown'} (${data.details || 'fatal'})`);
        }
      });
      hlsRef.current = hls;
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS (Safari)
      video.src = src;
      video.addEventListener('loadedmetadata', () => video.play().catch(() => {}));
    }
  }, [src]);

  useEffect(() => {
    setupHls();
    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [setupHls]);

  useEffect(() => {
    if (analyticsMode === 'off') {
      previousFrameRef.current = null;
      previousFaceBoxesRef.current = [];
      dogSignalHistoryRef.current = [];
      const overlay = overlayCanvasRef.current;
      const overlayCtx = overlay?.getContext('2d');
      if (overlay && overlayCtx) {
        overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
      }
      onAnalyticsError?.(null);
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    const canvas = sampleCanvasRef.current || document.createElement('canvas');
    sampleCanvasRef.current = canvas;
    canvas.width = 160;
    canvas.height = 90;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const drawOverlay = (objects, faces) => {
      const overlay = overlayCanvasRef.current;
      if (!overlay || !video.videoWidth || !video.videoHeight) return;

      const ow = Math.max(1, Math.round(video.clientWidth || video.offsetWidth || 0));
      const oh = Math.max(1, Math.round(video.clientHeight || video.offsetHeight || 0));
      if (!ow || !oh) return;

      if (overlay.width !== ow || overlay.height !== oh) {
        overlay.width = ow;
        overlay.height = oh;
      }

      const overlayCtx = overlay.getContext('2d');
      if (!overlayCtx) return;
      overlayCtx.clearRect(0, 0, overlay.width, overlay.height);

      const sx = overlay.width / video.videoWidth;
      const sy = overlay.height / video.videoHeight;

      objects.forEach((obj) => {
        const [x, y, w, h] = obj.bbox || [0, 0, 0, 0];
        const rx = x * sx;
        const ry = y * sy;
        const rw = w * sx;
        const rh = h * sy;
        const isDog = obj.class === 'dog';

        overlayCtx.strokeStyle = isDog ? 'rgba(255, 183, 77, 0.95)' : 'rgba(114, 223, 160, 0.95)';
        overlayCtx.fillStyle = isDog ? 'rgba(255, 183, 77, 0.16)' : 'rgba(114, 223, 160, 0.16)';
        overlayCtx.lineWidth = 2;
        overlayCtx.fillRect(rx, ry, rw, rh);
        overlayCtx.strokeRect(rx, ry, rw, rh);

        const label = `${obj.class} ${Math.round((obj.score || 0) * 100)}%`;
        overlayCtx.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace';
        const tw = Math.ceil(overlayCtx.measureText(label).width) + 8;
        const ty = Math.max(14, ry - 4);
        overlayCtx.fillStyle = isDog ? 'rgba(255, 183, 77, 0.95)' : 'rgba(114, 223, 160, 0.95)';
        overlayCtx.fillRect(rx, ty - 13, tw, 14);
        overlayCtx.fillStyle = '#111';
        overlayCtx.fillText(label, rx + 4, ty - 2);
      });

      faces.forEach((face) => {
        const box = face.detection?.box;
        if (!box) return;
        const rx = box.x * sx;
        const ry = box.y * sy;
        const rw = box.width * sx;
        const rh = box.height * sy;

        overlayCtx.strokeStyle = 'rgba(100, 181, 246, 0.95)';
        overlayCtx.fillStyle = 'rgba(100, 181, 246, 0.14)';
        overlayCtx.lineWidth = 2;
        overlayCtx.fillRect(rx, ry, rw, rh);
        overlayCtx.strokeRect(rx, ry, rw, rh);

        const conf = Math.round((face.score || 0) * 100);
        const label = `face ${conf}%`;
        overlayCtx.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace';
        const tw = Math.ceil(overlayCtx.measureText(label).width) + 8;
        const ty = Math.max(14, ry - 4);
        overlayCtx.fillStyle = 'rgba(100, 181, 246, 0.95)';
        overlayCtx.fillRect(rx, ty - 13, tw, 14);
        overlayCtx.fillStyle = '#111';
        overlayCtx.fillText(label, rx + 4, ty - 2);
      });
    };

    let active = true;

    const runMotion = () => {
      if (!active || !video || video.paused || video.readyState < 2) return null;
      try {
        ctx.drawImage(video, 0, 0, 160, 90);
      } catch {
        return 0;
      }

      let frame;
      try {
        frame = ctx.getImageData(0, 0, 160, 90);
      } catch {
        return 0;
      }

      const prev = previousFrameRef.current;
      previousFrameRef.current = frame;
      if (!prev) return null;

      let diffSum = 0;
      let diffCount = 0;
      for (let i = 0; i < frame.data.length; i += 4) {
        const currGray = frame.data[i] * 0.299 + frame.data[i + 1] * 0.587 + frame.data[i + 2] * 0.114;
        const prevGray = prev.data[i] * 0.299 + prev.data[i + 1] * 0.587 + prev.data[i + 2] * 0.114;
        const d = Math.abs(currGray - prevGray) / 255;
        if (d > 0.08) diffSum += d;
        diffCount += 1;
      }
      return Math.min(1, (diffSum / Math.max(1, diffCount)) * 2.2);
    };

    const run = async () => {
      if (!active || detectBusyRef.current) return;
      detectBusyRef.current = true;

      try {
        const sampledMotion = runMotion();
        const motion = sampledMotion == null ? 0 : sampledMotion;

        if (analyticsMode === 'motion') {
          const subtitle = buildLiveSubtitle({ people: 0, dogs: 0, faces: 0, motion, hasTv: false, hasCouch: false });
          onAnalytics?.({ motion, people: 0, dogs: 0, faces: 0, subtitle });
          return;
        }

        let people = 0;
        let dogs = 0;
        let faces = 0;
        let objectBoxes = [];
        let faceBoxes = [];
        let hasTv = false;
        let hasCouch = false;

        try {
          const model = await getCocoModel();
          const preds = await model.detect(video, DETECTION_LIMIT);
          hasTv = preds.some((p) => p.class === 'tv' && p.score >= 0.2);
          hasCouch = preds.some((p) => p.class === 'couch' && p.score >= 0.2);
          const peopleDetections = preds.filter(p => p.class === 'person' && p.score >= PERSON_THRESHOLD);
          const hardDogs = preds.filter(p => p.class === 'dog' && p.score >= DOG_THRESHOLD);
          const softDogs = preds.filter(p => p.class === 'dog' && p.score >= DOG_SOFT_THRESHOLD);

          const currentDogSignal = hardDogs.length > 0 || softDogs.length > 0;
          const nextHistory = [...dogSignalHistoryRef.current.slice(-(DOG_STABILITY_WINDOW - 1)), currentDogSignal];
          dogSignalHistoryRef.current = nextHistory;
          const stableDogSeen = nextHistory.filter(Boolean).length >= DOG_STABILITY_REQUIRED;

          const dogDetectionsForUi = hardDogs.length > 0
            ? hardDogs
            : (stableDogSeen && softDogs.length > 0 ? [softDogs[0]] : []);

          objectBoxes = [
            ...peopleDetections,
            ...dogDetectionsForUi,
          ].map(p => ({ class: p.class, score: p.score, bbox: p.bbox }));

          people = peopleDetections.length;
          dogs = dogDetectionsForUi.length > 0 ? dogDetectionsForUi.length : 0;
        } catch (err) {
          people = 0;
          dogs = 0;
          dogSignalHistoryRef.current = [];
          onAnalyticsError?.(toErrorMessage('Object model error', err));
        }

        try {
          const faceapi = await getFaceApi();
          const rawFaceDetections = await faceapi.detectAllFaces(
            video,
            new faceapi.TinyFaceDetectorOptions({ inputSize: LIVE_FACE_INPUT_SIZE, scoreThreshold: LIVE_FACE_SCORE_THRESHOLD })
          );

          const prevBoxes = previousFaceBoxesRef.current || [];
          const stableFaceDetections = rawFaceDetections.filter((fd) => {
            const box = fd.detection?.box || fd.box;
            const score = fd.score || fd.detection?.score || 0;
            if (!looksLikeFaceBox(box)) return false;

            // Keep strong detections immediately; otherwise require overlap with previous frame.
            if (score >= 0.42) return true;
            return prevBoxes.some((pb) => boxIou(box, pb) >= LIVE_FACE_CONFIRM_IOU);
          });

          previousFaceBoxesRef.current = stableFaceDetections
            .map(fd => fd.detection?.box || fd.box)
            .filter(Boolean)
            .slice(0, 12);

          faceBoxes = stableFaceDetections.map(fd => ({ detection: fd, score: fd.score || fd.detection?.score || 0 }));
          faces = stableFaceDetections.length;
        } catch (err) {
          faces = 0;
          previousFaceBoxesRef.current = [];
          onAnalyticsError?.(toErrorMessage('Face model error', err));
        }

        drawOverlay(objectBoxes, faceBoxes);
        onAnalyticsError?.(null);
        const subtitle = buildLiveSubtitle({
          people,
          dogs,
          faces,
          motion,
          hasTv,
          hasCouch,
        });
        onAnalytics?.({ motion, people, dogs, faces, subtitle });
      } catch (err) {
        onAnalyticsError?.(toErrorMessage('Live analytics error', err));
      } finally {
        detectBusyRef.current = false;
      }
    };

    const intervalMs = analyticsMode === 'full' ? 1600 : 850;
    const timer = setInterval(() => {
      run().catch(() => {});
    }, intervalMs);

    return () => {
      active = false;
      clearInterval(timer);
      detectBusyRef.current = false;
    };
  }, [analyticsMode, onAnalytics, onAnalyticsError]);

  return (
    <>
      <video
        ref={videoRef}
        controls
        muted
        autoPlay
        playsInline
        crossOrigin="anonymous"
        style={{ width: '100%', height: '100%', background: '#000', display: 'block', ...style }}
      />
      <canvas
        ref={overlayCanvasRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
      />
    </>
  );
});

export default HlsPlayer;
