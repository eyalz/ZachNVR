import { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useCameras } from '../hooks/useCameras';
import { apiFetchJson, backendAssetUrl } from '../lib/api';
import { captureAndDownload } from '../lib/captureUtils';
import './Playback.css';

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const GRID_COLS = 16;
const GRID_ROWS = 9;
const GRID_SIZE = GRID_COLS * GRID_ROWS;
const TIMELINE_BINS = 96;
const TIMELINE_ZOOM_LEVELS = [1, 2, 4];
const INSIGHT_PREFS_KEY = 'zachnvr.playback.insightPrefs.v2';
const KNOWN_FACES_KEY = 'zachnvr.playback.knownFaces.v1';
const FACE_MATCH_THRESHOLD = 0.72;
const PLAYBACK_FACE_INPUT_SIZE = 800;
const PLAYBACK_FACE_SCORE_THRESHOLD = 0.22;
const PLAYBACK_MIN_FACE_CONFIDENCE = 0.28;
const PLAYBACK_FACE_SCAN_INTERVAL_MS = 1100;
const PLAYBACK_OBJECT_DETECTION_LIMIT = 20;
const PLAYBACK_OBJECT_MIN_CONFIDENCE = 0.35;
const PLAYBACK_DOG_MIN_CONFIDENCE = 0.28;
const PLAYBACK_DOG_SOFT_CONFIDENCE = 0.14;
const PLAYBACK_DOG_STABILITY_WINDOW = 3;
const PLAYBACK_DOG_STABILITY_REQUIRED = 2;

const DEFAULT_INSIGHT_PREFS = {
  timeline: true,
  pattern: true,
  zones: true,
  heatmap: true,
  objects: true,
  objectEvents: true,
  faceRecognition: true,
  faceEvents: true,
};

function fullMask() {
  return Array.from({ length: GRID_SIZE }, () => false);
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(d) {
  return new Date(d).toLocaleString();
}

function formatTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

function normalizeMask(mask) {
  if (!Array.isArray(mask)) return fullMask();
  return Array.from({ length: GRID_SIZE }, (_, i) => mask[i] === true);
}

function zoneName(row, col) {
  const r = row < GRID_ROWS / 3 ? 'Top' : row < (GRID_ROWS * 2) / 3 ? 'Center' : 'Bottom';
  const c = col < GRID_COLS / 3 ? 'Left' : col < (GRID_COLS * 2) / 3 ? 'Center' : 'Right';
  return `${r}-${c}`;
}

function fitContainRect(containerWidth, containerHeight, sourceWidth, sourceHeight) {
  if (!sourceWidth || !sourceHeight) {
    return { x: 0, y: 0, width: containerWidth, height: containerHeight, scale: 1 };
  }
  const scale = Math.min(containerWidth / sourceWidth, containerHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  const x = (containerWidth - width) / 2;
  const y = (containerHeight - height) / 2;
  return { x, y, width, height, scale };
}

function heatColor(value) {
  const t = clamp(value, 0, 1);
  const hue = 220 - 220 * t;
  return `hsla(${hue}, 92%, 56%, ${0.08 + t * 0.58})`;
}

function loadInsightPrefs() {
  try {
    const raw = localStorage.getItem(INSIGHT_PREFS_KEY);
    if (!raw) return DEFAULT_INSIGHT_PREFS;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_INSIGHT_PREFS,
      ...parsed,
      // Keep core detections enabled so users always get face/object signals in playback.
      objects: true,
      objectEvents: true,
      faceRecognition: true,
      faceEvents: true,
    };
  } catch {
    return DEFAULT_INSIGHT_PREFS;
  }
}

function loadKnownFaces() {
  try {
    const raw = localStorage.getItem(KNOWN_FACES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(f => Array.isArray(f.descriptor) && typeof f.label === 'string');
  } catch {
    return [];
  }
}

function euclideanDistance(a, b) {
  const len = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < len; i += 1) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

function bestFaceMatch(descriptor, knownFaces) {
  if (!knownFaces.length) return null;
  let best = null;
  for (const person of knownFaces) {
    const dist = euclideanDistance(descriptor, person.descriptor);
    if (!best || dist < best.distance) {
      best = { label: person.label, distance: dist, id: person.id };
    }
  }
  return best;
}

const analyticsCache = new Map();

export default function Playback() {
  const { cameras, updateCamera } = useCameras();
  const [searchParams] = useSearchParams();

  const [selectedCamera, setSelectedCamera] = useState(null);
  const [cameraSnapshots, setCameraSnapshots] = useState({});
  const [recordings, setRecordings] = useState([]);
  const [loadingRec, setLoadingRec] = useState(false);
  const [analyticsPrecomputeStatus, setAnalyticsPrecomputeStatus] = useState({});
  const [playingUrl, setPlayingUrl] = useState(null);
  const [playingRecording, setPlayingRecording] = useState(null);
  const [playError, setPlayError] = useState('');
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [playbackReadyState, setPlaybackReadyState] = useState('idle');

  const [playbackRate, setPlaybackRate] = useState(1);
  const [analysisEnabled, setAnalysisEnabled] = useState(true);
  const [insightPrefs, setInsightPrefs] = useState(loadInsightPrefs);
  const [analysisError, setAnalysisError] = useState('');

  const [analysis, setAnalysis] = useState({
    movement: 0,
    topZones: [],
    pattern: 'Waiting for playback...',
    heat: Array.from({ length: GRID_ROWS }, () => Array(GRID_COLS).fill(0)),
  });

  const [motionMask, setMotionMask] = useState(() => fullMask());
  const [editingMask, setEditingMask] = useState(false);

  const [objectDetections, setObjectDetections] = useState([]);
  const [objectEvents, setObjectEvents] = useState([]);
  const [detectorStatus, setDetectorStatus] = useState('idle');

  const [faceStatus, setFaceStatus] = useState('idle');
  const [knownFaces, setKnownFaces] = useState(loadKnownFaces);
  const [currentFaces, setCurrentFaces] = useState([]);
  const [faceEvents, setFaceEvents] = useState([]);
  const [faceTagInputs, setFaceTagInputs] = useState({});
  const [selectedFaceId, setSelectedFaceId] = useState(null);

  const [backendAnalytics, setBackendAnalytics] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [localTimeline, setLocalTimeline] = useState(Array.from({ length: TIMELINE_BINS }, () => 0));

  const [videoDuration, setVideoDuration] = useState(0);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [timelineHoverIndex, setTimelineHoverIndex] = useState(null);
  const [timelineDragging, setTimelineDragging] = useState(false);
  const [timelineZoom, setTimelineZoom] = useState(1);

  const videoRef = useRef(null);
  const faceOverlayCanvasRef = useRef(null);
  const facePreviewCanvasRef = useRef(null);
  const sampleCanvasRef = useRef(null);
  const previousFrameRef = useRef(null);
  const movementHistoryRef = useRef([]);
  const timelineRef = useRef(Array.from({ length: TIMELINE_BINS }, () => 0));
  const timelineTrackRef = useRef(null);
  const timelineDraggingRef = useRef(false);
  const detectorRef = useRef(null);
  const detectorLoadingRef = useRef(false);
  const dogSignalHistoryRef = useRef([]);
  const faceApiRef = useRef(null);
  const faceLoadingRef = useRef(false);
  const faceNameInputRef = useRef(null);
  const precomputeQueueRef = useRef([]);
  const precomputingRef = useRef(false);

  const selectedCameraObj = cameras.find(c => c.id === selectedCamera) || null;

  useEffect(() => {
    localStorage.setItem(INSIGHT_PREFS_KEY, JSON.stringify(insightPrefs));
  }, [insightPrefs]);

  useEffect(() => {
    localStorage.setItem(KNOWN_FACES_KEY, JSON.stringify(knownFaces));
  }, [knownFaces]);

  useEffect(() => {
    setMotionMask(normalizeMask(selectedCameraObj?.motionMask));
  }, [selectedCameraObj?.id, selectedCameraObj?.motionMask]);

  useEffect(() => {
    const cameraId = searchParams.get('camera');
    if (!cameraId) return;
    if (cameras.some(c => c.id === cameraId)) setSelectedCamera(cameraId);
  }, [searchParams, cameras]);

  useEffect(() => {
    const cameraId = searchParams.get('camera');
    const filename = searchParams.get('file');
    if (!cameraId || !filename || !recordings.length) return;

    // Auto-play the specified file when it's loaded
    const recording = recordings.find(r => r.filename === filename);
    if (recording) {
      play(recording);
    }
  }, [recordings, searchParams]);

  useEffect(() => {
    let cancelled = false;

    if (!cameras.length) {
      setCameraSnapshots({});
      return;
    }

    Promise.all(cameras.map(async (cam) => {
      try {
        const data = await apiFetchJson(`/cameras/${cam.id}/snapshot`);
        return [cam.id, backendAssetUrl(data.url)];
      } catch {
        return [cam.id, null];
      }
    })).then(entries => {
      if (cancelled) return;
      setCameraSnapshots(Object.fromEntries(entries));
    });

    return () => {
      cancelled = true;
    };
  }, [cameras]);

  const loadRecordings = async (cameraId) => {
    if (!cameraId) {
      setRecordings([]);
      return;
    }

    const data = await apiFetchJson(`/recordings/${cameraId}`);
    const recs = (data.recordings || []).map(rec => ({
      ...rec,
      url: backendAssetUrl(rec.url),
      description: rec.description || '',
    }));

    setRecordings(recs);
    setLastUpdatedAt(Date.now());
  };

  const precomputeAnalytics = async (cameraId, filename) => {
    const cacheKey = `${cameraId}:${filename}`;
    if (analyticsCache.has(cacheKey)) return;
    if (analyticsPrecomputeStatus[cacheKey] === 'precomputing') return;

    try {
      setAnalyticsPrecomputeStatus(prev => ({ ...prev, [cacheKey]: 'precomputing' }));
      const encoded = encodeURIComponent(filename);
      const data = await apiFetchJson(`/recordings/${cameraId}/${encoded}/analytics`);
      analyticsCache.set(cacheKey, data.analytics || null);
      setAnalyticsPrecomputeStatus(prev => ({ ...prev, [cacheKey]: 'ready' }));
    } catch {
      analyticsCache.set(cacheKey, null);
      setAnalyticsPrecomputeStatus(prev => ({ ...prev, [cacheKey]: 'failed' }));
    }
  };

  const processPrecomputeQueue = async () => {
    if (precomputingRef.current || !precomputeQueueRef.current.length) return;
    precomputingRef.current = true;

    while (precomputeQueueRef.current.length > 0) {
      const { cameraId, filename } = precomputeQueueRef.current.shift();
      await precomputeAnalytics(cameraId, filename);
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    precomputingRef.current = false;
  };

  useEffect(() => {
    processPrecomputeQueue();
  }, [analyticsPrecomputeStatus]);

  useEffect(() => {
    if (!selectedCamera) {
      setRecordings([]);
      setLastUpdatedAt(null);
      return;
    }

    let cancelled = false;
    const safeLoad = async () => {
      try {
        if (!cancelled) setLoadingRec(true);
        await loadRecordings(selectedCamera);
      } catch {
        if (!cancelled) setRecordings([]);
      } finally {
        if (!cancelled) setLoadingRec(false);
      }
    };

    safeLoad();
    const id = setInterval(() => {
      loadRecordings(selectedCamera).catch(() => {});
    }, 8000);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [selectedCamera]);

  useEffect(() => {
    if (!playingUrl) return;
    const exists = recordings.some(rec => rec.url === playingUrl);
    if (!exists) {
      setPlayingUrl(null);
      setPlayingRecording(null);
      setPlayError('');
    }
  }, [recordings, playingUrl]);

  const play = (recording) => {
    setPlayingRecording(recording);
    setPlayingUrl(recording.url);
    setPlayError('');
    setAnalysisError('');
    setObjectDetections([]);
    setObjectEvents([]);
    dogSignalHistoryRef.current = [];
    setCurrentFaces([]);
    setFaceEvents([]);
    setFaceTagInputs({});
    setSelectedFaceId(null);
    movementHistoryRef.current = [];
    previousFrameRef.current = null;
    timelineRef.current = Array.from({ length: TIMELINE_BINS }, () => 0);
    setLocalTimeline(Array.from({ length: TIMELINE_BINS }, () => 0));
    setVideoCurrentTime(0);
    setVideoDuration(0);

    const tryPlay = () => {
      const video = videoRef.current;
      if (!video) return;
      video.play().catch(() => {});
    };

    requestAnimationFrame(tryPlay);
    setTimeout(tryPlay, 0);
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playingUrl) return;

    const tryPlay = () => {
      video.play().catch(() => {});
    };

    video.addEventListener('canplay', tryPlay);
    video.addEventListener('loadeddata', tryPlay);

    return () => {
      video.removeEventListener('canplay', tryPlay);
      video.removeEventListener('loadeddata', tryPlay);
    };
  }, [playingUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = playbackRate;
  }, [playingUrl, playbackRate]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTime = () => {
      setVideoCurrentTime(video.currentTime || 0);
      setVideoDuration(Number.isFinite(video.duration) ? video.duration : 0);
    };
    const onMeta = () => {
      setVideoDuration(Number.isFinite(video.duration) ? video.duration : 0);
    };

    video.addEventListener('timeupdate', onTime);
    video.addEventListener('loadedmetadata', onMeta);
    return () => {
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('loadedmetadata', onMeta);
    };
  }, [playingUrl]);

  useEffect(() => {
    if (!selectedCamera || !playingRecording?.filename) {
      setBackendAnalytics(null);
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        setAnalyticsLoading(true);
        const encoded = encodeURIComponent(playingRecording.filename);
        const data = await apiFetchJson(`/recordings/${selectedCamera}/${encoded}/analytics`);
        if (!cancelled) setBackendAnalytics(data.analytics || null);
      } catch {
        if (!cancelled) setBackendAnalytics(null);
      } finally {
        if (!cancelled) setAnalyticsLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [selectedCamera, playingRecording?.filename]);

  useEffect(() => {
    const video = videoRef.current;
    const sampleCanvas = sampleCanvasRef.current;
    if (!video || !sampleCanvas) return;
    if (!playingUrl || !analysisEnabled) {
      previousFrameRef.current = null;
      movementHistoryRef.current = [];
      return;
    }

    sampleCanvas.width = 160;
    sampleCanvas.height = 90;
    const ctx = sampleCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const run = () => {
      if (video.paused || video.ended || video.readyState < 2) return;

      try {
        ctx.drawImage(video, 0, 0, 160, 90);
        const frame = ctx.getImageData(0, 0, 160, 90);
        const prev = previousFrameRef.current;
        previousFrameRef.current = frame;
        if (!prev) return;

        const zoneScores = Array.from({ length: GRID_ROWS }, () => Array(GRID_COLS).fill(0));
        const zoneCounts = Array.from({ length: GRID_ROWS }, () => Array(GRID_COLS).fill(0));
        let sum = 0;
        let count = 0;

        for (let y = 0; y < 90; y += 1) {
          for (let x = 0; x < 160; x += 1) {
            const i = (y * 160 + x) * 4;
            const currGray = frame.data[i] * 0.299 + frame.data[i + 1] * 0.587 + frame.data[i + 2] * 0.114;
            const prevGray = prev.data[i] * 0.299 + prev.data[i + 1] * 0.587 + prev.data[i + 2] * 0.114;
            const diff = Math.abs(currGray - prevGray) / 255;
            const normalized = diff > 0.08 ? diff : 0;

            const col = clamp(Math.floor((x / 160) * GRID_COLS), 0, GRID_COLS - 1);
            const row = clamp(Math.floor((y / 90) * GRID_ROWS), 0, GRID_ROWS - 1);
            const maskIdx = row * GRID_COLS + col;
            if (motionMask[maskIdx]) continue;

            zoneScores[row][col] += normalized;
            zoneCounts[row][col] += 1;
            sum += normalized;
            count += 1;
          }
        }

        const heat = zoneScores.map((row, r) => row.map((score, c) => {
          const avg = score / Math.max(1, zoneCounts[r][c]);
          return clamp(avg * 5, 0, 1);
        }));

        const movement = sum / Math.max(1, count);
        movementHistoryRef.current = [...movementHistoryRef.current.slice(-11), movement];
        const movementAvg = movementHistoryRef.current.reduce((acc, n) => acc + n, 0) / Math.max(1, movementHistoryRef.current.length);

        const topZones = heat
          .flatMap((row, r) => row.map((value, c) => ({ value, r, c })))
          .sort((a, b) => b.value - a.value)
          .slice(0, 3)
          .map(z => ({ name: zoneName(z.r, z.c), value: z.value }));

        let pattern = 'Localized motion cluster';
        if (movementAvg < 0.06) pattern = 'Static scene';
        else if (movementAvg > 0.55) pattern = 'Scene-wide motion';
        else if (topZones.some(z => z.name.includes('Center')) && movementAvg > 0.2) pattern = 'Persistent center activity';

        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        if (duration > 0) {
          const idx = clamp(Math.floor((video.currentTime / duration) * TIMELINE_BINS), 0, TIMELINE_BINS - 1);
          timelineRef.current[idx] = Math.max(timelineRef.current[idx], clamp(movementAvg * 1.8, 0, 1));
          setLocalTimeline([...timelineRef.current]);
        }

        setAnalysis({ movement: movementAvg, topZones, pattern, heat });
      } catch {
        setAnalysisError('Analysis unavailable for this recording.');
      }
    };

    const id = setInterval(run, 350);
    return () => clearInterval(id);
  }, [playingUrl, analysisEnabled, motionMask]);

  useEffect(() => {
    if (!analysisEnabled || !insightPrefs.objects || !playingUrl) {
      setObjectDetections([]);
      dogSignalHistoryRef.current = [];
      return;
    }

    let cancelled = false;

    const loadModel = async () => {
      if (detectorRef.current || detectorLoadingRef.current) return;
      detectorLoadingRef.current = true;
      setDetectorStatus('loading');
      try {
        const tf = await import('@tensorflow/tfjs');
        await tf.ready();
        const coco = await import('@tensorflow-models/coco-ssd');
        detectorRef.current = await coco.load({ base: 'lite_mobilenet_v2' });
        if (!cancelled) setDetectorStatus('ready');
      } catch {
        if (!cancelled) setDetectorStatus('error');
      } finally {
        detectorLoadingRef.current = false;
      }
    };

    loadModel();

    const runDetection = async () => {
      const video = videoRef.current;
      const detector = detectorRef.current;
      if (!video || !detector || video.paused || video.readyState < 2) return;

      try {
        const predictions = await detector.detect(video, PLAYBACK_OBJECT_DETECTION_LIMIT);
        const nonDog = predictions
          .filter((p) => {
            if (p.class === 'dog') return false;
            if (p.class === 'person' || p.class === 'cat' || p.class === 'car') return p.score >= PLAYBACK_OBJECT_MIN_CONFIDENCE;
            return p.score >= 0.6;
          })
          .map(p => ({ class: p.class, score: p.score }));

        const hardDogs = predictions
          .filter(p => p.class === 'dog' && p.score >= PLAYBACK_DOG_MIN_CONFIDENCE)
          .map(p => ({ class: p.class, score: p.score }));
        const softDogs = predictions
          .filter(p => p.class === 'dog' && p.score >= PLAYBACK_DOG_SOFT_CONFIDENCE)
          .map(p => ({ class: p.class, score: p.score }));

        const currentDogSignal = hardDogs.length > 0 || softDogs.length > 0;
        const nextHistory = [...dogSignalHistoryRef.current.slice(-(PLAYBACK_DOG_STABILITY_WINDOW - 1)), currentDogSignal];
        dogSignalHistoryRef.current = nextHistory;
        const stableDogSeen = nextHistory.filter(Boolean).length >= PLAYBACK_DOG_STABILITY_REQUIRED;

        const dogForUi = hardDogs.length > 0
          ? hardDogs
          : (stableDogSeen && softDogs.length > 0 ? [softDogs[0]] : []);

        const filtered = [...nonDog, ...dogForUi];

        setObjectDetections(filtered);

        if (filtered.length) {
          const labels = [...new Set(filtered.map(f => f.class))];
          const t = video.currentTime || 0;
          setObjectEvents(prev => [...prev, { time: t, labels }].slice(-30));
        }
      } catch {
        setDetectorStatus('error');
      }
    };

    const id = setInterval(() => {
      runDetection().catch(() => {});
    }, 1200);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [playingUrl, analysisEnabled, insightPrefs.objects]);

  useEffect(() => {
    if (!analysisEnabled || !insightPrefs.faceRecognition || !playingUrl) {
      setCurrentFaces([]);
      return;
    }

    let cancelled = false;

    const loadFaceModels = async () => {
      if (faceApiRef.current || faceLoadingRef.current) return;
      faceLoadingRef.current = true;
      setFaceStatus('loading');
      try {
        const tf = await import('@tensorflow/tfjs');
        await tf.ready();
        const faceapi = await import('face-api.js');
        const modelUrl = 'https://justadudewhohacks.github.io/face-api.js/models';
        await faceapi.nets.tinyFaceDetector.loadFromUri(modelUrl);
        await faceapi.nets.faceLandmark68Net.loadFromUri(modelUrl);
        await faceapi.nets.faceRecognitionNet.loadFromUri(modelUrl);
        faceApiRef.current = faceapi;
        if (!cancelled) setFaceStatus('ready');
      } catch {
        if (!cancelled) setFaceStatus('error');
      } finally {
        faceLoadingRef.current = false;
      }
    };

    loadFaceModels();

    const runFaceRecognition = async () => {
      const video = videoRef.current;
      const faceapi = faceApiRef.current;
      if (!video || !faceapi || video.paused || video.readyState < 2) return;

      try {
        const detections = await faceapi
          .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({ inputSize: PLAYBACK_FACE_INPUT_SIZE, scoreThreshold: PLAYBACK_FACE_SCORE_THRESHOLD }))
          .withFaceLandmarks()
          .withFaceDescriptors();

        const now = video.currentTime || 0;
        const faces = detections
          .filter(det => (det.detection?.score || 0) >= PLAYBACK_MIN_FACE_CONFIDENCE)
          .map((det, idx) => {
          const descriptor = Array.from(det.descriptor || []);
          const match = bestFaceMatch(descriptor, knownFaces);
          const recognized = !!(match && match.distance <= FACE_MATCH_THRESHOLD);
          const box = det.detection?.box || { x: 0, y: 0, width: 0, height: 0 };
          const boxKey = `${Math.round(box.x)}-${Math.round(box.y)}-${Math.round(box.width)}-${Math.round(box.height)}`;
          return {
            id: `${idx}-${boxKey}`,
            descriptor,
            confidence: det.detection?.score || 0,
            label: recognized ? match.label : null,
            distance: match ? match.distance : null,
            box,
          };
        })
          .slice(0, 20);

        setCurrentFaces(faces);

        if (faces.length) {
          setFaceEvents(prev => {
            const next = [...prev];
            faces.forEach(face => {
              const label = face.label || 'Unknown';
              const recent = next.slice(-4).some(evt => evt.label === label && Math.abs(evt.time - now) < 2.2);
              if (!recent) {
                next.push({ time: now, label, confidence: face.confidence });
              }
            });
            return next.slice(-50);
          });
        }
      } catch {
        setFaceStatus('error');
      }
    };

    const id = setInterval(() => {
      runFaceRecognition().catch(() => {});
    }, PLAYBACK_FACE_SCAN_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [playingUrl, analysisEnabled, insightPrefs.faceRecognition, knownFaces]);

  useEffect(() => {
    if (!selectedFaceId) return;
    const id = setTimeout(() => {
      faceNameInputRef.current?.focus();
      faceNameInputRef.current?.select();
    }, 0);
    return () => clearTimeout(id);
  }, [selectedFaceId]);

  useEffect(() => {
    if (!analysisEnabled || !insightPrefs.faceRecognition) return;
    if (selectedFaceId) return;
    const firstUnknown = currentFaces.find(face => !face.label);
    if (firstUnknown) setSelectedFaceId(firstUnknown.id);
  }, [currentFaces, selectedFaceId, analysisEnabled, insightPrefs.faceRecognition]);

  useEffect(() => {
    const canvas = faceOverlayCanvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const sync = () => {
      const rect = video.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    };

    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, [playingUrl]);

  useEffect(() => {
    const canvas = faceOverlayCanvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!analysisEnabled || !insightPrefs.faceRecognition) return;
    if (!currentFaces.length || !video.videoWidth || !video.videoHeight) return;

    const fit = fitContainRect(canvas.width, canvas.height, video.videoWidth, video.videoHeight);

    currentFaces.forEach(face => {
      const isSelected = face.id === selectedFaceId;
      const x = fit.x + face.box.x * fit.scale;
      const y = fit.y + face.box.y * fit.scale;
      const w = face.box.width * fit.scale;
      const h = face.box.height * fit.scale;
      const label = face.label || 'Face';

      ctx.lineWidth = isSelected ? 3 : 2;
      ctx.strokeStyle = face.label ? 'rgba(92, 214, 146, 0.95)' : 'rgba(255, 158, 92, 0.95)';
      ctx.fillStyle = face.label ? 'rgba(92, 214, 146, 0.14)' : 'rgba(255, 158, 92, 0.14)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);

      const text = `${label}`;
      ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace';
      const tw = Math.ceil(ctx.measureText(text).width) + 10;
      const ty = Math.max(14, y - 6);
      ctx.fillStyle = face.label ? 'rgba(92, 214, 146, 0.95)' : 'rgba(255, 158, 92, 0.95)';
      ctx.fillRect(x, ty - 13, tw, 14);
      ctx.fillStyle = '#111';
      ctx.fillText(text, x + 5, ty - 2);
    });
  }, [currentFaces, analysisEnabled, insightPrefs.faceRecognition, selectedFaceId]);

  useEffect(() => {
    const previewCanvas = facePreviewCanvasRef.current;
    const video = videoRef.current;
    if (!previewCanvas || !video) return;

    const ctx = previewCanvas.getContext('2d');
    if (!ctx) return;

    const drawPreview = () => {
      const selected = currentFaces.find(face => face.id === selectedFaceId) || null;
      previewCanvas.width = 180;
      previewCanvas.height = 180;

      ctx.fillStyle = '#0c0f14';
      ctx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);

      if (!selected || !video.videoWidth || !video.videoHeight || video.readyState < 2) return;

      const pad = 0.2;
      const sx = Math.max(0, selected.box.x - selected.box.width * pad);
      const sy = Math.max(0, selected.box.y - selected.box.height * pad);
      const sw = Math.min(video.videoWidth - sx, selected.box.width * (1 + pad * 2));
      const sh = Math.min(video.videoHeight - sy, selected.box.height * (1 + pad * 2));

      if (sw <= 2 || sh <= 2) return;

      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, previewCanvas.width, previewCanvas.height);
    };

    drawPreview();
    const timer = setInterval(drawPreview, 450);
    return () => clearInterval(timer);
  }, [currentFaces, selectedFaceId, playingUrl]);

  const handleFaceOverlayClick = (event) => {
    const canvas = faceOverlayCanvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video || !currentFaces.length || !video.videoWidth || !video.videoHeight) return;

    const rect = canvas.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const fit = fitContainRect(canvas.width, canvas.height, video.videoWidth, video.videoHeight);

    const hit = currentFaces.find(face => {
      const x = fit.x + face.box.x * fit.scale;
      const y = fit.y + face.box.y * fit.scale;
      const w = face.box.width * fit.scale;
      const h = face.box.height * fit.scale;
      return px >= x && px <= x + w && py >= y && py <= y + h;
    });

    if (!hit) return;
    setSelectedFaceId(hit.id);
  };

  const handleMaskToggle = async (idx) => {
    if (!selectedCamera) return;
    const next = [...motionMask];
    next[idx] = !next[idx];
    setMotionMask(next);
    try {
      await updateCamera(selectedCamera, { motionMask: next });
    } catch {
      // Keep optimistic state.
    }
  };

  const resetMask = async () => {
    if (!selectedCamera) return;
    const defaultMask = fullMask();
    setMotionMask(defaultMask);
    try {
      await updateCamera(selectedCamera, { motionMask: defaultMask });
    } catch {
      // Keep optimistic state.
    }
  };

  const toggleInsight = (key) => {
    setInsightPrefs(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const setFaceInput = (faceId, value) => {
    setFaceTagInputs(prev => ({ ...prev, [faceId]: value }));
  };

  const selectNextUnknownFace = (excludeId = null) => {
    const nextUnknown = currentFaces.find(face => !face.label && face.id !== excludeId) || null;
    setSelectedFaceId(nextUnknown ? nextUnknown.id : null);
  };

  const tagFace = (face) => {
    const raw = (faceTagInputs[face.id] || '').trim();
    if (!raw) return;

    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      label: raw,
      descriptor: face.descriptor,
    };

    setKnownFaces(prev => [...prev, entry]);
    setFaceTagInputs(prev => ({ ...prev, [face.id]: '' }));
    setCurrentFaces(prev => prev.map(f => (f.id === face.id ? { ...f, label: raw, distance: 0 } : f)));
    setFaceEvents(prev => [...prev, { time: videoCurrentTime || 0, label: raw, confidence: face.confidence || 1 }].slice(-50));
    selectNextUnknownFace(face.id);
  };

  const handleFaceInputKeyDown = (event, face) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      tagFace(face);
    }
  };

  const removeKnownFace = (id) => {
    setKnownFaces(prev => prev.filter(face => face.id !== id));
  };

  const clearKnownFaces = () => {
    setKnownFaces([]);
  };

  const mergedTimeline = useMemo(() => {
    const base = backendAnalytics?.movementTimeline || Array.from({ length: TIMELINE_BINS }, () => 0);
    return Array.from({ length: TIMELINE_BINS }, (_, i) => Math.max(Number(base[i] || 0), Number(localTimeline[i] || 0)));
  }, [backendAnalytics?.movementTimeline, localTimeline]);

  const effectiveDuration = videoDuration || backendAnalytics?.duration || 0;
  const currentTimelineIndex = effectiveDuration > 0
    ? clamp(Math.floor((videoCurrentTime / effectiveDuration) * TIMELINE_BINS), 0, TIMELINE_BINS - 1)
    : 0;
  const visibleTimelineBins = clamp(Math.floor(TIMELINE_BINS / timelineZoom), 12, TIMELINE_BINS);
  const timelineFocusIndex = timelineHoverIndex == null ? currentTimelineIndex : timelineHoverIndex;
  const timelineWindowStart = clamp(
    timelineFocusIndex - Math.floor(visibleTimelineBins / 2),
    0,
    Math.max(0, TIMELINE_BINS - visibleTimelineBins),
  );
  const timelineWindow = useMemo(() => (
    Array.from({ length: visibleTimelineBins }, (_, i) => {
      const globalIndex = timelineWindowStart + i;
      return {
        globalIndex,
        value: Number(mergedTimeline[globalIndex] || 0),
      };
    })
  ), [mergedTimeline, timelineWindowStart, visibleTimelineBins]);

  const peakIndices = useMemo(() => {
    const peaks = [];
    for (let i = 1; i < mergedTimeline.length - 1; i += 1) {
      const value = Number(mergedTimeline[i] || 0);
      const prev = Number(mergedTimeline[i - 1] || 0);
      const next = Number(mergedTimeline[i + 1] || 0);
      if (value >= 0.18 && value >= prev && value >= next) {
        peaks.push(i);
      }
    }

    if (peaks.length) return peaks;

    return mergedTimeline
      .map((value, index) => ({ value: Number(value || 0), index }))
      .filter(item => item.value >= 0.12)
      .sort((a, b) => b.value - a.value)
      .slice(0, 8)
      .map(item => item.index)
      .sort((a, b) => a - b);
  }, [mergedTimeline]);

  const markerRatios = [0, 0.25, 0.5, 0.75, 1];
  const timelineMarkers = markerRatios.map(ratio => {
    const globalIndex = timelineWindowStart + Math.round(ratio * Math.max(1, visibleTimelineBins - 1));
    const time = (globalIndex / Math.max(1, TIMELINE_BINS - 1)) * effectiveDuration;
    return { ratio, time };
  });

  const hoverTime = timelineHoverIndex == null
    ? null
    : (timelineHoverIndex / Math.max(1, TIMELINE_BINS - 1)) * effectiveDuration;

  const handleTimelineSeek = (index) => {
    const video = videoRef.current;
    if (!video) return;
    const duration = Number.isFinite(video.duration) ? video.duration : effectiveDuration;
    if (!duration) return;
    const clampedIndex = clamp(index, 0, TIMELINE_BINS - 1);
    const t = (clampedIndex / Math.max(1, TIMELINE_BINS - 1)) * duration;
    video.currentTime = clamp(t, 0, duration);
  };

  const seekToTime = (seconds) => {
    const video = videoRef.current;
    if (!video || !effectiveDuration) return;
    video.currentTime = clamp(seconds, 0, effectiveDuration);
  };

  const seekBy = (deltaSeconds) => {
    seekToTime((videoCurrentTime || 0) + deltaSeconds);
  };

  const seekFromClientX = (clientX) => {
    const track = timelineTrackRef.current;
    if (!track || !effectiveDuration) return;
    const rect = track.getBoundingClientRect();
    const ratio = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    const idx = clamp(
      timelineWindowStart + Math.round(ratio * Math.max(1, visibleTimelineBins - 1)),
      0,
      TIMELINE_BINS - 1,
    );
    setTimelineHoverIndex(idx);
    handleTimelineSeek(idx);
  };

  const onTimelineMouseDown = (event) => {
    if (!effectiveDuration) return;
    event.preventDefault();
    timelineDraggingRef.current = true;
    setTimelineDragging(true);
    seekFromClientX(event.clientX);
  };

  const onTimelineMouseMove = (event) => {
    const track = timelineTrackRef.current;
    if (!track || !effectiveDuration) return;
    const rect = track.getBoundingClientRect();
    const ratio = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    const idx = clamp(Math.round(ratio * (TIMELINE_BINS - 1)), 0, TIMELINE_BINS - 1);
    setTimelineHoverIndex(idx);
    if (timelineDraggingRef.current) {
      handleTimelineSeek(idx);
    }
  };

  const onTimelineTouchStart = (event) => {
    if (!effectiveDuration) return;
    const touch = event.touches?.[0];
    if (!touch) return;
    timelineDraggingRef.current = true;
    setTimelineDragging(true);
    seekFromClientX(touch.clientX);
  };

  const onTimelineTouchMove = (event) => {
    if (!timelineDraggingRef.current || !effectiveDuration) return;
    const touch = event.touches?.[0];
    if (!touch) return;
    seekFromClientX(touch.clientX);
  };

  const onTimelineKeyDown = (event) => {
    if (!effectiveDuration) return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      seekBy(event.shiftKey ? -10 : -5);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      seekBy(event.shiftKey ? 10 : 5);
    } else if (event.key === 'Home') {
      event.preventDefault();
      seekToTime(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      seekToTime(effectiveDuration);
    }
  };

  const jumpToPeak = (direction) => {
    if (!peakIndices.length) return;
    if (direction > 0) {
      const next = peakIndices.find(idx => idx > currentTimelineIndex);
      handleTimelineSeek(next == null ? peakIndices[0] : next);
      return;
    }
    const prev = [...peakIndices].reverse().find(idx => idx < currentTimelineIndex);
    handleTimelineSeek(prev == null ? peakIndices[peakIndices.length - 1] : prev);
  };

  useEffect(() => {
    const stopDrag = () => {
      if (!timelineDraggingRef.current) return;
      timelineDraggingRef.current = false;
      setTimelineDragging(false);
    };

    window.addEventListener('mouseup', stopDrag);
    window.addEventListener('touchend', stopDrag);
    return () => {
      window.removeEventListener('mouseup', stopDrag);
      window.removeEventListener('touchend', stopDrag);
    };
  }, []);

  const totalRecordingBytes = recordings.reduce((sum, rec) => sum + (Number(rec.size) || 0), 0);
  const oldestRecording = recordings.length
    ? recordings.reduce((oldest, rec) => (!oldest || new Date(rec.createdAt) < new Date(oldest.createdAt) ? rec : oldest), null)
    : null;
  const selectedFace = currentFaces.find(face => face.id === selectedFaceId) || null;
  const unknownFacesCount = currentFaces.filter(face => !face.label).length;
  const playbackSubtitle = backendAnalytics?.description || playingRecording?.description || (analyticsLoading ? 'Analyzing full recording...' : 'Preparing full recording summary...');

  return (
    <div className="pb-root">
      <div className="page-header">
        <h1>Playback</h1>
      </div>

      <div className="pb-layout">
        <aside className="pb-sidebar">
          <div className="pb-section-title">Select Camera</div>
          {cameras.length === 0 && <p className="pb-empty">No cameras configured.</p>}
          {cameras.map(cam => (
            <button
              key={cam.id}
              className={`pb-cam-btn ${selectedCamera === cam.id ? 'active' : ''}`}
              onClick={() => {
                setSelectedCamera(cam.id);
                setPlayingUrl(null);
                setPlayingRecording(null);
              }}
            >
              <div className="pb-cam-left">
                {cameraSnapshots[cam.id]
                  ? <img className="pb-cam-thumb" src={cameraSnapshots[cam.id]} alt={`${cam.name} snapshot`} />
                  : <div className="pb-cam-thumb pb-cam-thumb-empty">No image</div>}
                <span className="pb-cam-name">{cam.name}</span>
              </div>
              {cam.record && <span className="badge badge-rec" style={{ fontSize: 10 }}>REC</span>}
            </button>
          ))}

          {selectedCamera && (
            <>
              <div className="pb-section-title" style={{ marginTop: 16 }}>Camera Info</div>
              <div className="pb-stats-card">
                <div className="pb-stats-row"><span>Camera</span><strong>{selectedCameraObj?.name || selectedCamera}</strong></div>
                <div className="pb-stats-row"><span>Oldest Recording</span><strong>{oldestRecording ? formatDate(oldestRecording.createdAt) : 'No recordings'}</strong></div>
                <div className="pb-stats-row"><span>Total Size</span><strong>{formatSize(totalRecordingBytes)}</strong></div>
                <div className="pb-stats-row"><span>Total Files</span><strong>{recordings.length}</strong></div>
              </div>

              <div className="pb-section-title" style={{ marginTop: 16 }}>Insight Relevance</div>
              <div className="pb-pref-card">
                <label><input type="checkbox" checked={insightPrefs.timeline} onChange={() => toggleInsight('timeline')} /> Timeline relevance</label>
                <label><input type="checkbox" checked={insightPrefs.pattern} onChange={() => toggleInsight('pattern')} /> Pattern relevance</label>
                <label><input type="checkbox" checked={insightPrefs.zones} onChange={() => toggleInsight('zones')} /> Zone relevance</label>
                <label><input type="checkbox" checked={insightPrefs.heatmap} onChange={() => toggleInsight('heatmap')} /> Heatmap relevance</label>
                <label><input type="checkbox" checked={insightPrefs.objects} onChange={() => toggleInsight('objects')} /> Object relevance</label>
                <label><input type="checkbox" checked={insightPrefs.objectEvents} onChange={() => toggleInsight('objectEvents')} /> Object events relevance</label>
                <label><input type="checkbox" checked={insightPrefs.faceRecognition} onChange={() => toggleInsight('faceRecognition')} /> Face recognition relevance</label>
                <label><input type="checkbox" checked={insightPrefs.faceEvents} onChange={() => toggleInsight('faceEvents')} /> Face events relevance</label>
              </div>

              <div className="pb-section-title" style={{ marginTop: 16 }}>Motion Mask</div>
              <div className="pb-mask-actions">
                <button className="pb-small-btn" type="button" onClick={() => setEditingMask(v => !v)}>{editingMask ? 'Hide Mask Grid' : 'Edit Mask Grid'}</button>
                <button className="pb-small-btn" type="button" onClick={resetMask}>Reset Full</button>
              </div>
              {editingMask && (
                <div className="pb-mask-grid" role="grid" aria-label="Motion mask editor">
                  {motionMask.map((enabled, idx) => (
                    <button key={idx} type="button" className={`pb-mask-cell ${enabled ? 'active' : ''}`} onClick={() => handleMaskToggle(idx)} />
                  ))}
                </div>
              )}

              <div className="pb-section-title" style={{ marginTop: 16 }}>Recordings</div>
              {lastUpdatedAt && <div className="pb-updated-at">Updated {new Date(lastUpdatedAt).toLocaleTimeString()}</div>}
              {loadingRec && <p className="pb-empty">Loading...</p>}
              {!loadingRec && recordings.length === 0 && <p className="pb-empty">No recordings yet.</p>}
              {recordings.map(rec => (
                <button key={rec.filename} className={`pb-rec-btn ${playingUrl === rec.url ? 'active' : ''}`} onClick={() => play(rec)}>
                  <div className="pb-rec-name">{rec.filename.replace(/\.mp4$/, '')}</div>
                  <div className={`pb-rec-desc ${rec.description ? '' : 'pending'}`}>
                    {rec.description || 'Preparing summary in background...'}
                  </div>
                  <div className="pb-rec-meta">{formatDate(rec.createdAt)} · {formatSize(rec.size)}</div>
                </button>
              ))}
            </>
          )}
        </aside>

        <div className="pb-main">
          {playingUrl ? (
            <>
              <div className="pb-toolbar-row">
                <div className="pb-control-group">
                  <span className="pb-control-label">Speed</span>
                  <div className="pb-speed-list">
                    {SPEED_OPTIONS.map(rate => (
                      <button key={rate} type="button" className={`pb-speed-btn ${playbackRate === rate ? 'active' : ''}`} onClick={() => setPlaybackRate(rate)}>{rate}x</button>
                    ))}
                  </div>
                </div>
                <div className="pb-control-group">
                  <button type="button" className={`pb-toggle-btn ${analysisEnabled ? 'active' : ''}`} onClick={() => setAnalysisEnabled(v => !v)}>
                    Analytics {analysisEnabled ? 'On' : 'Off'}
                  </button>
                  <button type="button" className="pb-toggle-btn" onClick={() => captureAndDownload(videoRef.current, selectedCamera || 'recording')} title="Take screenshot">
                    📷 Capture
                  </button>
                </div>
              </div>

              <div className="pb-video-frame">
                <video
                  ref={videoRef}
                  key={playingUrl}
                  src={playingUrl}
                  crossOrigin="anonymous"
                  controls
                  autoPlay
                  preload="auto"
                  playsInline
                  className="pb-video"
                  onError={() => setPlayError('This file is not ready yet. Try another recording or wait a few seconds.')}
                />
                <canvas ref={faceOverlayCanvasRef} className="pb-face-overlay" onClick={handleFaceOverlayClick} />
                <canvas ref={sampleCanvasRef} className="pb-sample-canvas" />
                <div className="pb-video-subtitle" title={playbackSubtitle}>{playbackSubtitle}</div>
              </div>

              {playError && <div className="pb-play-error-inline">{playError}</div>}
              {analysisError && <div className="pb-analysis-error-inline">{analysisError}</div>}

              {analysisEnabled && insightPrefs.timeline && (
                <div className="pb-timeline-wrap-inline">
                  <div className="pb-timeline-labels">
                    <span>Smart Timeline</span>
                    <span>{formatTime(videoCurrentTime)} / {formatTime(effectiveDuration)}</span>
                  </div>
                  <div className="pb-timeline-actions">
                    <button type="button" className="pb-time-jump-btn" onClick={() => jumpToPeak(-1)}>Prev Peak</button>
                    <button type="button" className="pb-time-jump-btn" onClick={() => jumpToPeak(1)}>Next Peak</button>
                    <button type="button" className="pb-time-jump-btn" onClick={() => seekBy(-10)}>-10s</button>
                    <button type="button" className="pb-time-jump-btn" onClick={() => seekBy(-5)}>-5s</button>
                    <button type="button" className="pb-time-jump-btn" onClick={() => seekBy(5)}>+5s</button>
                    <button type="button" className="pb-time-jump-btn" onClick={() => seekBy(10)}>+10s</button>
                    {TIMELINE_ZOOM_LEVELS.map(level => (
                      <button
                        key={level}
                        type="button"
                        className={`pb-time-jump-btn ${timelineZoom === level ? 'active' : ''}`}
                        onClick={() => setTimelineZoom(level)}
                        title={`Show ${Math.floor(TIMELINE_BINS / level)} bins`}
                      >
                        {level}x
                      </button>
                    ))}
                    <span className="pb-timeline-target">Target {formatTime(hoverTime == null ? videoCurrentTime : hoverTime)}</span>
                  </div>
                  <div
                    ref={timelineTrackRef}
                    className={`pb-timeline-track ${timelineDragging ? 'dragging' : ''}`}
                    role="slider"
                    aria-label="Smart timeline seek"
                    aria-valuemin={0}
                    aria-valuemax={Math.max(0, Math.round(effectiveDuration))}
                    aria-valuenow={Math.max(0, Math.round(videoCurrentTime))}
                    tabIndex={0}
                    onKeyDown={onTimelineKeyDown}
                    onMouseDown={onTimelineMouseDown}
                    onMouseMove={onTimelineMouseMove}
                    onMouseLeave={() => setTimelineHoverIndex(null)}
                    onTouchStart={onTimelineTouchStart}
                    onTouchMove={onTimelineTouchMove}
                  >
                    <div className="pb-timeline-bars" style={{ '--timeline-bins': visibleTimelineBins }}>
                    {timelineWindow.map(({ globalIndex, value }) => (
                      <span
                        key={globalIndex}
                        className={`pb-time-bar ${globalIndex <= currentTimelineIndex ? 'past' : ''} ${timelineHoverIndex === globalIndex ? 'hover' : ''}`}
                        style={{ '--h': `${Math.max(8, Math.round(value * 100))}%` }}
                        title={`Jump to ${formatTime((globalIndex / Math.max(1, TIMELINE_BINS - 1)) * effectiveDuration)}`}
                      />
                    ))}
                    </div>
                    <div className="pb-timeline-playhead" style={{ left: `${(effectiveDuration > 0 ? (videoCurrentTime / effectiveDuration) : 0) * 100}%` }} />
                  </div>
                  <div className="pb-timeline-markers">
                    {timelineMarkers.map(marker => (
                      <span key={marker.ratio}>{formatTime(marker.time)}</span>
                    ))}
                  </div>
                  <div className="pb-timeline-status">{analyticsLoading ? 'Analyzing recording...' : `Drag to scrub, arrow keys to nudge, ${peakIndices.length} motion peaks found`}</div>
                </div>
              )}

              {analysisEnabled && (
                <div className="pb-insights-grid">
                  {insightPrefs.pattern && (
                    <div className="pb-insight-card">
                      <div className="pb-insight-title">Pattern</div>
                      <div className="pb-pattern-row"><span className="pb-pattern-label">Detected Pattern</span><strong>{analysis.pattern}</strong></div>
                      <div className="pb-pattern-row"><span className="pb-pattern-label">Movement Level</span><strong>{Math.round(analysis.movement * 100)}%</strong></div>
                    </div>
                  )}

                  {insightPrefs.zones && (
                    <div className="pb-insight-card">
                      <div className="pb-insight-title">Top Zones</div>
                      <div className="pb-zone-list">
                        {analysis.topZones.map(zone => (
                          <span key={zone.name} className="pb-zone-chip">{zone.name} {Math.round(zone.value * 100)}%</span>
                        ))}
                        {!analysis.topZones.length && <span className="pb-pattern-label">No strong zones yet</span>}
                      </div>
                    </div>
                  )}

                  {insightPrefs.heatmap && (
                    <div className="pb-insight-card">
                      <div className="pb-insight-title">Heatmap (Outside Video)</div>
                      <div className="pb-mini-heatmap">
                        {analysis.heat.flatMap((row, r) => row.map((v, c) => (
                          <span key={`${r}-${c}`} className="pb-mini-heat" style={{ background: heatColor(v) }} title={`${zoneName(r, c)} ${Math.round(v * 100)}%`} />
                        )))}
                      </div>
                    </div>
                  )}

                  {insightPrefs.objects && (
                    <div className="pb-insight-card">
                      <div className="pb-insight-title">Objects</div>
                      <div className="pb-pattern-row"><span className="pb-pattern-label">Detector</span><strong>{detectorStatus}</strong></div>
                      <div className="pb-zone-list">
                        {objectDetections.map((obj, i) => (
                          <span key={`${obj.class}-${i}`} className="pb-zone-chip pb-obj-chip">{obj.class} {Math.round(obj.score * 100)}%</span>
                        ))}
                        {!objectDetections.length && <span className="pb-pattern-label">No current object detections</span>}
                      </div>
                    </div>
                  )}

                  {insightPrefs.objectEvents && (
                    <div className="pb-insight-card">
                      <div className="pb-insight-title">Recent Object Events</div>
                      <div className="pb-zone-list">
                        {objectEvents.slice(-6).map((evt, i) => (
                          <span key={`${evt.time}-${i}`} className="pb-zone-chip pb-obj-chip">{evt.time.toFixed(1)}s: {evt.labels.join(', ')}</span>
                        ))}
                        {!objectEvents.length && <span className="pb-pattern-label">No object events yet</span>}
                      </div>
                    </div>
                  )}

                  {insightPrefs.faceRecognition && (
                    <div className="pb-insight-card">
                      <div className="pb-insight-title">Face Recognition</div>
                      <div className="pb-pattern-row"><span className="pb-pattern-label">Face Engine</span><strong>{faceStatus}</strong></div>
                      <div className="pb-face-guide">
                        <div className="pb-pattern-label"><strong>How to tag:</strong></div>
                        <div className="pb-pattern-label">1. Press a face box in the video.</div>
                        <div className="pb-pattern-label">2. Write a name below and press Save Tag.</div>
                      </div>
                      {!knownFaces.length && (
                        <div className="pb-pattern-label">Tag one visible face first, then future matches will be recognized automatically.</div>
                      )}

                      {!selectedFace && <div className="pb-pattern-label">No marker selected yet. Press a face box in the video.</div>}
                      {selectedFace && (
                        <div className="pb-face-selected">
                          <div className="pb-pattern-row">
                            <span className="pb-pattern-label">Selected Marker</span>
                            <strong>{selectedFace.label || 'Unknown'}</strong>
                          </div>
                          <canvas ref={facePreviewCanvasRef} className="pb-face-preview" />
                          <div className="pb-face-item">
                            <input
                              ref={faceNameInputRef}
                              className="pb-face-input"
                              placeholder="Type person name"
                              value={faceTagInputs[selectedFace.id] || ''}
                              onChange={(e) => setFaceInput(selectedFace.id, e.target.value)}
                              onKeyDown={(e) => handleFaceInputKeyDown(e, selectedFace)}
                            />
                            <button className="pb-small-btn" type="button" onClick={() => tagFace(selectedFace)}>Save Tag</button>
                            <button className="pb-small-btn" type="button" onClick={() => selectNextUnknownFace(selectedFace.id)}>Next Unknown</button>
                          </div>
                        </div>
                      )}

                      <div className="pb-face-list">
                        {currentFaces.filter(face => face.label).map(face => (
                          <div key={face.id} className="pb-face-item">
                            <span className="pb-zone-chip pb-face-known">{face.label} ({Math.round((1 - (face.distance || 0)) * 100)}%)</span>
                          </div>
                        ))}
                        {unknownFacesCount > 0 && (
                          <span className="pb-zone-chip pb-face-unknown">Unknown faces: {unknownFacesCount}</span>
                        )}
                        {!currentFaces.length && <span className="pb-pattern-label">No faces currently detected</span>}
                      </div>

                      <div className="pb-pattern-row pb-known-head">
                        <span className="pb-pattern-label">Known Faces ({knownFaces.length})</span>
                        {!!knownFaces.length && <button className="pb-small-btn" type="button" onClick={clearKnownFaces}>Clear</button>}
                      </div>
                      <div className="pb-zone-list">
                        {knownFaces.map(face => (
                          <span key={face.id} className="pb-zone-chip pb-face-known">
                            {face.label}
                            <button className="pb-chip-x" type="button" onClick={() => removeKnownFace(face.id)}>x</button>
                          </span>
                        ))}
                        {!knownFaces.length && <span className="pb-pattern-label">No tagged faces yet</span>}
                      </div>
                    </div>
                  )}

                  {insightPrefs.faceEvents && (
                    <div className="pb-insight-card">
                      <div className="pb-insight-title">Face Events</div>
                      <div className="pb-zone-list">
                        {faceEvents.slice(-10).map((evt, i) => (
                          <span key={`${evt.time}-${evt.label}-${i}`} className={`pb-zone-chip ${evt.label === 'Unknown' ? 'pb-face-unknown' : 'pb-face-known'}`}>
                            {evt.time.toFixed(1)}s: {evt.label}
                          </span>
                        ))}
                        {!faceEvents.length && <span className="pb-pattern-label">No face events yet</span>}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="pb-no-video">{selectedCamera ? 'Select a recording from the list to play.' : 'Select a camera, then choose a recording.'}</div>
          )}
        </div>
      </div>
    </div>
  );
}
