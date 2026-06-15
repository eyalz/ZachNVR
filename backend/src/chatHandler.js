/**
 * chatHandler.js — Natural language query handler for recordings
 * Allows users to ask questions like "show me videos with dogs"
 */

const fs = require('fs');
const path = require('path');

const RECORDINGS_DIR = path.join(__dirname, '../../recordings');
const DESCRIPTIONS_DIR = path.join(__dirname, '../../recordings-descriptions');

function getAllRecordingDescriptions() {
  /**
   * Load all recorded descriptions from cache
   */
  const descriptions = [];
  
  if (!fs.existsSync(DESCRIPTIONS_DIR)) return descriptions;
  
  const cameraDirs = fs.readdirSync(DESCRIPTIONS_DIR, { withFileTypes: true });
  cameraDirs.forEach(cameraDir => {
    if (!cameraDir.isDirectory()) return;
    
    const cameraPath = path.join(DESCRIPTIONS_DIR, cameraDir.name);
    const files = fs.readdirSync(cameraPath).filter(f => f.endsWith('.json'));
    
    files.forEach(file => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(cameraPath, file), 'utf-8'));
        descriptions.push({
          cameraId: cameraDir.name,
          filename: file.replace('.json', ''),
          ...data,
        });
      } catch (err) {
        // Skip invalid files
      }
    });
  });
  
  return descriptions;
}

async function parseQueryWithLLM(query) {
  /**
   * Use LLM to parse the user's question and extract search parameters
   * Returns: { keywords, objects, timeRange, cameras }
   */
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log('[ChatHandler] No OpenAI API key, skipping LLM parsing');
    return null;
  }

  try {
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
            content: 'You are a query parser for security camera recordings. Extract search parameters from user questions. Return JSON with fields: keywords (array of search terms), objects (array of object types like "dog", "person", "car"), timeRange (optional "last_hour", "last_day", "last_week"), cameras (optional array of camera names). Be concise.',
          },
          {
            role: 'user',
            content: query,
          },
        ],
        max_tokens: 150,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      console.error('[ChatHandler] OpenAI API error:', response.status, response.statusText);
      return null;
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content;
    
    if (!text) {
      console.error('[ChatHandler] No content in OpenAI response');
      return null;
    }
    
    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[ChatHandler] No JSON found in OpenAI response:', text);
      return null;
    }
    
    const parsed = JSON.parse(jsonMatch[0]);
    console.log('[ChatHandler] Successfully parsed query with OpenAI:', parsed);
    return parsed;
  } catch (err) {
    console.error('[ChatHandler] OpenAI error:', err.message);
    return null;
  }
}

function parseQueryFallback(query) {
  /**
   * Rule-based query parsing when LLM unavailable
   */
  const keywords = [];
  const objects = [];
  
  // Check for common object types
  if (/dog/i.test(query)) objects.push('dog');
  if (/person|people|human/i.test(query)) objects.push('person');
  if (/cat/i.test(query)) objects.push('cat');
  if (/car|vehicle/i.test(query)) objects.push('car');
  if (/motion|movement/i.test(query)) keywords.push('motion');
  
  // Check for time ranges
  let timeRange = null;
  if (/last.?hour|past.?hour|1.?hour/i.test(query)) timeRange = 'last_hour';
  else if (/last.?day|past.?day|today|24.?hour/i.test(query)) timeRange = 'last_day';
  else if (/last.?week|past.?week/i.test(query)) timeRange = 'last_week';
  
  // Extract other keywords
  const wordMatches = query.match(/\b\w+\b/g) || [];
  const filtered = wordMatches.filter(w => w.length > 3 && !/^(show|video|when|what|where|did|the|for|and|or|dog|person|car|cat|motion|last|hour|day|week)$/i.test(w));
  keywords.push(...filtered.slice(0, 3));
  
  return {
    keywords: [...new Set(keywords)],
    objects: [...new Set(objects)],
    timeRange,
    cameras: [],
  };
}

function matchesQuery(description, parsedQuery) {
  /**
   * Check if a description matches the parsed query
   * Handles both LLM descriptions and fallback basic recordings
   */
  if (!parsedQuery) return true;

  const { keywords, objects, timeRange, cameras } = parsedQuery;
  
  // Camera filter
  if (cameras.length > 0 && !cameras.some(c => description.cameraName?.toLowerCase().includes(c.toLowerCase()))) {
    return false;
  }
  
  // If no description text (fallback mode), be lenient - allow basic queries through
  if (!description.description) {
    // Only filter if we have specific objects to look for
    if (objects.length > 0) {
      // Without description text, we can't match specific objects in basic mode
      return false;
    }
    return true; // Allow generic "videos" queries in fallback mode
  }
  
  // Object filter (only applies if description exists)
  if (objects.length > 0) {
    const hasObject = objects.some(obj => 
      description.description.toLowerCase().includes(obj.toLowerCase())
    );
    if (!hasObject) return false;
  }
  
  // Keyword filter (only applies if description exists)
  if (keywords.length > 0) {
    const hasKeyword = keywords.some(kw =>
      description.description.toLowerCase().includes(kw.toLowerCase())
    );
    if (!hasKeyword) return false;
  }
  
  return true;
}

function filterByTimeRange(descriptions, timeRange) {
  /**
   * Filter descriptions by time range
   */
  if (!timeRange) return descriptions;

  const now = new Date();
  let cutoff = new Date(now);
  
  if (timeRange === 'last_hour') {
    cutoff.setHours(cutoff.getHours() - 1);
  } else if (timeRange === 'last_day') {
    cutoff.setDate(cutoff.getDate() - 1);
  } else if (timeRange === 'last_week') {
    cutoff.setDate(cutoff.getDate() - 7);
  }
  
  return descriptions.filter(d => {
    const genDate = new Date(d.generatedAt);
    return genDate >= cutoff;
  });
}

async function answerQuery(query) {
  /**
   * Main chat handler: parse query and find matching recordings
   */
  
  // Parse the query
  let parsedQuery = await parseQueryWithLLM(query);
  if (!parsedQuery) {
    parsedQuery = parseQueryFallback(query);
  }
  
  console.log('[ChatHandler] Parsed query:', parsedQuery);
  
  // Load all descriptions
  let allDescriptions = getAllRecordingDescriptions();
  console.log('[ChatHandler] Found', allDescriptions.length, 'cached descriptions');
  
  // If no descriptions exist, fall back to basic search
  if (allDescriptions.length === 0) {
    console.log('[ChatHandler] No cached descriptions, searching basic recordings...');
    allDescriptions = getBasicRecordingList();
    console.log('[ChatHandler] Found', allDescriptions.length, 'recording files');
  }
  
  // Filter by time range
  allDescriptions = filterByTimeRange(allDescriptions, parsedQuery.timeRange);
  
  // Match against query
  const matches = allDescriptions
    .filter(desc => matchesQuery(desc, parsedQuery))
    .sort((a, b) => new Date(b.generatedAt || b.createdAt) - new Date(a.generatedAt || a.createdAt))
    .slice(0, 10); // Limit to 10 results
  
  console.log('[ChatHandler] Matched recordings:', matches.length);
  
  // Generate response
  let response = '';
  if (matches.length === 0) {
    response = "I couldn't find any recordings matching that description. Try asking about a different time period or object type, or try simpler queries like 'videos' or 'recordings'.";
  } else if (matches.length === 1) {
    const desc = matches[0].description || 'Recording available';
    response = `Found 1 matching recording from ${matches[0].cameraName}: "${desc}"`;
  } else {
    response = `Found ${matches.length} recordings. Here are the most recent:`;
  }
  
  return {
    response,
    matches: matches.map(m => ({
      cameraId: m.cameraId,
      filename: m.filename,
      description: m.description,
      cameraName: m.cameraName,
      generatedAt: m.generatedAt,
    })),
    query: parsedQuery,
  };
}

function getBasicRecordingList() {
  /**
   * Fall back to listing actual recording files when descriptions don't exist
   */
  const recordings = [];
  
  if (!fs.existsSync(RECORDINGS_DIR)) return recordings;
  
  const cameraDirs = fs.readdirSync(RECORDINGS_DIR, { withFileTypes: true });
  cameraDirs.forEach(cameraDir => {
    if (!cameraDir.isDirectory()) return;
    
    const cameraPath = path.join(RECORDINGS_DIR, cameraDir.name);
    try {
      const files = fs.readdirSync(cameraPath).filter(f => f.endsWith('.mp4'));
      files.forEach(file => {
        const filePath = path.join(cameraPath, file);
        const stat = fs.statSync(filePath);
        recordings.push({
          cameraId: cameraDir.name,
          cameraName: `Camera ${cameraDir.name}`,
          filename: file,
          description: null,
          createdAt: stat.birthtime,
          generatedAt: stat.birthtime,
        });
      });
    } catch (err) {
      console.error('[ChatHandler] Error reading camera dir:', err.message);
    }
  });
  
  return recordings;
}

module.exports = {
  answerQuery,
  parseQueryWithLLM,
  parseQueryFallback,
  getAllRecordingDescriptions,
};
