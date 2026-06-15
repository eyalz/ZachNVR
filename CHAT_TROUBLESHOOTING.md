# Chat Search Troubleshooting Guide

## How the Chat Search Works

1. **First, record videos**:
   - Go to **Cameras** page
   - Enable recording for at least one camera
   - Wait a few seconds for videos to be recorded

2. **Play videos to generate descriptions**:
   - Go to **Playback** page
   - Select a camera and recording
   - Click play (this triggers analytics and description generation)
   - Wait for descriptions to be cached

3. **Then search in Chat**:
   - Go to **Search** page (🎤 icon)
   - Ask questions like:
     - "show me videos"
     - "show me recordings"
     - "what videos exist"
     - "find dog videos" (if dog detected)
     - "show me videos with people"

## Error Troubleshooting

### "I couldn't find any recordings"

**Cause**: No descriptions cached yet or no recordings exist

**Solution**:
1. Make sure recordings are saved:
   ```bash
   ls -la recordings/  # Check if folder has recordings
   ```

2. If recordings exist, go to Playback and play one:
   - This will cache a description
   - Wait 2-3 seconds
   - Go back to Chat and search

### Connection errors

**Check if backend is running**:
```bash
curl http://localhost:3001/api/health
```

Should return: `{"status":"ok"}`

If not:
```bash
cd backend
npm run dev
```

### Error: "Failed to process query"

**Check backend logs**:
```bash
# If running with npm run dev, you'll see logs in the terminal
# Look for [ChatHandler] and [Chat] messages
```

**Check recordings directory exists**:
```bash
mkdir -p recordings
```

## Query Tips

- **Simple queries work best**: "videos", "show recordings", "dogs"
- **Time-based**: "last day", "yesterday", "last hour"
- **Object-based**: "people", "dogs", "cars"
- **Combined**: "dogs last day", "people yesterday"

## Without LLM (Fallback Mode)

The chat works without OpenAI/Anthropic API keys using fallback parsing:
- It extracts keywords from your question
- Looks for object types (dog, person, car)
- Filters by time range
- Searches descriptions with keyword matching

This is less intelligent but still functional.

## Optional: Set Up LLM for Better Parsing

### Option 1: OpenAI (GPT-3.5)
```bash
export OPENAI_API_KEY=sk-...
# Restart backend
cd backend && npm run dev
```

### Option 2: Anthropic Claude
```bash
export ANTHROPIC_API_KEY=sk-ant-...
# Restart backend
cd backend && npm run dev
```

## Debug: View Cached Descriptions

```bash
# Descriptions are cached here
ls -la recordings-descriptions/
find recordings-descriptions -name "*.json" | head -5

# View a description
cat recordings-descriptions/camera_id/filename.json | jq
```

## Debug: Check if Backend Receives Requests

When you search in Chat, you should see logs like:
```
[ChatHandler] Processing query: show me videos
[ChatHandler] Using fallback query parser
[ChatHandler] Found 5 cached descriptions
[Chat] Responding with 3 matches
```

If you don't see these logs, the backend isn't receiving requests.
