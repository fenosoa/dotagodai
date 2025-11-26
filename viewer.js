// viewer.js

const canvas = document.getElementById('mapCanvas');
const ctx = canvas.getContext('2d');

const playPauseBtn = document.getElementById('playPauseBtn');
const timeSlider = document.getElementById('timeSlider');
const timeLabel = document.getElementById('timeLabel');
const statsDiv = document.getElementById('stats');
const speedBtn = document.getElementById('speedBtn');

const mapImage = new Image();

let samples = [];
let minT = 0;
let maxT = 0;
let minX = 0;
let maxX = 0;
let minY = 0;
let maxY = 0;

let isPlaying = false;
let currentT = 0;
let lastFrameTime = null;

// Playback speed
let playbackSpeed = 1;
const SPEEDS = [0.5, 1, 1.5, 2, 4, 8];
let currentSpeedIndex = 1; // index of 1 in SPEEDS

// Colors for minute buckets
const PATH_COLORS = ['#00ff99', '#00bcd4', '#ffeb3b', '#ff9800', '#f44336', '#9c27b0'];

// Dota starts at -2:00 relative to our t=0
const GAME_START_OFFSET_SECONDS = -120;

// Dota map bounds based on respawns (inner square + proportional padding)
const BASE_MIN = 9684;   // Radiant respawn inner corner
const BASE_MAX = 23034;  // Dire respawn inner corner
const MAP_SPAN = BASE_MAX - BASE_MIN;

// A bit stronger padding so the respawns ne soient pas collés aux bords
const PADDING_RATIO = 0.05;          // 5% of span
const PADDING = MAP_SPAN * PADDING_RATIO;

const MAP_MIN = BASE_MIN - PADDING;  // extended bottom-left
const MAP_MAX = BASE_MAX + PADDING;  // extended top-right;

// Canvas margin so path is not touching map border
const CANVAS_MARGIN = 20;

// Format seconds (with offset) -> "[-]mm:ss"
function formatGameTime(t) {
  const gameSeconds = t + GAME_START_OFFSET_SECONDS; // t=0 => -120
  const total = Math.floor(gameSeconds);
  const sign = total < 0 ? '-' : '';
  const absTotal = Math.abs(total);
  const minutes = Math.floor(absTotal / 60);
  const seconds = absTotal % 60;

  return `${sign}${minutes.toString().padStart(2, '0')}:${seconds
    .toString()
    .padStart(2, '0')}`;
}

// Load map, then JSON path
mapImage.src = 'dota2_map.png';

mapImage.onload = () => {
  fetch('tb___8569460372_path_hero0.json') // change filename here if needed
    .then((res) => res.json())
    .then((data) => {
      samples = data;
      if (!samples.length) {
        console.warn('No samples in JSON file.');
        return;
      }

      minT = samples[0].t;
      maxT = samples[samples.length - 1].t;

      // Still compute real bounds for debugging
      minX = Math.min(...samples.map((s) => s.x));
      maxX = Math.max(...samples.map((s) => s.x));
      minY = Math.min(...samples.map((s) => s.y));
      maxY = Math.max(...samples.map((s) => s.y));

      console.log('Bounds from samples:', { minX, maxX, minY, maxY });
      console.log('Using fixed map bounds:', { MAP_MIN, MAP_MAX });

      // Canvas = size of the map image (600x600 dans votre cas)
      canvas.width = mapImage.width;
      canvas.height = mapImage.height;

      console.log('width:', canvas.width, 'height:', canvas.height);

      currentT = minT;
      timeSlider.min = 0;
      timeSlider.max = 1;
      timeSlider.value = 0;

      speedBtn.textContent = `${playbackSpeed}x`;

      draw(currentT);
      requestAnimationFrame(loop);
    })
    .catch((err) => {
      console.error('Error loading path JSON:', err);
    });
};

// Prevent going out of canvas
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// Convert world coordinates to canvas coordinates (using fixed Dota map bounds + canvas margin)
function worldToCanvas(x, y) {
  const range = MAP_MAX - MAP_MIN || 1;

  const nx = (x - MAP_MIN) / range;
  const ny = (y - MAP_MIN) / range; // same range to keep it square

  const usableWidth = canvas.width - CANVAS_MARGIN * 2;
  const usableHeight = canvas.height - CANVAS_MARGIN * 2;

  const cx = CANVAS_MARGIN + nx * usableWidth;
  const cy = CANVAS_MARGIN + (1 - ny) * usableHeight; // invert Y axis

  return {
    x: clamp(cx, CANVAS_MARGIN, canvas.width - CANVAS_MARGIN),
    y: clamp(cy, CANVAS_MARGIN, canvas.height - CANVAS_MARGIN)
  };
}

// Interpolate sample for given time t
function getSampleAtTime(t) {
  if (!samples.length) return null;
  if (t <= samples[0].t) return samples[0];
  if (t >= samples[samples.length - 1].t) return samples[samples.length - 1];

  for (let i = 0; i < samples.length - 1; i++) {
    const s1 = samples[i];
    const s2 = samples[i + 1];
    if (t >= s1.t && t <= s2.t) {
      const alpha = (t - s1.t) / (s2.t - s1.t || 1);
      const x = s1.x + alpha * (s2.x - s1.x);
      const y = s1.y + alpha * (s2.y - s1.y);
      return {
        ...s1,
        t,
        x,
        y
      };
    }
  }
  return samples[samples.length - 1];
}

// Draw map, path and hero position
function draw(t) {
  if (!mapImage.complete || !samples.length) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Map
  ctx.drawImage(mapImage, 0, 0, canvas.width, canvas.height);

  // Path up to time t, with color change each minute bucket (based on raw t)
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  let started = false;
  let prevMinute = null;

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (s.t > t) break;

    const minuteBucket = Math.floor(s.t / 60);
    const p = worldToCanvas(s.x, s.y);

    if (!started || minuteBucket !== prevMinute) {
      if (started) {
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.strokeStyle = PATH_COLORS[minuteBucket % PATH_COLORS.length];
      ctx.moveTo(p.x, p.y);
      started = true;
      prevMinute = minuteBucket;
    } else {
      ctx.lineTo(p.x, p.y);
    }
  }

  if (started) {
    ctx.stroke();
  }

  // Current position and stats
  const s = getSampleAtTime(t);
  if (s) {
    const p = worldToCanvas(s.x, s.y);

    ctx.fillStyle = '#ff4444';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.fill();

    // Use game-time (with -2:00 offset) for label
    timeLabel.textContent = formatGameTime(t);

    statsDiv.textContent =
      `LH: ${s.lastHits} | Creep gold: ${s.creepGold} | ` +
      `Neutral gold: ${s.neutralGold} | Hero gold: ${s.heroKillGold}`;
  }
}

// Main animation loop
function loop(timestamp) {
  if (!samples.length) {
    requestAnimationFrame(loop);
    return;
  }

  if (lastFrameTime == null) {
    lastFrameTime = timestamp;
  }

  const dtMs = timestamp - lastFrameTime;
  lastFrameTime = timestamp;

  if (isPlaying) {
    const dtSec = dtMs / 1000;
    currentT += dtSec * playbackSpeed;
    if (currentT > maxT) {
      currentT = maxT;
      isPlaying = false;
      playPauseBtn.textContent = 'Play';
    }
    const ratio = (currentT - minT) / (maxT - minT || 1);
    timeSlider.value = ratio;
  } else {
    const ratio = parseFloat(timeSlider.value);
    currentT = minT + ratio * (maxT - minT || 1);
  }

  draw(currentT);
  requestAnimationFrame(loop);
}

// Controls
playPauseBtn.addEventListener('click', () => {
  isPlaying = !isPlaying;
  playPauseBtn.textContent = isPlaying ? 'Pause' : 'Play';
});

timeSlider.addEventListener('input', () => {
  if (!isPlaying) {
    const ratio = parseFloat(timeSlider.value);
    currentT = minT + ratio * (maxT - minT || 1);
    draw(currentT);
  }
});

speedBtn.addEventListener('click', () => {
  currentSpeedIndex = (currentSpeedIndex + 1) % SPEEDS.length;
  playbackSpeed = SPEEDS[currentSpeedIndex];
  speedBtn.textContent = `${playbackSpeed}x`;
});
