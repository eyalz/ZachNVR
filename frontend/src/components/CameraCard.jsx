import { useState, useEffect, useCallback, useRef } from 'react';
import HlsPlayer from './HlsPlayer';
import { apiFetchJson, backendAssetUrl } from '../lib/api';
import { captureAndDownload } from '../lib/captureUtils';
import './CameraCard.css';

/**
 * CameraCard — live feed tile used in the grid view.
 */
export default function CameraCard({ camera, onSelect, isSelected, onPlay, liveAnalyticsMode = 'off' }) {
  const [hlsUrl, setHlsUrl] = useState(null);
  const [starting, setStarting] = useState(false);
  const [ready, setReady] = useState(false);
  const [pollTimer, setPollTimer] = useState(null);
  const [liveAnalytics, setLiveAnalytics] = useState(null);
  const [liveAnalyticsError, setLiveAnalyticsError] = useState('');
  const videoRef = useRef(null);

  const startStream = useCallback(async () => {
    if (!camera.rtspUrl) return;
    setStarting(true);
    try {
      const data = await apiFetchJson(`/cameras/${camera.id}/live/start`, { method: 'POST' });
      setHlsUrl(backendAssetUrl(data.hlsUrl));
      // Poll until HLS playlist is ready
      const timer = setInterval(async () => {
        try {
          const s = await apiFetchJson(`/stream/${camera.id}/status`);
          if (s.ready) {
            setReady(true);
            clearInterval(timer);
          }
        } catch {
          // Keep polling; startup can race with ffmpeg initialization.
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
      apiFetchJson(`/cameras/${camera.id}/live/stop`, { method: 'POST' }).catch(() => {});
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
          ? (
            <HlsPlayer
              ref={videoRef}
              src={hlsUrl}
              analyticsMode={liveAnalyticsMode}
              onAnalytics={setLiveAnalytics}
              onAnalyticsError={setLiveAnalyticsError}
            />
          )
          : (
            <div className="camera-card-placeholder">
              {!camera.rtspUrl
                ? <span>No stream URL</span>
                : starting
                ? <span>Connecting…</span>
                : <span>Waiting for stream…</span>}
            </div>
          )}
        {!!liveAnalyticsError && (
          <div className="camera-live-error" title={liveAnalyticsError}>
            Live AI error: {liveAnalyticsError}
          </div>
        )}
        {liveAnalyticsMode !== 'off' && liveAnalytics?.subtitle && !liveAnalyticsError && (
          <div className="camera-live-subtitle" title={liveAnalytics.subtitle}>
            {liveAnalytics.subtitle}
          </div>
        )}
      </div>
      <div className="camera-card-footer">
        <span className="camera-name">{camera.name}</span>
        <span className={`badge ${camera.online ? 'badge-online' : 'badge-offline'}`}>
          {camera.online ? 'Online' : 'Offline'}
        </span>
        {camera.record && <span className="badge badge-rec">● REC</span>}
        {liveAnalyticsMode !== 'off' && liveAnalytics && (
          <>
            <span
              className="badge badge-ai"
              title="Motion level in the current live view"
              aria-label={`Motion ${Math.round((liveAnalytics.motion || 0) * 100)} percent`}
            >
              M {Math.round((liveAnalytics.motion || 0) * 100)}%
            </span>
            {liveAnalyticsMode === 'full' && (
              <>
                <span
                  className="badge badge-ai"
                  title="People detected right now"
                  aria-label={`People detected ${liveAnalytics.people || 0}`}
                >
                  P {liveAnalytics.people || 0}
                </span>
                <span
                  className="badge badge-ai"
                  title="Dogs detected right now"
                  aria-label={`Dogs detected ${liveAnalytics.dogs || 0}`}
                >
                  D {liveAnalytics.dogs || 0}
                </span>
                <span
                  className="badge badge-ai"
                  title="Faces detected right now"
                  aria-label={`Faces detected ${liveAnalytics.faces || 0}`}
                >
                  F {liveAnalytics.faces || 0}
                </span>
              </>
            )}
          </>
        )}
        {ready && (
          <button
            type="button"
            className="camera-play-btn"
            onClick={(e) => {
              e.stopPropagation();
              captureAndDownload(videoRef.current, camera.name);
            }}
            title="Take screenshot"
          >
            📷 Capture
          </button>
        )}
        {onPlay && (
          <button
            type="button"
            className="camera-play-btn"
            onClick={(e) => {
              e.stopPropagation();
              onPlay(camera);
            }}
          >
            ▶ Play
          </button>
        )}
      </div>
    </div>
  );
}
