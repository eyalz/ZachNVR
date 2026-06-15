#!/usr/bin/env node

/**
 * Test script for chat handler
 * Run with: node test-chat.js
 */

const path = require('path');
const fs = require('fs');

// Add backend to path
const chatHandler = require('./backend/src/chatHandler.js');

async function test() {
  console.log('\n=== Chat Handler Test ===\n');

  // Test 1: Parse query with fallback
  console.log('Test 1: Query parsing');
  console.log('Query: "show me videos"');
  const result = await chatHandler.answerQuery('show me videos');
  console.log('Result:', JSON.stringify(result, null, 2));

  // Test 2: Get descriptions
  console.log('\n\nTest 2: Get cached descriptions');
  const desc = chatHandler.getAllRecordingDescriptions();
  console.log('Found descriptions:', desc.length);
  if (desc.length > 0) {
    console.log('Sample:', desc[0]);
  }
}

test().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
