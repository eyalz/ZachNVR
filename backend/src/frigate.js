/**
 * frigate.js — Integration with Frigate NVR for analytics
 * Provides object detection, person tracking, and event data from Frigate API
 */

const FRIGATE_URL = process.env.FRIGATE_URL || 'http://localhost:5000';

async function getFrigateEvents(cameraName, startTime, endTime) {
  /**
   * Fetch events from Frigate between timestamps
   * Returns array of { time, label, confidence, zone }
   */
  try {
    const params = new URLSearchParams();
    if (startTime) params.append('after', Math.floor(startTime));
    if (endTime) params.append('before', Math.floor(endTime));
    
    const response = await fetch(`${FRIGATE_URL}/api/events?camera=${cameraName}&${params}`, {
      timeout: 5000,
    });
    
    if (!response.ok) return [];
    
    const events = await response.json();
    return Array.isArray(events) ? events : [];
  } catch (err) {
    console.error(`[Frigate] Failed to fetch events for ${cameraName}:`, err.message);
    return [];
  }
}

async function getFrigateStats(cameraName, startTime, endTime) {
  /**
   * Fetch statistics from Frigate for a camera/time period
   * Returns { people: count, dogs: count, cars: count, motion: % }
   */
  try {
    const events = await getFrigateEvents(cameraName, startTime, endTime);
    
    const labelCounts = {};
    events.forEach(evt => {
      if (evt.label) {
        labelCounts[evt.label] = (labelCounts[evt.label] || 0) + 1;
      }
    });
    
    return {
      people: labelCounts.person || 0,
      dogs: labelCounts.dog || 0,
      cats: labelCounts.cat || 0,
      cars: labelCounts.car || 0,
      motion: Math.min(1, (events.length / 10) * 0.5), // Normalize motion
      rawLabels: labelCounts,
      eventCount: events.length,
    };
  } catch (err) {
    console.error(`[Frigate] Failed to fetch stats for ${cameraName}:`, err.message);
    return null;
  }
}

async function getFrigateRecordingStats(cameraName, startTime, endTime) {
  /**
   * Get statistics for a recording segment from Frigate
   * Returns timeline data and object detections
   */
  try {
    const response = await fetch(
      `${FRIGATE_URL}/api/stats?camera=${cameraName}&start=${Math.floor(startTime)}&end=${Math.floor(endTime)}`,
      { timeout: 10000 }
    );
    
    if (!response.ok) return null;
    
    const data = await response.json();
    return {
      duration: endTime - startTime,
      events: data.events || [],
      timeline: buildTimeline(data.events || [], endTime - startTime),
      objectCounts: summarizeObjects(data.events || []),
    };
  } catch (err) {
    console.error(`[Frigate] Failed to fetch recording stats:`, err.message);
    return null;
  }
}

function buildTimeline(events, duration) {
  /**
   * Build a 96-bin timeline from Frigate events
   */
  const bins = Array(96).fill(0);
  events.forEach(evt => {
    if (evt.start_time && duration) {
      const idx = Math.min(95, Math.floor((evt.start_time / duration) * 96));
      bins[idx] += 1;
    }
  });
  
  const max = Math.max(...bins, 1);
  return bins.map(v => Number((v / max).toFixed(3)));
}

function summarizeObjects(events) {
  /**
   * Summarize object detections from events
   * Returns counts by label
   */
  const summary = {};
  events.forEach(evt => {
    if (evt.label) {
      summary[evt.label] = (summary[evt.label] || 0) + 1;
    }
  });
  return summary;
}

async function isFrigateAvailable() {
  /**
   * Check if Frigate is running and accessible
   */
  try {
    const response = await fetch(`${FRIGATE_URL}/api/config`, { timeout: 3000 });
    return response.ok;
  } catch {
    return false;
  }
}

module.exports = {
  getFrigateEvents,
  getFrigateStats,
  getFrigateRecordingStats,
  isFrigateAvailable,
  FRIGATE_URL,
};
