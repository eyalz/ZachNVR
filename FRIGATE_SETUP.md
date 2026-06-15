# Frigate NVR Integration

ZachNVR now supports integration with **Frigate** - an open-source network video recorder that provides powerful AI-based object detection, including person, dog, cat, and vehicle detection.

## Benefits of Frigate Integration

- **More accurate object detection** - Frigate uses YOLO, more powerful than COCO-SSD
- **Offloaded AI processing** - Analytics run on Frigate, not in browser (better performance)
- **Dog detection included** - Native support for dogs and other animals
- **Event-based storage** - Only stores video when events occur
- **Web interface** - Frigate provides its own UI for monitoring and configuration
- **Fallback support** - If Frigate is unavailable, ZachNVR automatically falls back to local TensorFlow analytics

## Setup

### 1. Install Frigate

Using Docker (recommended):

```bash
docker run -d \
  --name frigate \
  --restart unless-stopped \
  -e FRIGATE_RTSP_PASSWORD=<password> \
  -v /path/to/config:/config \
  -v /path/to/storage:/media/frigate \
  -p 5000:5000 \
  ghcr.io/blakeblackshear/frigate:stable
```

Or install from source: https://docs.frigate.video/deployment/

### 2. Configure Frigate

Edit `/config/config.yml` in Frigate to add your cameras:

```yaml
cameras:
  living_room:
    ffmpeg:
      inputs:
        - path: rtsp://camera_ip:554/stream
          roles:
            - detect
            - record
    detect:
      width: 1920
      height: 1080
      fps: 5
```

### 3. Connect ZachNVR to Frigate

Set the environment variable when starting ZachNVR backend:

```bash
export FRIGATE_URL=http://localhost:5000
npm run dev
```

Or in `.env`:
```
FRIGATE_URL=http://localhost:5000
```

### 4. Verify Integration

Check the Frigate status endpoint:

```bash
curl http://localhost:3001/api/frigate/status
```

Response when connected:
```json
{
  "available": true,
  "url": "http://localhost:5000"
}
```

## How It Works

### Recording Analytics

When you play back a recording, ZachNVR now:
1. First tries to fetch analytics from Frigate API
2. Frigate returns event data (people, dogs, objects detected during recording)
3. Data is converted to timeline and object count format
4. If Frigate is unavailable, falls back to local FFmpeg scene detection

### Live Analytics

Live video analytics still use local detection (HlsPlayer) because:
- Frigate events are stored/historical
- Live feeds need real-time local processing
- HLS streams are optimized for browser playback

## Frigate API Endpoints Used

- `GET /api/config` - Check if Frigate is running
- `GET /api/events?camera=<name>&after=<time>&before=<time>` - Get detection events
- `GET /api/stats` - Get recording statistics

See [Frigate API docs](https://docs.frigate.video/api/) for full reference.

## Troubleshooting

**"Frigate unavailable" message:**
- Check Frigate is running: `curl http://localhost:5000/api/config`
- Verify `FRIGATE_URL` environment variable
- Check network connectivity between ZachNVR and Frigate

**Analytics still showing local data:**
- This is expected fallback behavior
- Check Frigate has recording enabled for the camera
- Verify camera name matches in Frigate config

**Missing dog detection in playback:**
- Ensure Frigate's AI is configured for dog detection
- Check Frigate logs for detection issues
- Fallback to local analytics still detects dogs via COCO-SSD

## Disabling Frigate

To use only local analytics (original behavior), either:
1. Don't set `FRIGATE_URL` environment variable
2. Ensure Frigate is not running on its default port
3. ZachNVR will automatically fall back to local detection
