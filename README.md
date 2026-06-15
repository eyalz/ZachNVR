# ZachNVR

A lightweight Network Video Recorder (NVR) application for your local network.

## Features

- **ONVIF Discovery** — automatically scans the local network for IP cameras using the ONVIF WS-Discovery protocol
- **Manual camera entry** — add any camera via RTSP URL
- **Live Grid View** — watch all cameras simultaneously in an adaptive grid
- **Single Camera View** — focus on one camera full-screen
- **Recording** — per-camera toggle to record RTSP streams to local MP4 files via FFmpeg
- **Playback** — browse and replay saved recordings per camera
- **Screenshot Capture** — take JPEG snapshots from live streams or playback
- **AI Analytics** — real-time object detection (people, dogs, cars), motion detection, face recognition
  - Uses **Frigate NVR integration** for powerful YOLO-based detection (if available)
  - Falls back to local TensorFlow/COCO-SSD analytics
- **Face Recognition** — tag faces in playback, auto-identify known faces across recordings
- **Smart Timeline** — visual timeline showing detected events and motion
- **LLM-Powered Descriptions** — auto-generate natural language summaries of what happened in each recording
- **Recording Search Chat** — ask questions like "show me videos with dogs" or "what happened yesterday?" to find recordings

## Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js · Express · node-onvif · fluent-ffmpeg |
| Frontend | React 18 · Vite · hls.js · React Router |
| Streaming | FFmpeg (HLS for live, MP4 for recording) |
| Analytics | TensorFlow.js · face-api.js · COCO-SSD (local) · Frigate NVR (optional) |

## Requirements

- Node.js ≥ 18
- FFmpeg installed and on PATH (`brew install ffmpeg`)
- ONVIF-compatible IP cameras on the same local network subnet
- **(Optional) Frigate NVR** for advanced AI analytics (YOLO detection, better accuracy)

## Getting Started

### Backend
```bash
cd backend
npm install
npm start          # or: npm run dev  (with nodemon)
```
Runs on `http://localhost:3001`

### Frontend
```bash
cd frontend
npm install
npm run dev
```
Opens on `http://localhost:3000`

### Frigate NVR (Optional)

For enhanced AI analytics, set up Frigate NVR:
```bash
export FRIGATE_URL=http://localhost:5000
# then restart backend
```

See [FRIGATE_SETUP.md](FRIGATE_SETUP.md) for detailed configuration.

### LLM Integration (Optional)

Enable automatic video descriptions and chat-based search with an LLM provider:

**Option 1: OpenAI (GPT-3.5)**
```bash
export OPENAI_API_KEY=sk-...
```

**Option 2: Anthropic Claude**
```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

**Without LLM:** System falls back to rule-based descriptions (less detailed).

## Project Structure

```
ZachNVR/
├── backend/
│   └── src/
│       ├── index.js          # Express entry point
│       ├── config.js         # JSON-based camera config store
│       ├── discovery.js      # ONVIF WS-Discovery
│       ├── recorder.js       # FFmpeg HLS + recording manager
│       └── routes/
│           ├── cameras.js    # Camera CRUD + live stream control
│           ├── discovery.js  # Scan endpoint
│           ├── recordings.js # List saved MP4 files
│           └── stream.js     # HLS status
├── frontend/
│   └── src/
│       ├── pages/
│       │   ├── LiveView.jsx  # Grid / single live view
│       │   ├── Cameras.jsx   # Camera management
│       │   └── Playback.jsx  # Recording playback
│       ├── components/
│       │   ├── HlsPlayer.jsx # hls.js wrapper
│       │   └── CameraCard.jsx
│       └── hooks/
│           └── useCameras.js
├── recordings/               # MP4 recordings (git-ignored)
└── hls-segments/             # Live HLS segments (git-ignored)
```
