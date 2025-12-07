// viewer.js

const canvas = document.getElementById('mapCanvas');
const ctx = canvas.getContext('2d');

const playPauseBtn = document.getElementById('playPauseBtn');
const timeSlider = document.getElementById('timeSlider');
const timeLabel = document.getElementById('timeLabel');

const speedMinusBtn = document.getElementById('speedMinusBtn');
const speedPlusBtn = document.getElementById('speedPlusBtn');
const speedBtn = document.getElementById('speedBtn');

const statsDiv = document.getElementById('stats');
const titleHeader = document.getElementById('titleHeader');

const mapImage = new Image();

let samples = [];
let minT = 0;
let maxT = 0;

let isPlaying = false;
let currentT = 0;
let lastFrameTime = null;

// Playback speeds (note: 16x et 32x inclus)
const SPEEDS = [0.5, 1, 1.5, 2, 4, 8, 16, 32];
let currentSpeedIndex = 1;
let playbackSpeed = SPEEDS[currentSpeedIndex];

function updateSpeedLabel() {
  speedBtn.textContent = `${playbackSpeed}x`;
}

// Path colors (par minute)
const PATH_COLORS = ['#00ff99', '#00bcd4', '#ffeb3b', '#ff9800', '#f44336', '#9c27b0'];

const GAME_START_OFFSET_SECONDS = -120;

// Map bounds with padding basé sur les respawns
const BASE_MIN = 9684;
const BASE_MAX = 23034;
const MAP_SPAN = BASE_MAX - BASE_MIN;
const PADDING = MAP_SPAN * 0.05;

const MAP_MIN = BASE_MIN - PADDING;
const MAP_MAX = BASE_MAX + PADDING;

const CANVAS_MARGIN = 20;

// LH color persistant (jaune au début)
let lastLhColor = '#ffeb3b';

function formatGameTime(t) {
  const gameSeconds = t + GAME_START_OFFSET_SECONDS;
  const total = Math.floor(gameSeconds);
  const sign = total < 0 ? '-' : '';
  const abs = Math.abs(total);
  const minutes = Math.floor(abs / 60);
  const seconds = abs % 60;
  return `${sign}${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// Map + fichier du path
mapImage.src = 'dota2_map.png';

const pathFile = 'path_jug_lh_8559667418.json';
const fileNameForTitle = pathFile.replace(/\.json$/i, '');
titleHeader.textContent = `Path viewer : ${fileNameForTitle}`;

mapImage.onload = () => {
  fetch(pathFile)
    .then((res) => res.json())
    .then((data) => {
      samples = data;
      if (!samples.length) return;

      minT = samples[0].t;
      maxT = samples[samples.length - 1].t;

      canvas.width = mapImage.width;
      canvas.height = mapImage.height;

      currentT = minT;
      timeSlider.value = 0;

      updateSpeedLabel();
      draw(currentT);
      requestAnimationFrame(loop);
    })
    .catch((err) => {
      console.error('Error loading path JSON:', err);
    });
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function worldToCanvas(x, y) {
  const range = MAP_MAX - MAP_MIN || 1;

  const nx = (x - MAP_MIN) / range;
  const ny = (y - MAP_MIN) / range;

  const usableWidth = canvas.width - CANVAS_MARGIN * 2;
  const usableHeight = canvas.height - CANVAS_MARGIN * 2;

  const cx = CANVAS_MARGIN + nx * usableWidth;
  const cy = CANVAS_MARGIN + (1 - ny) * usableHeight;

  return {
    x: clamp(cx, CANVAS_MARGIN, canvas.width - CANVAS_MARGIN),
    y: clamp(cy, CANVAS_MARGIN, canvas.height - CANVAS_MARGIN)
  };
}

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
      return { ...s1, t, x, y };
    }
  }
  return samples[samples.length - 1];
}

function draw(t) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Map
  ctx.drawImage(mapImage, 0, 0, canvas.width, canvas.height);

  // Path
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  let started = false;
  let prevMinute = null;
  let prevSample = null;
  let lastSample = null;

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (s.t > t) break;

    prevSample = lastSample;
    lastSample = s;

    const minuteBucket = Math.floor(s.t / 60);
    const p = worldToCanvas(s.x, s.y);

    if (!started || minuteBucket !== prevMinute) {
      if (started) ctx.stroke();
      ctx.beginPath();
      ctx.strokeStyle = PATH_COLORS[minuteBucket % PATH_COLORS.length];
      ctx.moveTo(p.x, p.y);
      started = true;
      prevMinute = minuteBucket;
    } else {
      ctx.lineTo(p.x, p.y);
    }
  }

  if (started) ctx.stroke();

  // Hero + stats
  const s = getSampleAtTime(t);
  if (s) {
    const p = worldToCanvas(s.x, s.y);

    ctx.fillStyle = '#ff4444';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.fill();

    timeLabel.textContent = formatGameTime(t);

    const display = lastSample || s;

    // LH color (persistant) selon dernier gain
    if (lastSample && prevSample) {
      const creepDiff = lastSample.creepGold - prevSample.creepGold;
      const neutralDiff = lastSample.neutralGold - prevSample.neutralGold;

      if (creepDiff > 0) {
        lastLhColor = '#8cff66'; // lane creeps
      } else if (neutralDiff > 0) {
        lastLhColor = '#66d9ff'; // neutrals
      }
    }

    // Pourcentages
    const creep = display.creepGold || 0;
    const neutral = display.neutralGold || 0;
    const hero = display.heroKillGold || 0;
    const totalGold = creep + neutral + hero;

    let creepPct = 0;
    let neutralPct = 0;
    let heroPct = 0;

    if (totalGold > 0) {
      creepPct = (creep / totalGold) * 100;
      neutralPct = (neutral / totalGold) * 100;
      heroPct = (hero / totalGold) * 100;
    }

    statsDiv.innerHTML =
      `<div class="lh-highlight" style="color:${lastLhColor};">LH: ${display.lastHits}</div>` +
      `<div class="gold-total">Total gold: ${totalGold}</div>` +
      `<div class="gold-row"><span class="gold-label">Lane creeps</span><span class="gold-value">${creepPct.toFixed(1)}%</span></div>` +
      `<div class="gold-row"><span class="gold-label">Neutrals</span><span class="gold-value">${neutralPct.toFixed(1)}%</span></div>` +
      `<div class="gold-row"><span class="gold-label">Hero kills</span><span class="gold-value">${heroPct.toFixed(1)}%</span></div>`;
  }
}

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

speedMinusBtn.addEventListener('click', () => {
  if (currentSpeedIndex > 0) {
    currentSpeedIndex--;
    playbackSpeed = SPEEDS[currentSpeedIndex];
    updateSpeedLabel();
  }
});

speedPlusBtn.addEventListener('click', () => {
  if (currentSpeedIndex < SPEEDS.length - 1) {
    currentSpeedIndex++;
    playbackSpeed = SPEEDS[currentSpeedIndex];
    updateSpeedLabel();
  }
});
