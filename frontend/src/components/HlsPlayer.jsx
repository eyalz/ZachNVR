import { useEffect, useRef, useCallback } from 'react';
import Hls from 'hls.js';

/**
 * HLS video player component.
 * Props:
 *  - src: HLS playlist URL (string)
 *  - style: optional inline styles
 */
export default function HlsPlayer({ src, style = {} }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);

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
        video.play().catch(() => {});
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

  return (
    <video
      ref={videoRef}
      controls
      muted
      autoPlay
      playsInline
      style={{ width: '100%', height: '100%', background: '#000', display: 'block', ...style }}
    />
  );
}
