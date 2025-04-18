
const map = L.map('map').setView([36.096, -80.244], 15);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

let currentRoute = null;
let heatmapLayer = null;
let safetyData = [];
let isHeatmapVisible = false;

const themeToggleBtn = document.getElementById('theme-toggle-btn');
const toggleHeatmapBtn = document.getElementById('toggle-heatmap-btn');
const recenterMapBtn = document.getElementById('recenter-map-btn');
const aboutLink = document.getElementById('about-link');
const aboutModal = document.getElementById('about-modal');
const closeModalBtn = document.querySelector('.close-btn');
const routeInfoPanel = document.getElementById('route-info');
const loadingOverlay = document.getElementById('loading-overlay');
const safetyTips = document.getElementById('safety-tips');
const safetyTipsList = document.getElementById('safety-tips-list');

function initTheme() {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (prefersDark) {
    document.body.classList.add('dark-theme');
    themeToggleBtn.innerHTML = '<i class="fas fa-sun"></i>';
    updateMapTheme(true);
  }
}

themeToggleBtn?.addEventListener('click', function () {
  const isDark = document.body.classList.toggle('dark-theme');
  this.innerHTML = isDark ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
  updateMapTheme(isDark);
});

function updateMapTheme(isDark) {
  map.eachLayer(function (layer) {
    if (layer instanceof L.TileLayer) {
      map.removeLayer(layer);
    }
  });
  const tileUrl = isDark ?
    'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png' :
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

  L.tileLayer(tileUrl, {
    maxZoom: 19
  }).addTo(map);
}

function fetchSafetyData() {
  fetch('/safety-data')
    .then(res => res.json())
    .then(data => {
      safetyData = data;
      initHeatmap();
    });
}

function initHeatmap() {
  const heatData = safetyData.map(p => [p.lat, p.lon, p.severity / 10]);
  heatmapLayer = L.heatLayer(heatData, {
    radius: 25,
    blur: 15,
    maxZoom: 17,
    gradient: {
      0.4: 'blue',
      0.6: 'lime',
      0.7: 'yellow',
      0.8: 'orange',
      1.0: 'red'
    }
  });
}

toggleHeatmapBtn?.addEventListener('click', function () {
  if (isHeatmapVisible) {
    map.removeLayer(heatmapLayer);
    this.innerHTML = '<i class="fas fa-fire"></i>';
  } else {
    if (!heatmapLayer) fetchSafetyData();
    heatmapLayer.addTo(map);
    this.innerHTML = '<i class="fas fa-fire-alt"></i>';
  }
  isHeatmapVisible = !isHeatmapVisible;
});

recenterMapBtn?.addEventListener('click', function () {
  map.setView([36.096, -80.244], 15);
});




aboutLink?.addEventListener('click', function (e) {
  e.preventDefault();
  aboutModal?.classList.remove('hidden');
});

closeModalBtn?.addEventListener('click', () => aboutModal?.classList.add('hidden'));
window.addEventListener('click', e => e.target === aboutModal && aboutModal?.classList.add('hidden'));

function generateSafetyTips(score) {
  const tips = score >= 7 ? [
    "Consider alternative routes",
    "Stay alert",
    "Avoid walking alone",
    "Keep phone accessible",
    "Share your location"
  ] : score >= 4 ? [
    "Stay on well-lit paths",
    "Be mindful of surroundings",
    "Limit distractions",
    "Travel with a companion"
  ] : [
    "This route is generally safe",
    "Remain aware",
    "Use standard safety practices"
  ];

  safetyTipsList.innerHTML = tips.map(t => `<li>${t}</li>`).join('');
  safetyTips.classList.remove('hidden');
}

function getSafetyColor(score) {
  if (score <= 3) return '#34c759';
  if (score <= 6) return '#ff9500';
  return '#ff3b30';
}

function getSafetyLabel(score) {
  if (score <= 3) return 'Safe';
  if (score <= 6) return 'Moderate';
  return 'Dangerous';
}

function formatDistance(meters) {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

function formatTime(seconds) {
  if (seconds < 60) return `${Math.round(seconds)} sec`;
  const mins = Math.round(seconds / 60);
  return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} hr ${mins % 60} min`;
}

function updateSafetyDisplay(score) {
  const scoreElement = document.getElementById('score-value');
  const oldFill = document.getElementById('safety-meter-fill');
  oldFill?.remove();

  const fill = document.createElement('div');
  fill.id = 'safety-meter-fill';
  fill.className = 'safety-meter-fill';
  fill.style.backgroundColor = getSafetyColor(score);
  fill.style.width = `${score * 10}%`;
  document.querySelector('.safety-meter').appendChild(fill);

  scoreElement.textContent = score;
  scoreElement.style.color = getSafetyColor(score);
}

function findRoute() {
  const start = document.getElementById('start').value.trim();
  const end = document.getElementById('end').value.trim();
  if (!start || !end) return alert('Please enter both locations');

  loadingOverlay.classList.remove('hidden');
  fetch(`/route?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`)
    .then(res => res.json())
    .then(data => {
      if (data.error) throw new Error(data.error);
      if (currentRoute) map.removeLayer(currentRoute);

      const coords = data.coordinates;
      const segments = data.segment_scores || [];
      currentRoute = L.layerGroup();

      if (segments.length > 0) {
        for (let i = 0; i < segments.length; i++) {
          const segment = L.polyline([coords[i], coords[i + 1]], {
            color: getSafetyColor(segments[i]),
            weight: 5,
            opacity: 0.8
          }).bindTooltip(`
            <div class="segment-tooltip">
              <span class="safety-level ${getSafetyLabel(segments[i]).toLowerCase()}">${getSafetyLabel(segments[i])}</span>
              <span>Score: ${segments[i]}/10</span>
            </div>
          `);
          currentRoute.addLayer(segment);
        }
      } else {
        const route = L.polyline(coords, { color: getSafetyColor(data.safety_score), weight: 5 });
        currentRoute.addLayer(route);
      }

      const startMarker = L.marker(coords[0]).addTo(map);
      const endMarker = L.marker(coords[coords.length - 1]).addTo(map);
      currentRoute.addLayer(startMarker);
      currentRoute.addLayer(endMarker);

      currentRoute.addTo(map);
      const bounds = L.latLngBounds(coords);
      map.fitBounds(bounds, { padding: [50, 50] });
      

      updateSafetyDisplay(data.safety_score);
      if (data.distance) document.getElementById('distance-value').textContent = formatDistance(data.distance);
      if (data.duration) document.getElementById('time-value').textContent = formatTime(data.duration);
      routeInfoPanel.classList.remove('hidden');
      generateSafetyTips(data.safety_score);
    })
    .catch(err => {
      alert(err.message || 'Something went wrong');
      console.error(err);
    })
    .finally(() => loadingOverlay.classList.add('hidden'));
}

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  document.querySelectorAll('.input-group input').forEach(input => {
    input.addEventListener('keypress', e => {
      if (e.key === 'Enter') findRoute();
    });
  });
  loadIncidents();
});

function loadIncidents() {
  fetch('/incidents')
    .then(res => res.json())
    .then(data => {
      data.forEach(item => {
        const iconColor = item.type === 'crime' ? 'red' : 'yellow';
        const marker = L.circleMarker([item.lat, item.lon], {
          radius: 6,
          color: iconColor,
          fillColor: iconColor,
          fillOpacity: 0.8
        });
        const gmapsLink = `https://www.google.com/maps?q=${item.lat},${item.lon}`;
        marker.bindPopup(`
          <strong>${item.label}</strong><br>
          📅 ${item.timestamp}<br>
          🔥 Severity: ${item.severity}<br>
          <a href="${gmapsLink}" target="_blank">🌍 View on Google Maps</a>
        `);
        marker.addTo(map);
      });
    })
    .catch(err => console.error("Error loading incidents:", err));
}
