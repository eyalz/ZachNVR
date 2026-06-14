import { useState, useEffect, useRef } from 'react';
import { useCameras } from '../hooks/useCameras';
import './Playback.css';

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(d) {
  return new Date(d).toLocaleString();
}

export default function Playback() {
  const { cameras } = useCameras();
  const [selectedCamera, setSelectedCamera] = useState(null);
  const [recordings, setRecordings] = useState([]);
  const [loadingRec, setLoadingRec] = useState(false);
  const [playingUrl, setPlayingUrl] = useState(null);
  const videoRef = useRef(null);

  // Load recordings when camera selection changes
  useEffect(() => {
    if (!selectedCamera) { setRecordings([]); return; }
    setLoadingRec(true);
    fetch(`/api/recordings/${selectedCamera}`)
      .then(r => r.json())
      .then(d => setRecordings(d.recordings || []))
      .catch(() => setRecordings([]))
      .finally(() => setLoadingRec(false));
  }, [selectedCamera]);

  const play = (url) => {
    setPlayingUrl(url);
    // Let the video element update then play
    setTimeout(() => videoRef.current?.play().catch(() => {}), 100);
  };

  const camsWithRecordings = cameras; // show all; filter in the UI

  return (
    <div className="pb-root">
      <div className="page-header">
        <h1>Playback</h1>
      </div>

      <div className="pb-layout">
        {/* Left: camera + file list */}
        <aside className="pb-sidebar">
          <div className="pb-section-title">Select Camera</div>
          {cameras.length === 0 && <p className="pb-empty">No cameras configured.</p>}
          {cameras.map(cam => (
            <button
              key={cam.id}
              className={`pb-cam-btn ${selectedCamera === cam.id ? 'active' : ''}`}
              onClick={() => { setSelectedCamera(cam.id); setPlayingUrl(null); }}
            >
              <span>{cam.name}</span>
              {cam.record && <span className="badge badge-rec" style={{ fontSize: 10 }}>REC</span>}
            </button>
          ))}

          {selectedCamera && (
            <>
              <div className="pb-section-title" style={{ marginTop: 16 }}>Recordings</div>
              {loadingRec && <p className="pb-empty">Loading…</p>}
              {!loadingRec && recordings.length === 0 && (
                <p className="pb-empty">No recordings yet.</p>
              )}
              {recordings.map(rec => (
                <button
                  key={rec.filename}
                  className={`pb-rec-btn ${playingUrl === rec.url ? 'active' : ''}`}
                  onClick={() => play(rec.url)}
                >
                  <div className="pb-rec-name">{rec.filename.replace(/\.mp4$/, '')}</div>
                  <div className="pb-rec-meta">{formatDate(rec.createdAt)} · {formatSize(rec.size)}</div>
                </button>
              ))}
            </>
          )}
        </aside>

        {/* Right: video player */}
        <div className="pb-player-area">
          {playingUrl ? (
            <video
              ref={videoRef}
              key={playingUrl}
              src={playingUrl}
              controls
              autoPlay
              className="pb-video"
            />
          ) : (
            <div className="pb-no-video">
              {selectedCamera
                ? 'Select a recording from the list to play.'
                : 'Select a camera, then choose a recording.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
