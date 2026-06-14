# ZachNVR

A lightweight Network Video Recorder (NVR) application for your local network.

## Features

- **ONVIF Discovery** — automatically scans the local network for IP cameras using the ONVIF WS-Discovery protocol
- **Manual camera entry** — add any camera via RTSP URL
- **Live Grid View** — watch all cameras simultaneously in an adaptive grid
- **Single Camera View** — focus on one camera full-screen
- **Recording** — per-camera toggle to record RTSP streams to local MP4 files via FFmpeg
- **Playback** — browse and replay saved recordings per camera

## Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js · Express · node-onvif · fluent-ffmpeg |
| Frontend | React 18 · Vite · hls.js · React Router |
| Streaming | FFmpeg (HLS for live, MP4 for recording) |

## Requirements

- Node.js ≥ 18
- FFmpeg installed and on PATH (`brew install ffmpeg`)
- ONVIF-compatible IP cameras on the same local network subnet

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
