import { useState, useEffect, useCallback } from 'react';

const API = '/api';

export function useCameras() {
  const [cameras, setCameras] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/cameras`);
      const data = await res.json();
      setCameras(data.cameras || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetch_(); }, [fetch_]);

  const scan = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/discovery/scan`, { method: 'POST' });
      const data = await res.json();
      setCameras(prev => {
        const map = Object.fromEntries(prev.map(c => [c.id, c]));
        (data.cameras || []).forEach(c => { map[c.id] = { ...map[c.id], ...c }; });
        return Object.values(map);
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const updateCamera = useCallback(async (id, updates) => {
    const res = await fetch(`${API}/cameras/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    const data = await res.json();
    if (data.camera) {
      setCameras(prev => prev.map(c => c.id === id ? { ...c, ...data.camera } : c));
    }
    return data;
  }, []);

  const addCamera = useCallback(async (payload) => {
    const res = await fetch(`${API}/cameras`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.camera) setCameras(prev => [...prev, data.camera]);
    return data;
  }, []);

  const deleteCamera = useCallback(async (id) => {
    await fetch(`${API}/cameras/${id}`, { method: 'DELETE' });
    setCameras(prev => prev.filter(c => c.id !== id));
  }, []);

  const startLive = useCallback(async (id) => {
    const res = await fetch(`${API}/cameras/${id}/live/start`, { method: 'POST' });
    return res.json();
  }, []);

  const stopLive = useCallback(async (id) => {
    await fetch(`${API}/cameras/${id}/live/stop`, { method: 'POST' });
  }, []);

  return { cameras, loading, error, refresh: fetch_, scan, updateCamera, addCamera, deleteCamera, startLive, stopLive };
}
