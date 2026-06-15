/**
 * describer.js — LLM-based video description generation
 * Generates natural language summaries of what happened in recordings
 */

const fs = require('fs');
const path = require('path');

const DESCRIPTIONS_DIR = path.join(__dirname, '../../recordings-descriptions');
const DESCRIPTION_SCHEMA_VERSION = 2;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getDescriptionPath(cameraId, filename) {
  return path.join(DESCRIPTIONS_DIR, cameraId, `${filename}.json`);
}

function readCachedDescription(cachePath) {
  if (!fs.existsSync(cachePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
  } catch {
    return null;
  }
}

function writeCachedDescription(cachePath, description) {
  ensureDir(path.dirname(cachePath));
  fs.writeFileSync(cachePath, JSON.stringify(description, null, 2));
}

function movementSummary(analytics) {
  const timeline = Array.isArray(analytics?.movementTimeline) ? analytics.movementTimeline : [];
  if (!timeline.length) return 'movement was low and steady';

  const mean = timeline.reduce((a, b) => a + b, 0) / timeline.length;
  const max = Math.max(...timeline, 0);
  const activeBins = timeline.filter(v => v > 0.35).length;

  if (max < 0.12) return 'the scene stayed mostly static';
  if (activeBins > timeline.length * 0.55) return 'movement happened during most of the recording';
  if (mean > 0.35) return 'movement was moderate throughout the clip';
  return 'movement happened in short bursts';
}

function eventSummary(analytics) {
  const events = Array.isArray(analytics?.events) ? analytics.events : [];
  if (!events.length) {
    const sceneCount = Array.isArray(analytics?.sceneEvents) ? analytics.sceneEvents.length : 0;
    return sceneCount > 0
      ? `${sceneCount} notable scene changes were detected`
      : 'no major event transitions were detected';
  }

  const counts = {};
  events.forEach((e) => {
    const key = (e?.label || e?.type || 'event').toLowerCase();
    counts[key] = (counts[key] || 0) + 1;
  });

  const top = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, v]) => `${v} ${k}${v > 1 ? 's' : ''}`);

  return top.length ? `key events included ${top.join(', ')}` : 'events were sparse';
}

async function generateWithOpenAI(analytics, cameraName) {
  /**
   * Use OpenAI API to generate description
   */
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const prompt = buildPrompt(analytics, cameraName);
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'You are a security camera analyst. Generate a single, concise sentence describing what happened in the video recording. Be specific about objects detected and actions observed.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: 100,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      console.error('[Describer] OpenAI API error:', response.status);
      return null;
    }

    const data = await response.json();
    const description = data.choices?.[0]?.message?.content?.trim();
    return description || null;
  } catch (err) {
    console.error('[Describer] OpenAI error:', err.message);
    return null;
  }
}

async function generateWithAnthropic(analytics, cameraName) {
  /**
   * Use Anthropic Claude API to generate description
   */
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  try {
    const prompt = buildPrompt(analytics, cameraName);
    
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 100,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      console.error('[Describer] Anthropic API error:', response.status);
      return null;
    }

    const data = await response.json();
    const description = data.content?.[0]?.text?.trim();
    return description || null;
  } catch (err) {
    console.error('[Describer] Anthropic error:', err.message);
    return null;
  }
}

function buildPrompt(analytics, cameraName) {
  /**
   * Build a prompt for LLM based on analytics data
   */
  const parts = [];
  
  parts.push(`Camera: ${cameraName}`);
  parts.push(`Duration: ${(analytics.duration || 0).toFixed(1)}s`);
  
  if (analytics.objectCounts) {
    const counts = Object.entries(analytics.objectCounts)
      .map(([k, v]) => `${v} ${k}(s)`)
      .join(', ');
    if (counts) parts.push(`Objects detected: ${counts}`);
  }

  if (analytics.namedFaces && analytics.namedFaces.length > 0) {
    parts.push(`Recognized people: ${analytics.namedFaces.join(', ')}`);
  }
  
  if (analytics.events && analytics.events.length > 0) {
    const labels = [...new Set(analytics.events.map(e => e.label))];
    if (labels.length > 0) {
      parts.push(`Key detections: ${labels.join(', ')}`);
    }
  }
  
  if (analytics.movementTimeline) {
    const motion = analytics.movementTimeline.reduce((a, b) => a + b, 0) / analytics.movementTimeline.length;
    parts.push(`Motion activity: ${(motion * 100).toFixed(0)}%`);
    parts.push(`Motion narrative: ${movementSummary(analytics)}`);
  }

  parts.push(`Event narrative: ${eventSummary(analytics)}`);

  return `Video analytics summary:\n${parts.join('\n')}\n\nGenerate one concise sentence that summarizes what happened across the FULL recording from beginning to end, including who/what appeared and the main sequence of activity.`;
}

function generateFallback(analytics, cameraName) {
  /**
   * Rule-based description when LLM is not available
   */
  const objectCounts = analytics.objectCounts || {};
  const motion = analytics.movementTimeline 
    ? (analytics.movementTimeline.reduce((a, b) => a + b, 0) / analytics.movementTimeline.length)
    : 0;
  const namedFaces = Array.isArray(analytics.namedFaces) ? analytics.namedFaces : [];

  // Build description from detected objects
  const objects = Object.entries(objectCounts)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  if (objects.length === 0 && motion < 0.1 && namedFaces.length === 0) {
    return 'No significant activity detected.';
  }

  const descriptions = [];

  if (namedFaces.length > 0) {
    descriptions.push(`${namedFaces.join(', ')} ${namedFaces.length > 1 ? 'were' : 'was'} present`);
  }

  // Add object detections
  objects.forEach(([label, count]) => {
    if (count === 1) {
      descriptions.push(`${count} ${label} detected`);
    } else {
      descriptions.push(`${count} ${label}s detected`);
    }
  });

  // Add motion level
  if (motion > 0.5) {
    descriptions.push('significant motion throughout');
  } else if (motion > 0.2) {
    descriptions.push('moderate motion activity');
  }

  if (descriptions.length === 0) {
    return 'Recording shows minimal activity.';
  }

  const movementPhrase = movementSummary(analytics);
  const eventsPhrase = eventSummary(analytics);
  return `${cameraName}: ${descriptions.join(', ')}, while ${movementPhrase}; overall, ${eventsPhrase}.`;
}

async function generateDescription(analytics, cameraName) {
  /**
   * Generate description using available LLM service, or fallback
   */
  if (!analytics) return null;

  // Try OpenAI first
  let description = await generateWithOpenAI(analytics, cameraName);
  if (description) {
    console.log('[Describer] Generated with OpenAI');
    return description;
  }

  // Try Anthropic
  description = await generateWithAnthropic(analytics, cameraName);
  if (description) {
    console.log('[Describer] Generated with Anthropic');
    return description;
  }

  // Fallback to rule-based
  description = generateFallback(analytics, cameraName);
  console.log('[Describer] Generated with fallback');
  return description;
}

async function getOrGenerateDescription(cameraId, filename, analytics, cameraName) {
  /**
   * Get cached description or generate new one
   */
  const cachePath = getDescriptionPath(cameraId, filename);
  const cached = readCachedDescription(cachePath);
  
  if (cached && cached.version === DESCRIPTION_SCHEMA_VERSION) {
    return cached.description;
  }

  const description = await generateDescription(analytics, cameraName);
  if (description) {
    writeCachedDescription(cachePath, {
      description,
      generatedAt: new Date().toISOString(),
      cameraName,
      filename,
      version: DESCRIPTION_SCHEMA_VERSION,
    });
  }

  return description;
}

function getCachedDescription(cameraId, filename) {
  /**
   * Get cached description without generating
   * Returns the cached object or null
   */
  const cachePath = getDescriptionPath(cameraId, filename);
  const cached = readCachedDescription(cachePath);
  if (!cached) return null;
  if (cached.version !== DESCRIPTION_SCHEMA_VERSION) return null;
  return cached;
}

module.exports = {
  getOrGenerateDescription,
  generateDescription,
  getCachedDescription,
};
