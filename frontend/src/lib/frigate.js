/**
 * frigate.js — Frontend Frigate integration utilities
 */

let frigateAvailable = null;

export async function isFrigateAvailable() {
  if (frigateAvailable !== null) return frigateAvailable;
  
  try {
    const response = await fetch('/api/frigate/status', { timeout: 3000 });
    if (!response.ok) {
      frigateAvailable = false;
      return false;
    }
    
    const data = await response.json();
    frigateAvailable = data.available === true;
    
    if (frigateAvailable) {
      console.log('[Frigate] NVR analytics enabled:', data.url);
    }
    
    return frigateAvailable;
  } catch (err) {
    console.log('[Frigate] Not available:', err.message);
    frigateAvailable = false;
    return false;
  }
}

export function resetFrigateCache() {
  frigateAvailable = null;
}
