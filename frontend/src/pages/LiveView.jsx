import { useState } from 'react';
import { useCameras } from '../hooks/useCameras';
import CameraCard from '../components/CameraCard';
import HlsPlayer from '../components/HlsPlayer';
import './LiveView.css';

export default function LiveView() {
  const { cameras, loading } = useCameras();
  const [selected, setSelected] = useState(null); // single camera focus
  const [layout, setLayout] = useState('grid'); // 'grid' | 'single'

  const recordingCameras = cameras.filter(c => c.record || c.rtspUrl);

  const handleSelect = (cam) => {
    setSelected(cam.id === selected ? null : cam.id);
    setLayout('single');
  };

  const selectedCamera = cameras.find(c => c.id === selected);

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
            className={`btn-ghost ${layout === 'grid' ? 'active-layout' : ''}`}
            onClick={() => { setLayout('grid'); setSelected(null); }}
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
              <CameraCard camera={selectedCamera} isSelected />
            </div>
          ) : (
            <div className="lv-empty">Select a camera above.</div>
          )}
        </div>
      )}
    </div>
  );
}
