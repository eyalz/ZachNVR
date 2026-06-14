import { useState } from 'react';
import { useCameras } from '../hooks/useCameras';
import './Cameras.css';

function AddCameraModal({ onAdd, onClose }) {
  const [form, setForm] = useState({ name: '', rtspUrl: '', username: '', password: '' });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    await onAdd(form);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Add Camera Manually</h2>
        <form onSubmit={submit}>
          <div className="form-row">
            <label>Camera Name</label>
            <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Front Door" />
          </div>
          <div className="form-row">
            <label>RTSP URL *</label>
            <input required value={form.rtspUrl} onChange={e => set('rtspUrl', e.target.value)} placeholder="rtsp://192.168.1.x:554/stream" />
          </div>
          <div className="form-row">
            <label>Username</label>
            <input value={form.username} onChange={e => set('username', e.target.value)} placeholder="admin" />
          </div>
          <div className="form-row">
            <label>Password</label>
            <input type="password" value={form.password} onChange={e => set('password', e.target.value)} />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary">Add Camera</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CameraRow({ camera, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: camera.name, username: camera.username, password: camera.password, rtspUrl: camera.rtspUrl || '' });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    await onUpdate(camera.id, form);
    setEditing(false);
  };

  const toggleRecord = () => onUpdate(camera.id, { record: !camera.record });

  return (
    <div className="cam-row card">
      {editing ? (
        <div className="cam-edit">
          <div className="form-inline">
            <div className="form-row">
              <label>Name</label>
              <input value={form.name} onChange={e => set('name', e.target.value)} />
            </div>
            <div className="form-row">
              <label>RTSP URL</label>
              <input value={form.rtspUrl} onChange={e => set('rtspUrl', e.target.value)} />
            </div>
            <div className="form-row">
              <label>Username</label>
              <input value={form.username} onChange={e => set('username', e.target.value)} />
            </div>
            <div className="form-row">
              <label>Password</label>
              <input type="password" value={form.password} onChange={e => set('password', e.target.value)} />
            </div>
          </div>
          <div className="cam-row-actions">
            <button className="btn-primary" onClick={save}>Save</button>
            <button className="btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="cam-info">
          <div className="cam-main">
            <span className="cam-name">{camera.name}</span>
            <span className={`badge ${camera.online ? 'badge-online' : 'badge-offline'}`}>
              {camera.online ? 'Online' : 'Offline'}
            </span>
            {camera.record && <span className="badge badge-rec">● REC</span>}
          </div>
          <div className="cam-meta">
            <span className="cam-url">{camera.rtspUrl || camera.xaddr || '—'}</span>
          </div>
          <div className="cam-row-actions">
            <button
              className={camera.record ? 'btn-danger' : 'btn-success'}
              onClick={toggleRecord}
            >
              {camera.record ? '⏹ Stop Recording' : '⏺ Record'}
            </button>
            <button className="btn-ghost" onClick={() => setEditing(true)}>✏️ Edit</button>
            <button className="btn-danger" onClick={() => onDelete(camera.id)}>🗑 Remove</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Cameras() {
  const { cameras, loading, error, scan, updateCamera, addCamera, deleteCamera } = useCameras();
  const [showAdd, setShowAdd] = useState(false);

  return (
    <div>
      <div className="page-header">
        <h1>Cameras</h1>
        <div className="actions">
          <button className="btn-ghost" onClick={() => setShowAdd(true)}>+ Add Manually</button>
          <button className="btn-primary" onClick={scan} disabled={loading}>
            {loading ? 'Scanning…' : '🔍 Scan Network (ONVIF)'}
          </button>
        </div>
      </div>

      {error && <div className="error-banner">Error: {error}</div>}

      {cameras.length === 0 && !loading && (
        <div className="empty-state card">
          <p>No cameras found yet.</p>
          <p>Click <strong>Scan Network</strong> to discover ONVIF cameras on your local network, or add one manually.</p>
        </div>
      )}

      <div className="cam-list">
        {cameras.map(cam => (
          <CameraRow
            key={cam.id}
            camera={cam}
            onUpdate={updateCamera}
            onDelete={deleteCamera}
          />
        ))}
      </div>

      {showAdd && <AddCameraModal onAdd={addCamera} onClose={() => setShowAdd(false)} />}
    </div>
  );
}
