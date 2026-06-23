// This file will be loaded in the renderer process
// The preload script exposes a safe API to the window

// Pagination state
let currentSearchQuery = '';
let currentPage = 1;
let totalPages = 0;
let totalResults = 0;

// Loading messages
const loadingMessages = [
    { main: 'Searching for torrents...', sub: 'This may take a few seconds' },
    { main: 'Scouring the high seas...', sub: 'Finding the best torrents for you' },
    { main: 'Connecting to torrent sites...', sub: 'Gathering search results' },
    { main: 'Hunting for content...', sub: 'Please wait while we search' },
    { main: 'Exploring torrent networks...', sub: 'Almost there...' }
];

// DOM Elements
const elements = {
    searchInput: null,
    searchBtn: null,
    resultsContainer: null,
    progressBar: null,
    statusText: null,
    downloadSpeed: null,
    downloaded: null,
    totalSize: null,
    stopBtn: null
};

// Function to launch the media player
async function launchMediaPlayer() {
    try {
        await window.api.invoke('launch-media-player');
    } catch (error) {
        console.error('Error launching media player:', error);
        updateElement('status', 'Player launch failed');
        updateElement('status-text', error.message);
    }
}

// Function to stop the current stream
async function stopStream() {
    try {
        await window.api.invoke('stop-stream');
        hideBottomStatusBar();
        updateElement('status', 'Download stopped');
        updateElement('status-text', 'Select another torrent to start streaming');
    } catch (error) {
        console.error('Error stopping stream:', error);
        updateElement('status', 'Stop failed');
        updateElement('status-text', error.message);
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    initElements();
    setupEventListeners();
});

// Handle search results
window.api.receive('search-results', (results) => {
    displayResults(results);
});

// Handle stream errors
window.api.receive('stream-error', (error) => {
    console.error('Stream error:', error);
    updateElement('status', 'Stream error');
    updateElement('status-text', error.message || 'Failed to start stream');
    setStatusBarState('idle');
});

// Handle download progress
window.api.receive('download-progress', (progress) => {
    updateProgressDisplay(progress);
});

// Handle media player ready event
window.api.receive('media-player-ready', (data) => {
    console.log('[DEBUG] Media player ready event received:', data);
    const launchPlayerBtn = document.getElementById('launchPlayerBtn');
    console.log('[DEBUG] Launch button element found:', !!launchPlayerBtn);
    if (launchPlayerBtn) {
        console.log('[DEBUG] Enabling launch button');
        // Enable the button (styling handled by its .btn-primary class).
        launchPlayerBtn.disabled = false;
    } else {
        console.error('[DEBUG] Launch button element not found!');
    }
    
    const statusElement = document.getElementById('status');
    if (statusElement) {
        statusElement.textContent = 'Ready to launch media player';
        console.log('[DEBUG] Status updated to: Ready to launch media player');
    }
    updateElement('status-text', data.fileName ? `Buffered enough to play: ${data.fileName}` : 'Buffered enough to play');
});

// Handle media player launched event
window.api.receive('media-player-launched', (data) => {
    console.log('Media player launched:', data);
    updateElement('status', 'Media player launched');
    updateElement('status-text', data.fileName || 'Playing in VLC');
});

// Function to update progress display
function updateProgressDisplay(progress) {
    // Set status bar to downloading state
    setStatusBarDownloading();
    showBottomStatusBar();
    
    const progressPercent = Math.min(progress.progress || 0, 100);
    // Data is in bytes from backend, convert to MB for display
    const speedBytes = progress.downloadSpeed || 0;
    const speedMBps = (speedBytes / (1024 * 1024)).toFixed(2);
    const downloadedBytes = progress.downloaded || 0;
    const downloadedMB = (downloadedBytes / (1024 * 1024)).toFixed(1);
    const totalBytes = progress.length || 0;
    const totalMB = (totalBytes / (1024 * 1024)).toFixed(1);
    const numPeers = progress.numPeers || 0;
    
    // Calculate ETA
    let eta = '--';
    if (speedBytes > 0 && totalBytes > downloadedBytes) {
        const remainingBytes = totalBytes - downloadedBytes;
        const etaSeconds = remainingBytes / speedBytes;
        if (etaSeconds < 3600) {
            eta = `${Math.floor(etaSeconds / 60)}m ${Math.floor(etaSeconds % 60)}s`;
        } else {
            eta = `${Math.floor(etaSeconds / 3600)}h ${Math.floor((etaSeconds % 3600) / 60)}m`;
        }
    }
    
    // Update main progress bar
    const progressBar = document.getElementById('progressBar');
    if (progressBar) {
        progressBar.style.width = `${progressPercent}%`;
    }
    
    // Update minimized progress bar
    const miniProgressBar = document.getElementById('mini-progressBar');
    if (miniProgressBar) {
        miniProgressBar.style.width = `${progressPercent}%`;
    }
    
    // Update status text
    const statusElement = document.getElementById('status');
    if (statusElement) {
        if (progressPercent >= 100) {
            statusElement.textContent = 'Download Complete';
        } else {
            statusElement.textContent = `Downloading ${progress.fileName || 'torrent'}...`;
        }
    }
    
    // Update minimized status
    const miniStatus = document.getElementById('mini-status');
    if (miniStatus) {
        if (progressPercent >= 100) {
            miniStatus.textContent = 'Download Complete';
        } else {
            miniStatus.textContent = `Downloading... ${progressPercent.toFixed(1)}%`;
        }
    }
    
    // Update all stats
    updateElement('downloadSpeed', `${speedMBps} MB/s`);
    updateElement('downloaded', `${downloadedMB} MB`);
    updateElement('totalSize', `${totalMB} MB`);
    updateElement('progressPercent', `${progressPercent.toFixed(1)}%`);
    updateElement('numPeers', numPeers.toString());
    updateElement('eta', eta);
    updateElement('mini-speed', `${speedMBps} MB/s`);
}

// Helper function to update element text content
function updateElement(id, text) {
    const element = document.getElementById(id);
    if (element) {
        element.textContent = text;
    }
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Helper: set the bottom status bar's visual state (drives progress + stat
// colours via CSS) and enable/disable the action buttons.
function setStatusBarState(state) {
    const bars = [
        document.getElementById('bottom-status-bar'),
        document.getElementById('minimized-status-bar')
    ];
    bars.forEach((bar) => {
        if (!bar) return;
        bar.classList.remove('is-idle', 'is-downloading', 'is-paused');
        bar.classList.add(`is-${state}`);
    });

    const active = state !== 'idle';
    ['launchPlayerBtn', 'stopBtn', 'pauseResumeBtn', 'mini-stopBtn', 'mini-pauseResumeBtn']
        .forEach((id) => {
            const el = document.getElementById(id);
            if (!el) return;
            // The launch button is enabled separately (when buffered enough).
            if (id === 'launchPlayerBtn') {
                if (!active) el.disabled = true;
                return;
            }
            el.disabled = !active;
        });

    // Pause/Resume buttons swap label + accent colour with the state.
    const paused = state === 'paused';
    ['pauseResumeBtn', 'mini-pauseResumeBtn'].forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = paused ? 'Resume' : 'Pause';
        el.classList.toggle('btn-success', paused);
        el.classList.toggle('btn-warning', !paused);
    });
}

// Function to set status bar to idle state
function setStatusBarIdle() {
    updateElement('status', 'No video selected');
    updateElement('status-text', 'Search and select a torrent to start streaming');
    updateElement('mini-status', 'No video selected');

    ['downloadSpeed', 'downloaded', 'totalSize', 'progressPercent', 'numPeers', 'eta', 'mini-speed']
        .forEach((id) => updateElement(id, '--'));

    const progressBar = document.getElementById('progressBar');
    const miniProgressBar = document.getElementById('mini-progressBar');
    if (progressBar) progressBar.style.width = '0%';
    if (miniProgressBar) miniProgressBar.style.width = '0%';

    setStatusBarState('idle');
}

// Function to set status bar to downloading state
function setStatusBarDownloading() {
    setStatusBarState('downloading');
}

// Function to set status bar to paused state
function setStatusBarPaused() {
    updateElement('status', 'Download paused');
    updateElement('status-text', 'Click Resume to continue downloading');
    updateElement('mini-status', 'Paused');
    updateElement('downloadSpeed', 'Paused');
    updateElement('mini-speed', 'Paused');
    setStatusBarState('paused');
}

// Function to show bottom status bar (now always visible, just ensure padding)
function showBottomStatusBar() {
    // Always ensure proper padding since status bar is always visible
    document.body.style.paddingBottom = '140px';
}

// Function to hide bottom status bar (now just resets to idle state)
function hideBottomStatusBar() {
    // Instead of hiding, reset to idle state
    setStatusBarIdle();
    const bottomStatusBar = document.getElementById('bottom-status-bar');
    const minimizedStatusBar = document.getElementById('minimized-status-bar');
    if (bottomStatusBar) bottomStatusBar.classList.remove('hidden');
    if (minimizedStatusBar) minimizedStatusBar.classList.add('hidden');
    // Keep the status bar visible with proper padding
    document.body.style.paddingBottom = '140px';
}

// Function to minimize status bar
function minimizeStatusBar() {
    const bottomStatusBar = document.getElementById('bottom-status-bar');
    const minimizedStatusBar = document.getElementById('minimized-status-bar');
    
    if (bottomStatusBar && minimizedStatusBar) {
        bottomStatusBar.classList.add('hidden');
        minimizedStatusBar.classList.remove('hidden');
        // Reduce padding for minimized bar
        document.body.style.paddingBottom = '50px';
    }
}

// Function to expand status bar
function expandStatusBar() {
    const bottomStatusBar = document.getElementById('bottom-status-bar');
    const minimizedStatusBar = document.getElementById('minimized-status-bar');
    
    if (bottomStatusBar && minimizedStatusBar) {
        minimizedStatusBar.classList.add('hidden');
        bottomStatusBar.classList.remove('hidden');
        // Restore full padding
        document.body.style.paddingBottom = '140px';
    }
}

function initElements() {
    // Main app elements
    elements.searchInput = document.getElementById('searchInput');
    elements.searchBtn = document.getElementById('searchBtn');
    elements.resultsContainer = document.getElementById('resultsContainer');
    elements.progressBar = document.getElementById('progressBar');
    elements.statusText = document.getElementById('status');
    elements.downloadSpeed = document.getElementById('downloadSpeed');
    elements.downloaded = document.getElementById('downloaded');
    elements.totalSize = document.getElementById('totalSize');
    elements.stopBtn = document.getElementById('stopBtn');
}

function setupEventListeners() {
    const searchBtn = document.getElementById('searchBtn');
    const searchInput = document.getElementById('searchInput');
    
    if (searchBtn) {
        searchBtn.addEventListener('click', handleSearch);
    }
    
    if (searchInput) {
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handleSearch();
        });
    }

    const launchPlayerBtn = document.getElementById('launchPlayerBtn');
    if (launchPlayerBtn) {
        launchPlayerBtn.addEventListener('click', launchMediaPlayer);
    }
}

// Functions
function handleSearch() {
    const query = elements.searchInput.value.trim();
    if (!query) return;
    
    // Reset pagination for new search
    currentSearchQuery = query;
    currentPage = 1;
    performSearch(query, 1);
}

// Function to show loading indicator with random message
function showLoadingIndicator() {
    const loadingIndicator = document.getElementById('loadingIndicator');
    if (!loadingIndicator) return;
    
    // Get random loading message
    const randomMessage = loadingMessages[Math.floor(Math.random() * loadingMessages.length)];
    
    // Update the loading text
    const mainText = loadingIndicator.querySelector('p:first-of-type');
    const subText = loadingIndicator.querySelector('p:last-of-type');
    
    if (mainText) mainText.textContent = randomMessage.main;
    if (subText) subText.textContent = randomMessage.sub;
    
    // Show the loading indicator
    loadingIndicator.classList.remove('hidden');
}

function performSearch(query, page = 1) {
    // Show loading state
    elements.searchBtn.disabled = true;
    elements.searchBtn.textContent = 'Searching...';
    
    // Show loading indicator with random message
    showLoadingIndicator();
    
    // Hide results and pagination while loading
    const resultsContainer = document.getElementById('resultsContainer');
    const paginationContainer = document.getElementById('paginationContainer');
    const resultsInfo = document.getElementById('resultsInfo');
    
    if (resultsContainer) {
        resultsContainer.innerHTML = '';
    }
    if (paginationContainer) {
        paginationContainer.classList.add('hidden');
    }
    if (resultsInfo) {
        resultsInfo.classList.add('hidden');
    }
    
    // Send search request to main process with pagination
    window.api.send('search-torrents', { query, page });
}

function displayResults(data) {
    const { resultsContainer } = elements;
    
    // Hide loading indicator
    const loadingIndicator = document.getElementById('loadingIndicator');
    if (loadingIndicator) {
        loadingIndicator.classList.add('hidden');
    }
    
    // Reset button state
    elements.searchBtn.disabled = false;
    elements.searchBtn.textContent = 'Search';
    
    // Handle both old format (array) and new format (object with pagination)
    let results, page, resultTotalPages, resultTotalResults;
    if (Array.isArray(data)) {
        // Old format - for backward compatibility
        results = data;
        page = 1;
        resultTotalPages = 1;
        resultTotalResults = data.length;
    } else {
        // New paginated format
        results = data.results || [];
        page = data.page || 1;
        resultTotalPages = data.totalPages || 0;
        resultTotalResults = data.totalResults || 0;
    }
    
    // Update pagination state
    currentPage = page;
    totalPages = resultTotalPages;
    totalResults = resultTotalResults;
    
    // Clear previous results
    resultsContainer.innerHTML = '';
    
    // Update results info
    const resultsInfo = document.getElementById('resultsInfo');
    const resultsCount = document.getElementById('resultsCount');
    if (resultsInfo && resultsCount) {
        if (resultTotalResults > 0) {
            resultsCount.textContent = `${resultTotalResults} results found`;
            resultsInfo.classList.remove('hidden');
        } else {
            resultsInfo.classList.add('hidden');
        }
    }
    
    if (!results || !Array.isArray(results) || results.length === 0) {
        resultsContainer.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon">?</span>
                <p>No results found. Try a different search term.</p>
            </div>
        `;
        // Hide pagination
        const paginationContainer = document.getElementById('paginationContainer');
        if (paginationContainer) {
            paginationContainer.classList.add('hidden');
        }
        return;
    }

    // Results are already checked at the start of the function

    try {
        // Filter out any invalid results
        const validResults = results.filter(result => 
            result && 
            result.magnet && 
            result.name && 
            typeof result.magnet === 'string' && 
            result.magnet.startsWith('magnet:')
        );

        if (validResults.length === 0) {
            resultsContainer.innerHTML = `
                <div class="empty-state">
                    <span class="empty-icon">0</span>
                    <p>No valid torrents found. Try a different search term.</p>
                </div>
            `;
            return;
        }

        // Display the valid results
        resultsContainer.innerHTML = validResults.map(result => {
            const seeds = Number(result.seeds) || 0;
            const seedClass = seeds > 50 ? 'high' : seeds > 10 ? 'mid' : '';
            const safeName = escapeHtml(result.name);
            const safeSize = escapeHtml(result.size || 'Unknown size');
            const safeProvider = escapeHtml(result.provider);
            return `
            <div class="result-card">
                <div class="result-main">
                    <h3 class="result-title" title="${safeName}">${safeName}</h3>
                    <div class="result-meta">
                        <span class="pill pill-size">${safeSize}</span>
                        <span class="pill pill-seeds ${seedClass}">&uarr; ${seeds} seeders</span>
                        ${result.provider ? `<span class="pill pill-provider">${safeProvider}</span>` : ''}
                    </div>
                </div>
                <span class="result-play">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.14v14l11-7-11-7z"></path></svg>
                </span>
            </div>`;
        }).join('');

        // Add click handlers to result items
        document.querySelectorAll('#resultsContainer > div').forEach((item, index) => {
            const result = validResults[index];
            item.addEventListener('click', () => onSelectTorrent(result.magnet, result.name));
        });
        
        // Setup pagination controls
        setupPagination(page, resultTotalPages);

    } catch (error) {
        console.error('Error displaying results:', error);
        resultsContainer.innerHTML = `
            <div class="empty-state error">
                <span class="empty-icon">!</span>
                <p>Error displaying results. Please try again.</p>
                <p class="error-detail">${escapeHtml(error.message)}</p>
            </div>
        `;
        // Hide pagination on error
        const paginationContainer = document.getElementById('paginationContainer');
        if (paginationContainer) {
            paginationContainer.classList.add('hidden');
        }
    }
}

// Pagination functions
function setupPagination(currentPage, totalPages) {
    const paginationContainer = document.getElementById('paginationContainer');
    const prevButton = document.getElementById('prevPage');
    const nextButton = document.getElementById('nextPage');
    const pageNumbers = document.getElementById('pageNumbers');
    
    if (!paginationContainer || !prevButton || !nextButton || !pageNumbers) {
        return;
    }
    
    // Show pagination if there are multiple pages
    if (totalPages > 1) {
        paginationContainer.classList.remove('hidden');
        
        // Update previous button
        prevButton.disabled = currentPage === 1;
        prevButton.onclick = () => {
            if (currentPage > 1) {
                performSearch(currentSearchQuery, currentPage - 1);
            }
        };
        
        // Update next button
        nextButton.disabled = currentPage === totalPages;
        nextButton.onclick = () => {
            if (currentPage < totalPages) {
                performSearch(currentSearchQuery, currentPage + 1);
            }
        };
        
        // Generate page numbers
        generatePageNumbers(currentPage, totalPages);
    } else {
        paginationContainer.classList.add('hidden');
    }
}

function generatePageNumbers(currentPage, totalPages) {
    const pageNumbers = document.getElementById('pageNumbers');
    if (!pageNumbers) return;
    
    pageNumbers.innerHTML = '';
    
    // Calculate which pages to show
    let startPage = Math.max(1, currentPage - 2);
    let endPage = Math.min(totalPages, startPage + 4);
    
    // Adjust start page if we're near the end
    if (endPage - startPage < 4) {
        startPage = Math.max(1, endPage - 4);
    }
    
    // Add first page and ellipsis if needed
    if (startPage > 1) {
        addPageButton(1, currentPage);
        if (startPage > 2) {
            pageNumbers.appendChild(createEllipsis());
        }
    }
    
    // Add page numbers
    for (let i = startPage; i <= endPage; i++) {
        addPageButton(i, currentPage);
    }
    
    // Add ellipsis and last page if needed
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            pageNumbers.appendChild(createEllipsis());
        }
        addPageButton(totalPages, currentPage);
    }
}

function addPageButton(pageNum, currentPage) {
    const pageNumbers = document.getElementById('pageNumbers');
    const button = document.createElement('button');
    
    button.textContent = pageNum;
    button.className = pageNum === currentPage ? 'page-btn active' : 'page-btn';

    if (pageNum !== currentPage) {
        button.onclick = () => performSearch(currentSearchQuery, pageNum);
    }
    
    pageNumbers.appendChild(button);
}

function createEllipsis() {
    const span = document.createElement('span');
    span.textContent = '...';
    span.className = 'page-ellipsis';
    return span;
}

// Entry point when a search result is clicked. Inspects the torrent's
// contents and, if it holds more than one video file (e.g. a TV series),
// lets the user pick which episode to stream before downloading.
async function onSelectTorrent(magnet, name) {
    const statusText = document.getElementById('status-text');
    const statusEl = document.getElementById('status');
    if (statusEl) statusEl.textContent = 'Reading torrent contents...';
    if (statusText) statusText.textContent = `Inspecting: ${name}`;

    let files;
    try {
        files = await window.api.invoke('list-torrent-files', magnet);
    } catch (error) {
        console.error('Error listing torrent files:', error);
        // If we couldn't read the file list, fall back to auto file selection.
        startStream(magnet, name, null);
        return;
    }

    if (!files || files.length === 0) {
        // No video files reported; let the backend try its best.
        startStream(magnet, name, null);
        return;
    }

    if (files.length === 1) {
        // Single video (typical movie): stream it directly.
        startStream(magnet, name, files[0].fileId);
        return;
    }

    // Multiple video files: show the episode/file picker.
    showEpisodeModal(magnet, name, files);
}

// Populate and open the file-selection modal.
function showEpisodeModal(magnet, name, files) {
    const modal = document.getElementById('episodeModal');
    const list = document.getElementById('episodeList');
    const title = document.getElementById('episodeModalTitle');
    if (!modal || !list) return;

    if (title) title.textContent = `${name} - ${files.length} files`;

    list.innerHTML = files
        .map(
            (f) => {
                const safeName = escapeHtml(f.name);
                const safeSize = escapeHtml(f.sizeHuman || '');
                const fileId = Number(f.fileId);
                return `
            <button type="button" class="file-item" data-file-id="${fileId}">
                <span class="file-item-icon">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.14v14l11-7-11-7z"></path></svg>
                </span>
                <span class="file-item-name" title="${safeName}">${safeName}</span>
                <span class="file-item-size">${safeSize}</span>
            </button>`;
            }
        )
        .join('');

    list.querySelectorAll('button[data-file-id]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const fileId = parseInt(btn.getAttribute('data-file-id'), 10);
            closeEpisodeModal();
            startStream(magnet, name, fileId);
        });
    });

    modal.classList.remove('hidden');
}

function closeEpisodeModal() {
    const modal = document.getElementById('episodeModal');
    if (modal) modal.classList.add('hidden');
}

// Wire up the episode modal's close affordances once.
function initEpisodeModal() {
    const modal = document.getElementById('episodeModal');
    const closeBtn = document.getElementById('closeEpisodeModal');
    if (closeBtn) closeBtn.addEventListener('click', closeEpisodeModal);
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeEpisodeModal();
        });
    }
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
            closeEpisodeModal();
        }
    });
}

async function startStream(magnet, name, fileId = null) {
    // Show loading state
    const statusElement = document.getElementById('status-text');
    if (statusElement) {
        statusElement.textContent = 'Starting stream...';
    }
    
    // Disable launch button until ready
    const launchPlayerBtn = document.getElementById('launchPlayerBtn');
    if (launchPlayerBtn) {
        launchPlayerBtn.disabled = true;
    }

    // Show the bottom status bar immediately
    showBottomStatusBar();
    setStatusBarDownloading();
    
    // Initialize progress display
    const statusEl = document.getElementById('status');
    if (statusEl) {
        statusEl.textContent = 'Connecting to peers...';
    }
    
    try {
        // Send request to start the stream using invoke for proper response handling
        await window.api.invoke('start-stream', { magnet, fileId });
        
        // Update status
        if (statusElement) {
            statusElement.textContent = 'Downloading selected file. Player unlocks after buffering.';
        }
    } catch (error) {
        console.error('Error starting stream:', error);
        hideBottomStatusBar();
        updateElement('status', 'Stream failed');
        updateElement('status-text', error.message);
    }
}

// Settings modal functionality
function initSettingsModal() {
    const settingsIcon = document.getElementById('settingsIcon');
    const settingsModal = document.getElementById('settingsModal');
    const closeSettingsModal = document.getElementById('closeSettingsModal');
    
    if (!settingsIcon || !settingsModal || !closeSettingsModal) {
        console.error('Settings modal elements not found');
        return;
    }
    
    // Open settings modal
    settingsIcon.addEventListener('click', () => {
        settingsModal.classList.remove('hidden');
        // Load current settings when opening
        loadSettings();
    });
    
    // Close settings modal
    closeSettingsModal.addEventListener('click', () => {
        settingsModal.classList.add('hidden');
    });
    
    // Close modal when clicking outside
    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) {
            settingsModal.classList.add('hidden');
        }
    });
    
    // Close modal on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !settingsModal.classList.contains('hidden')) {
            settingsModal.classList.add('hidden');
        }
    });
}

// Settings functionality
function initSettings() {
    const saveSettingsBtn = document.getElementById('saveSettingsBtn');
    const browseBtn = document.getElementById('browseBtn');
    
    if (saveSettingsBtn) {
        saveSettingsBtn.addEventListener('click', saveSettings);
    }
    
    if (browseBtn) {
        browseBtn.addEventListener('click', browseDirectory);
    }
    
    // Load existing settings
    loadSettings();
}

function loadSettings() {
    // Load settings from storage or use defaults
    const settings = {
        downloadPath: '/tmp/torrent-streamer',
        minDownloadSize: 1024,
        vlcPath: '/Applications/VLC.app/Contents/MacOS/VLC',
        maxDownloadSpeed: 0,
        maxUploadSpeed: 0
    };
    
    // Apply settings to UI
    const downloadPathInput = document.getElementById('downloadPath');
    const minDownloadSizeSelect = document.getElementById('minDownloadSize');
    const vlcPathInput = document.getElementById('vlcPath');
    const maxDownloadSpeedInput = document.getElementById('maxDownloadSpeed');
    const maxUploadSpeedInput = document.getElementById('maxUploadSpeed');
    
    if (downloadPathInput) downloadPathInput.value = settings.downloadPath;
    if (minDownloadSizeSelect) minDownloadSizeSelect.value = settings.minDownloadSize;
    if (vlcPathInput) vlcPathInput.value = settings.vlcPath;
    if (maxDownloadSpeedInput) maxDownloadSpeedInput.value = settings.maxDownloadSpeed;
    if (maxUploadSpeedInput) maxUploadSpeedInput.value = settings.maxUploadSpeed;
}

function saveSettings() {
    const downloadPath = document.getElementById('downloadPath')?.value || '/tmp/torrents';
    const minDownloadSize = parseInt(document.getElementById('minDownloadSize')?.value) || 1024;
    const vlcPath = document.getElementById('vlcPath')?.value || '';
    const maxDownloadSpeed = parseInt(document.getElementById('maxDownloadSpeed')?.value) || 0;
    const maxUploadSpeed = parseInt(document.getElementById('maxUploadSpeed')?.value) || 0;
    
    const settings = {
        downloadPath,
        minDownloadSize,
        vlcPath,
        maxDownloadSpeed,
        maxUploadSpeed
    };
    
    // Save settings (for now just log, later we'll implement actual saving)
    console.log('Settings saved:', settings);
    
    // Show success message
    const saveBtn = document.getElementById('saveSettingsBtn');
    if (saveBtn) {
        const originalText = saveBtn.textContent;
        saveBtn.textContent = 'Saved!';
        
        setTimeout(() => {
            saveBtn.textContent = originalText;
        }, 2000);
    }
}

function browseDirectory() {
    // For now just show a placeholder message
    // Later we'll implement actual directory browsing
    console.log('Browse directory clicked - to be implemented');
    alert('Directory browsing will be implemented in a future update.');
}

// Initialize settings modal and other components when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    initSettingsModal();
    initSettings();
    initEpisodeModal();
    initBottomStatusBar();
    // Initialize status bar to idle state
    setStatusBarIdle();
    // Ensure proper padding for always-visible status bar
    document.body.style.paddingBottom = '140px';
});

// Initialize bottom status bar event listeners
function initBottomStatusBar() {
    // Minimize status bar button
    const minimizeBtn = document.getElementById('minimizeStatusBtn');
    if (minimizeBtn) {
        minimizeBtn.addEventListener('click', minimizeStatusBar);
    }
    
    // Expand status bar button
    const expandBtn = document.getElementById('expandStatusBtn');
    if (expandBtn) {
        expandBtn.addEventListener('click', expandStatusBar);
    }
    
    // Mini stop button
    const miniStopBtn = document.getElementById('mini-stopBtn');
    if (miniStopBtn) {
        miniStopBtn.addEventListener('click', stopStream);
    }
    
    // Regular stop button (already handled in existing code, but ensure it works)
    const stopBtn = document.getElementById('stopBtn');
    if (stopBtn) {
        stopBtn.addEventListener('click', stopStream);
    }
    
    // Pause/Resume button
    const pauseResumeBtn = document.getElementById('pauseResumeBtn');
    if (pauseResumeBtn) {
        pauseResumeBtn.addEventListener('click', togglePauseResume);
    }
    
    // Mini pause/resume button
    const miniPauseResumeBtn = document.getElementById('mini-pauseResumeBtn');
    if (miniPauseResumeBtn) {
        miniPauseResumeBtn.addEventListener('click', togglePauseResume);
    }
}

// Toggle pause/resume functionality
async function togglePauseResume() {
    try {
        const pauseResumeBtn = document.getElementById('pauseResumeBtn');
        const miniPauseResumeBtn = document.getElementById('mini-pauseResumeBtn');
        
        const currentText = pauseResumeBtn?.textContent || 'Pause';
        
        if (currentText === 'Pause') {
            // Pause the stream
            console.log('Pausing stream...');
            const result = await window.api.invoke('pause-stream');
            console.log('Pause result:', result);
        } else {
            // Resume the stream
            console.log('Resuming stream...');
            const result = await window.api.invoke('resume-stream');
            console.log('Resume result:', result);
        }
    } catch (error) {
        console.error('Error toggling pause/resume:', error);
        alert(`Error: ${error.message}`);
    }
}

// Event listeners for pause/resume events from main process
window.api.receive('stream-paused', (data) => {
    console.log('Stream paused event received:', data);
    setStatusBarPaused();
});

window.api.receive('stream-resumed', (data) => {
    console.log('Stream resumed event received:', data);
    setStatusBarDownloading();
});
