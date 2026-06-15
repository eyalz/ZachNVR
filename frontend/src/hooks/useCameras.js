import { useState, useEffect, useCallback } from 'react';
import { apiFetchJson } from '../lib/api';

export function useCameras() {
  const [cameras, setCameras] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetchJson('/cameras');
      setCameras(data.cameras || []);
    } catch (e) {
      setError(`Cannot reach backend. ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetch_(); }, [fetch_]);

  const scan = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetchJson('/discovery/scan', { method: 'POST' });
      setCameras(prev => {
        const map = Object.fromEntries(prev.map(c => [c.id, c]));
        (data.cameras || []).forEach(c => { map[c.id] = { ...map[c.id], ...c }; });
        return Object.values(map);
      });
    } catch (e) {
      setError(`Cannot reach backend. ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const updateCamera = useCallback(async (id, updates) => {
    const data = await apiFetchJson(`/cameras/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (data.camera) {
      setCameras(prev => prev.map(c => c.id === id ? { ...c, ...data.camera } : c));
    }
    return data;
  }, []);

  const addCamera = useCallback(async (payload) => {
    const data = await apiFetchJson('/cameras', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (data.camera) setCameras(prev => [...prev, data.camera]);
    return data;
  }, []);

  const deleteCamera = useCallback(async (id) => {
    await apiFetchJson(`/cameras/${id}`, { method: 'DELETE' });
    setCameras(prev => prev.filter(c => c.id !== id));
  }, []);

  const startLive = useCallback(async (id) => {
    return apiFetchJson(`/cameras/${id}/live/start`, { method: 'POST' });
  }, []);

  const stopLive = useCallback(async (id) => {
    await apiFetchJson(`/cameras/${id}/live/stop`, { method: 'POST' });
  }, []);

  return { cameras, loading, error, refresh: fetch_, scan, updateCamera, addCamera, deleteCamera, startLive, stopLive };
}
