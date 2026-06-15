const express = require('express');
const router = express.Router();
const { answerQuery } = require('../chatHandler');

// POST /api/chat — Answer a query about recordings
router.post('/', async (req, res) => {
  console.log('[Chat API] Received POST request');
  console.log('[Chat API] Headers:', req.headers);
  console.log('[Chat API] Body:', req.body);
  
  const { query } = req.body;
  
  console.log('[Chat API] Query value:', query, '(type:', typeof query, ')');
  
  if (!query) {
    console.error('[Chat API] Missing query parameter');
    return res.status(400).json({ 
      error: 'Query is required',
      response: 'Please provide a search query.',
      matches: [],
      receivedBody: req.body,
    });
  }
  
  if (typeof query !== 'string') {
    console.error('[Chat API] Query is not a string:', typeof query);
    return res.status(400).json({ 
      error: 'Query must be a string',
      response: 'Search query must be text.',
      matches: [],
      receivedType: typeof query,
    });
  }
  
  if (query.trim().length === 0) {
    console.error('[Chat API] Query is empty string');
    return res.status(400).json({ 
      error: 'Query is empty',
      response: 'Please enter a non-empty search query.',
      matches: [],
    });
  }
  
  try {
    console.log('[Chat] Processing query:', query);
    const result = await answerQuery(query.trim());
    console.log('[Chat] Responding with', result.matches.length, 'matches');
    res.json(result);
  } catch (err) {
    console.error('[Chat API] Error processing query:', err);
    res.status(500).json({ 
      error: err.message || 'Failed to process query',
      response: 'Sorry, I encountered an error processing your question. Please check the server logs and try again.',
      matches: [],
      details: err.stack,
    });
  }
});

module.exports = router;
