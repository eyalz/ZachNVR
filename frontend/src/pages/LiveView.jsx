import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCameras } from '../hooks/useCameras';
import CameraCard from '../components/CameraCard';
import './LiveView.css';

const LIVE_VIEW_PREFS_KEY = 'zachnvr.liveView.prefs.v1';

function loadLiveViewPrefs() {
  try {
    const raw = localStorage.getItem(LIVE_VIEW_PREFS_KEY);
    if (!raw) {
      return { selected: null, layout: 'grid', liveAnalyticsEnabled: true };
    }

    const parsed = JSON.parse(raw);
    return {
      selected: typeof parsed.selected === 'string' ? parsed.selected : null,
      layout: parsed.layout === 'single' ? 'single' : 'grid',
      liveAnalyticsEnabled: typeof parsed.liveAnalyticsEnabled === 'boolean' ? parsed.liveAnalyticsEnabled : true,
    };
  } catch {
    return { selected: null, layout: 'grid', liveAnalyticsEnabled: true };
  }
}

export default function LiveView() {
  const initialPrefs = loadLiveViewPrefs();
  const navigate = useNavigate();
  const { cameras, loading } = useCameras();
  const [selected, setSelected] = useState(initialPrefs.selected); // single camera focus
  const [layout, setLayout] = useState(initialPrefs.layout); // 'grid' | 'single'
  const [liveAnalyticsEnabled, setLiveAnalyticsEnabled] = useState(initialPrefs.liveAnalyticsEnabled);

  const recordingCameras = cameras.filter(c => c.record || c.rtspUrl);

  const handleSelect = (cam) => {
    setSelected(cam.id === selected ? null : cam.id);
    setLayout('single');
  };

  const selectedCamera = cameras.find(c => c.id === selected);

  useEffect(() => {
    if (loading) return;
    if (selected && !recordingCameras.some(c => c.id === selected)) {
      setSelected(null);
    }
  }, [selected, recordingCameras, loading]);

  useEffect(() => {
    localStorage.setItem(LIVE_VIEW_PREFS_KEY, JSON.stringify({
      selected,
      layout,
      liveAnalyticsEnabled,
    }));
  }, [selected, layout, liveAnalyticsEnabled]);

  const analyticsModeFor = (camId) => {
    void camId;
    if (!liveAnalyticsEnabled) return 'off';
    // Always run full analytics so people/dog/face badges stay visible in both grid and single modes.
    return 'full';
  };

  const handlePlay = (cam) => {
    navigate(`/playback?camera=${encodeURIComponent(cam.id)}`);
  };

  if (loading) {
    return <div className="lv-empty">Loading cameras…</div>;
  }

  if (recordingCameras.length === 0) {
    return (
      <div className="lv-empty">
        <p>No cameras configured.</p>
        <p>Go to <strong>Cameras</strong> to scan and select cameras to display.</p>
      </div>
    );
  }

  return (
    <div className="lv-root">
      <div className="page-header">
        <h1>Live View</h1>
        <div className="actions">
          <button
            className={`btn-ghost ${liveAnalyticsEnabled ? 'active-layout' : ''}`}
            onClick={() => setLiveAnalyticsEnabled(v => !v)}
          >
            {liveAnalyticsEnabled ? 'Live AI On' : 'Live AI Off'}
          </button>
          <button
            className={`btn-ghost ${layout === 'grid' ? 'active-layout' : ''}`}
            onClick={() => { setLayout('grid'); }}
          >⊞ Grid</button>
          <button
            className={`btn-ghost ${layout === 'single' ? 'active-layout' : ''}`}
            disabled={!selectedCamera}
            onClick={() => setLayout('single')}
          >▣ Single</button>
        </div>
      </div>

      {layout === 'grid' ? (
        <div
          className="lv-grid"
          style={{ gridTemplateColumns: `repeat(${Math.min(Math.ceil(Math.sqrt(recordingCameras.length)), 3)}, 1fr)` }}
        >
          {recordingCameras.map(cam => (
            <CameraCard
              key={cam.id}
              camera={cam}
              onSelect={handleSelect}
              isSelected={cam.id === selected}
              onPlay={handlePlay}
              liveAnalyticsMode={analyticsModeFor(cam.id)}
            />
          ))}
        </div>
      ) : (
        <div className="lv-single">
          {/* Camera selector tabs */}
          <div className="lv-tabs">
            {recordingCameras.map(cam => (
              <button
                key={cam.id}
                className={`lv-tab ${cam.id === selected ? 'active' : ''}`}
                onClick={() => setSelected(cam.id)}
              >
                {cam.name}
              </button>
            ))}
          </div>
          {selectedCamera ? (
            <div className="lv-focus">
              <CameraCard
                camera={selectedCamera}
                isSelected
                onPlay={handlePlay}
                liveAnalyticsMode={analyticsModeFor(selectedCamera.id)}
              />
            </div>
          ) : (
            <div className="lv-empty">Select a camera above.</div>
          )}
        </div>
      )}
    </div>
  );
}
