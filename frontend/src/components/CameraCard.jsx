import { useState, useEffect, useCallback } from 'react';
import HlsPlayer from './HlsPlayer';
import './CameraCard.css';

/**
 * CameraCard — live feed tile used in the grid view.
 */
export default function CameraCard({ camera, onSelect, isSelected }) {
  const [hlsUrl, setHlsUrl] = useState(null);
  const [starting, setStarting] = useState(false);
  const [ready, setReady] = useState(false);
  const [pollTimer, setPollTimer] = useState(null);

  const startStream = useCallback(async () => {
    if (!camera.rtspUrl) return;
    setStarting(true);
    try {
      const res = await fetch(`/api/cameras/${camera.id}/live/start`, { method: 'POST' });
      const data = await res.json();
      setHlsUrl(data.hlsUrl);
      // Poll until HLS playlist is ready
      const timer = setInterval(async () => {
        const sr = await fetch(`/api/stream/${camera.id}/status`);
        const s = await sr.json();
        if (s.ready) {
          setReady(true);
          clearInterval(timer);
        }
      }, 1000);
      setPollTimer(timer);
    } finally {
      setStarting(false);
    }
  }, [camera.id, camera.rtspUrl]);

  useEffect(() => {
    startStream();
    return () => {
      if (pollTimer) clearInterval(pollTimer);
      fetch(`/api/cameras/${camera.id}/live/stop`, { method: 'POST' }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera.id]);

  return (
    <div
      className={`camera-card${isSelected ? ' selected' : ''}`}
      onClick={() => onSelect && onSelect(camera)}
    >
      <div className="camera-card-video">
        {ready && hlsUrl
          ? <HlsPlayer src={hlsUrl} />
          : (
            <div className="camera-card-placeholder">
              {!camera.rtspUrl
                ? <span>No stream URL</span>
                : starting
                ? <span>Connecting…</span>
                : <span>Waiting for stream…</span>}
            </div>
          )}
      </div>
      <div className="camera-card-footer">
        <span className="camera-name">{camera.name}</span>
        <span className={`badge ${camera.online ? 'badge-online' : 'badge-offline'}`}>
          {camera.online ? 'Online' : 'Offline'}
        </span>
        {camera.record && <span className="badge badge-rec">● REC</span>}
      </div>
    </div>
  );
}
