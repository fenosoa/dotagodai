// dem-explorer.js - Explorateur de fichiers .dem pour Dota 2

// DOM Elements
const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const browseBtn = document.getElementById('browseBtn');
const searchSection = document.getElementById('searchSection');
const searchInput = document.getElementById('searchInput');
const filesSection = document.getElementById('filesSection');
const filesList = document.getElementById('filesList');
const fileCount = document.getElementById('fileCount');
const emptyState = document.getElementById('emptyState');
const gridViewBtn = document.getElementById('gridViewBtn');
const listViewBtn = document.getElementById('listViewBtn');

// State
let allFiles = [];
let filteredFiles = [];
let viewMode = 'grid'; // 'grid' or 'list'

// File type icon
const FILE_ICON = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
  </svg>
`;

// Initialize
function init() {
    setupEventListeners();

    // Check if we have stored files in localStorage
    loadStoredFiles();
}

// Setup Event Listeners
function setupEventListeners() {
    // File input
    browseBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelect);

    // Drag and drop
    uploadArea.addEventListener('click', () => fileInput.click());
    uploadArea.addEventListener('dragover', handleDragOver);
    uploadArea.addEventListener('dragleave', handleDragLeave);
    uploadArea.addEventListener('drop', handleDrop);

    // Search
    searchInput.addEventListener('input', handleSearch);

    // View mode
    gridViewBtn.addEventListener('click', () => setViewMode('grid'));
    listViewBtn.addEventListener('click', () => setViewMode('list'));

    // Prevent default drag behavior
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => e.preventDefault());
}

// Handle file selection
function handleFileSelect(event) {
    const files = Array.from(event.target.files);
    processFiles(files);
}

// Handle drag over
function handleDragOver(event) {
    event.preventDefault();
    event.stopPropagation();
    uploadArea.classList.add('drag-over');
}

// Handle drag leave
function handleDragLeave(event) {
    event.preventDefault();
    event.stopPropagation();
    uploadArea.classList.remove('drag-over');
}

// Handle drop
function handleDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    uploadArea.classList.remove('drag-over');

    const files = Array.from(event.dataTransfer.files);
    processFiles(files);
}

// Process files
function processFiles(files) {
    // Filter only .dem files
    const demFiles = files.filter(file => file.name.toLowerCase().endsWith('.dem'));

    if (demFiles.length === 0) {
        showNotification('Aucun fichier .dem trouvé', 'error');
        return;
    }

    // Convert to our file objects
    demFiles.forEach(file => {
        const fileObj = {
            id: generateId(),
            name: file.name,
            title: extractTitle(file.name),
            size: file.size,
            sizeFormatted: formatFileSize(file.size),
            date: new Date().toISOString(),
            dateFormatted: formatDate(new Date()),
            file: file
        };

        // Check if file already exists
        const existingIndex = allFiles.findIndex(f => f.name === fileObj.name);
        if (existingIndex === -1) {
            allFiles.push(fileObj);
        } else {
            allFiles[existingIndex] = fileObj;
        }
    });

    // Save to localStorage
    saveFilesToStorage();

    // Update display
    filteredFiles = [...allFiles];
    renderFiles();
    showFilesSection();

    showNotification(`${demFiles.length} fichier${demFiles.length > 1 ? 's' : ''} ajouté${demFiles.length > 1 ? 's' : ''}`, 'success');
}

// Extract title from filename
function extractTitle(filename) {
    // Remove .dem extension
    let title = filename.replace(/\.dem$/i, '');

    // Try to extract match ID (common pattern: numbers)
    const matchIdPattern = /\d{10,}/;
    const matchId = title.match(matchIdPattern);

    if (matchId) {
        return `Match ${matchId[0]}`;
    }

    // Clean up underscores and dashes
    title = title.replace(/[_-]/g, ' ');

    // Capitalize first letter of each word
    title = title.replace(/\b\w/g, char => char.toUpperCase());

    return title;
}

// Format file size
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

// Format date
function formatDate(date) {
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'À l\'instant';
    if (minutes < 60) return `Il y a ${minutes} min`;
    if (hours < 24) return `Il y a ${hours}h`;
    if (days < 7) return `Il y a ${days}j`;

    return date.toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'short',
        year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
}

// Generate unique ID
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Handle search
function handleSearch(event) {
    const query = event.target.value.toLowerCase().trim();

    if (query === '') {
        filteredFiles = [...allFiles];
    } else {
        filteredFiles = allFiles.filter(file =>
            file.name.toLowerCase().includes(query) ||
            file.title.toLowerCase().includes(query)
        );
    }

    renderFiles();
}

// Set view mode
function setViewMode(mode) {
    viewMode = mode;

    if (mode === 'grid') {
        gridViewBtn.classList.add('active');
        listViewBtn.classList.remove('active');
        filesList.classList.remove('list-view');
    } else {
        listViewBtn.classList.add('active');
        gridViewBtn.classList.remove('active');
        filesList.classList.add('list-view');
    }

    // Save preference
    localStorage.setItem('demExplorerViewMode', mode);
}

// Render files
function renderFiles() {
    fileCount.textContent = filteredFiles.length;

    if (filteredFiles.length === 0) {
        filesList.innerHTML = '';
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';

    filesList.innerHTML = filteredFiles.map((file, index) => `
    <div class="file-card" data-file-id="${file.id}" style="animation-delay: ${index * 50}ms">
      <div class="file-card-header">
        <div class="file-icon">
          ${FILE_ICON}
        </div>
        <div class="file-info">
          <div class="file-name">${escapeHtml(file.title)}</div>
          <div class="file-size">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
            ${file.sizeFormatted}
          </div>
        </div>
      </div>
      <div class="file-meta">
        <div class="meta-item">
          <span class="meta-label">Nom du fichier</span>
          <span class="meta-value" title="${escapeHtml(file.name)}">${truncate(escapeHtml(file.name), 30)}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Ajouté</span>
          <span class="meta-value">${file.dateFormatted}</span>
        </div>
      </div>
    </div>
  `).join('');

    // Add click handlers
    document.querySelectorAll('.file-card').forEach(card => {
        card.addEventListener('click', () => {
            const fileId = card.dataset.fileId;
            handleFileClick(fileId);
        });
    });
}

// Handle file click - Open modal instead of downloading
function handleFileClick(fileId) {
    const file = allFiles.find(f => f.id === fileId);
    if (!file) return;

    openMatchModal(file);
}

// Modal elements
const matchModal = document.getElementById('matchModal');
const modalOverlay = document.getElementById('modalOverlay');
const modalClose = document.getElementById('modalClose');
const modalTitle = document.getElementById('modalTitle');
const matchFileName = document.getElementById('matchFileName');
const matchFileSize = document.getElementById('matchFileSize');
const matchFilePath = document.getElementById('matchFilePath');
const parseBtn = document.getElementById('parseBtn');
const parsingStatus = document.getElementById('parsingStatus');
const parseResults = document.getElementById('parseResults');
const scanDotaBtn = document.getElementById('scanDotaBtn');

let currentFile = null;

// Open match modal
function openMatchModal(file) {
    currentFile = file;

    // Update modal content
    modalTitle.textContent = file.title;
    matchFileName.textContent = file.name;
    matchFileSize.textContent = file.sizeFormatted;
    matchFilePath.textContent = file.file.webkitRelativePath || file.name;

    // Reset results
    parsingStatus.style.display = 'none';
    parseResults.style.display = 'none';
    parseBtn.disabled = false;

    // Show modal
    matchModal.style.display = 'flex';
}

// Close match modal
function closeMatchModal() {
    matchModal.style.display = 'none';
    currentFile = null;
}

// Parse replay
async function parseReplay() {
    if (!currentFile) return;

    parseBtn.disabled = true;
    parsingStatus.style.display = 'flex';
    parseResults.style.display = 'none';

    try {
        // Get the file path
        const filePath = currentFile.file.path || currentFile.file.webkitRelativePath || currentFile.name;

        //  Call backend to parse
        // For now, we'll simulate parsing and show dummy data
        // TODO: Integrate with your Gradle parser

        await simulateParsing();

        // Show results
        parsingStatus.style.display = 'none';
        parseResults.style.display = 'block';

        // Display parsed data
        displayParseResults({
            map: {
                duration: '45:32',
                mode: 'All Pick',
                winner: 'Radiant'
            },
            players: [
                { id: 0, name: 'Player 1', hero: 'AM', team: 'radiant', kills: 12, deaths: 3, assists: 8, gpm: 650, xpm: 720 },
                { id: 1, name: 'Player 2', hero: 'PA', team: 'radiant', kills: 15, deaths: 5, assists: 10, gpm: 580, xpm: 680 },
                { id: 2, name: 'Player 3', hero: 'CM', team: 'radiant', kills: 2, deaths: 8, assists: 20, gpm: 320, xpm: 400 },
                { id: 3, name: 'Player 4', hero: 'SF', team: 'dire', kills: 10, deaths: 8, assists: 12, gpm: 550, xpm: 650 },
                { id: 4, name: 'Player 5', hero: 'LC', team: 'dire', kills: 8, deaths: 10, assists: 15, gpm: 480, xpm: 580 }
            ],
            stats: {
                totalKills: '47',
                totalDeaths: '34',
                goldAdvantage: '+12,500',
                xpAdvantage: '+15,200'
            }
        });

    } catch (error) {
        console.error('Error parsing replay:', error);
        showNotification('Erreur lors du parsing du replay', 'error');
        parsingStatus.style.display = 'none';
        parseBtn.disabled = false;
    }
}

// Simulate parsing (remove this when integrating real parser)
function simulateParsing() {
    return new Promise(resolve => {
        setTimeout(resolve, 2000); // 2 second delay
    });
}

// Display parse results
function displayParseResults(data) {
    // Map info
    document.getElementById('mapInfo').innerHTML = `
        <div class="result-item">
            <div class="result-label">Durée</div>
            <div class="result-value">${data.map.duration}</div>
        </div>
        <div class="result-item">
            <div class="result-label">Mode</div>
            <div class="result-value">${data.map.mode}</div>
        </div>
        <div class="result-item">
            <div class="result-label">Vainqueur</div>
            <div class="result-value">${data.map.winner}</div>
        </div>
    `;

    // Players list
    document.getElementById('playersList').innerHTML = data.players.map(player => `
        <div class="player-card">
            <div class="player-team ${player.team}"></div>
            <div class="player-hero">${player.hero}</div>
            <div class="player-info">
                <div class="player-name">${escapeHtml(player.name)}</div>
                <div class="player-stats">
                    <div class="player-stat">
                        <span class="player-stat-label">K/D/A:</span>
                        <span class="player-stat-value">${player.kills}/${player.deaths}/${player.assists}</span>
                    </div>
                    <div class="player-stat">
                        <span class="player-stat-label">GPM:</span>
                        <span class="player-stat-value">${player.gpm}</span>
                    </div>
                    <div class="player-stat">
                        <span class="player-stat-label">XPM:</span>
                        <span class="player-stat-value">${player.xpm}</span>
                    </div>
                </div>
            </div>
        </div>
    `).join('');

    // Stats info
    document.getElementById('statsInfo').innerHTML = `
        <div class="result-item">
            <div class="result-label">Total Kills</div>
            <div class="result-value">${data.stats.totalKills}</div>
        </div>
        <div class="result-item">
            <div class="result-label">Total Deaths</div>
            <div class="result-value">${data.stats.totalDeaths}</div>
        </div>
        <div class="result-item">
            <div class="result-label">Gold Advantage</div>
            <div class="result-value">${data.stats.goldAdvantage}</div>
        </div>
        <div class="result-item">
            <div class="result-label">XP Advantage</div>
            <div class="result-value">${data.stats.xpAdvantage}</div>
        </div>
    `;
}

// Setup modal event listeners
modalClose.addEventListener('click', closeMatchModal);
modalOverlay.addEventListener('click', closeMatchModal);
parseBtn.addEventListener('click', parseReplay);

// Handle Escape key to close modal
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && matchModal.style.display === 'flex') {
        closeMatchModal();
    }
});

// Handle Dota 2 folder scan button
scanDotaBtn.addEventListener('click', () => {
    showNotification('Scanner le dossier Dota 2 - Cette fonctionnalité nécessite un backend serveur pour accéder au système de fichiers', 'info', 5000);
    // TODO: Implement server-side directory scanning
    // This would require a Node.js/Python backend to scan:
    // C:\\Program Files (x86)\\Steam\\steamapps\\common\\dota 2 beta\\game\\dota\\replays
});

// Show files section
function showFilesSection() {
    searchSection.style.display = 'block';
    filesSection.style.display = 'block';
}

// Save files to localStorage
function saveFilesToStorage() {
    const filesToStore = allFiles.map(f => ({
        id: f.id,
        name: f.name,
        title: f.title,
        size: f.size,
        sizeFormatted: f.sizeFormatted,
        date: f.date,
        dateFormatted: f.dateFormatted
    }));

    localStorage.setItem('demExplorerFiles', JSON.stringify(filesToStore));
}

// Load stored files
function loadStoredFiles() {
    const stored = localStorage.getItem('demExplorerFiles');
    const viewModePref = localStorage.getItem('demExplorerViewMode');

    if (viewModePref) {
        setViewMode(viewModePref);
    }

    if (stored) {
        try {
            const files = JSON.parse(stored);
            // Note: We can't restore the File objects, so we just show the metadata
            // Users will need to re-add the files if they want to download them
            // For now, we'll just clear the storage on load
            // In a real implementation, you might want to persist this differently
        } catch (error) {
            console.error('Error loading stored files:', error);
        }
    }
}

// Show notification
function showNotification(message, type = 'info', duration = 3000) {
    // Remove existing notification
    const existing = document.querySelector('.notification');
    if (existing) {
        existing.remove();
    }

    // Create notification
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = message;

    // Add styles
    const styles = `
    .notification {
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 1rem 1.5rem;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-lg);
      color: var(--text-primary);
      max-width: 400px;
      z-index: 1000;
      animation: slideInRight 0.3s ease;
    }

    .notification-success {
      border-left: 4px solid #4caf50;
    }

    .notification-error {
      border-left: 4px solid #f44336;
    }

    .notification-info {
      border-left: 4px solid var(--primary);
    }

    @keyframes slideInRight {
      from {
        opacity: 0;
        transform: translateX(100px);
      }
      to {
        opacity: 1;
        transform: translateX(0);
      }
    }

    @keyframes slideOutRight {
      from {
        opacity: 1;
        transform: translateX(0);
      }
      to {
        opacity: 0;
        transform: translateX(100px);
      }
    }
  `;

    // Add styles to document if not already added
    if (!document.querySelector('#notification-styles')) {
        const styleEl = document.createElement('style');
        styleEl.id = 'notification-styles';
        styleEl.textContent = styles;
        document.head.appendChild(styleEl);
    }

    // Add to document
    document.body.appendChild(notification);

    // Auto remove
    setTimeout(() => {
        notification.style.animation = 'slideOutRight 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, duration);
}

// Utility: Escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Utility: Truncate text
function truncate(text, maxLength) {
    if (text.length <= maxLength) return text;
    return text.substr(0, maxLength - 3) + '...';
}

// Initialize app
init();
