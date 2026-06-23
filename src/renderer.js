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
    videoPlayer: null,
    videoPlaceholder: null,
    progressContainer: null,
    progressBar: null,
    statusText: null,
    downloadSpeed: null,
    downloaded: null,
    totalSize: null,
    mediaPlayerModal: null,
    closeMediaPlayer: null,
    customVideoPlayer: null,
    customAudioPlayer: null,
    playPauseBtn: null,
    playPauseIcon: null,
    seekBar: null,
    currentTimeLabel: null,
    durationLabel: null,
    volumeSlider: null,
    muteBtn: null,
    fullscreenBtn: null,
    closeBtn: null
};

// Function to launch the media player
async function launchMediaPlayer() {
    try {
        await window.api.invoke('launch-media-player');
    } catch (error) {
        console.error('Error launching media player:', error);
        
        const statusElement = document.getElementById('status');
        if (statusElement) {
            statusElement.textContent = `Error launching media player: ${error.message}`;
        }
    }
}

// Function to stop the current stream
async function stopStream() {
    try {
        // Call the stop-stream IPC method
        await window.api.invoke('stop-stream');
        
        // Hide the bottom status bar
        hideBottomStatusBar();
        
        // Reset progress elements
        const progressBar = document.getElementById('progressBar');
        if (progressBar) {
            progressBar.style.width = '0%';
        }
        
        const statusElement = document.getElementById('status');
        if (statusElement) {
            statusElement.textContent = 'Download stopped';
        }
        
        const statusTextElement = document.getElementById('status-text');
        if (statusTextElement) {
            statusTextElement.textContent = '';
        }
        
        // Reset stats
        const downloadSpeedElement = document.getElementById('downloadSpeed');
        if (downloadSpeedElement) {
            downloadSpeedElement.textContent = '0 MB/s';
        }
        
        const downloadedElement = document.getElementById('downloaded');
        if (downloadedElement) {
            downloadedElement.textContent = '0 MB';
        }
        
        const totalSizeElement = document.getElementById('totalSize');
        if (totalSizeElement) {
            totalSizeElement.textContent = '0 MB';
        }
        
        const numPeersElement = document.getElementById('numPeers');
        if (numPeersElement) {
            numPeersElement.textContent = '0';
        }
        
        // Disable launch button
        const launchPlayerBtn = document.getElementById('launchPlayerBtn');
        if (launchPlayerBtn) {
            launchPlayerBtn.disabled = true;
            launchPlayerBtn.className = 'bg-gray-500 px-6 py-2 rounded-lg font-medium transition-colors text-gray-300 cursor-not-allowed';
        }
        
        // Hide video placeholder
        const videoPlaceholder = document.getElementById('video-placeholder');
        if (videoPlaceholder) {
            videoPlaceholder.style.display = 'none';
        }
        
    } catch (error) {
        console.error('Error stopping stream:', error);
        
        const statusElement = document.getElementById('status');
        if (statusElement) {
            statusElement.textContent = `Error stopping stream: ${error.message}`;
        }
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    initElements();
    setupEventListeners();
    setupIpcHandlers();
    setupMediaControls();
    setupVideoResizeHandler();
});

// IPC Event Listeners
window.api.receive('stream-started', (streamUrl) => {
    console.log('Stream started:', streamUrl);
    
    const videoPlayer = document.getElementById('video-player');
    if (!videoPlayer) {
        console.error('Video player element not found');
        return;
    }
    
    // Set the video source to the stream URL
    videoPlayer.src = streamUrl;
    
    // Show the video player and hide the placeholder
    videoPlayer.style.display = 'block';
    const videoPlaceholder = document.getElementById('video-placeholder');
    if (videoPlaceholder) {
        videoPlaceholder.style.display = 'none';
    }
    
    // Set up event listeners for the video player
    videoPlayer.addEventListener('loadedmetadata', () => {
        console.log('Video metadata loaded');
        videoPlayer.play().catch(error => {
            console.error('Error playing video:', error);
        });
    });
    
    videoPlayer.addEventListener('error', (error) => {
        console.error('Video player error:', error);
        const statusElement = document.getElementById('status-text');
        if (statusElement) {
            statusElement.textContent = 'Error loading video. Please try another stream.';
        }
    });
});

// Handle download progress updates
window.api.receive('download-progress', (progress) => {
    updateProgressDisplay(progress);
});

// Handle search results
window.api.receive('search-results', (results) => {
    displayResults(results);
});

// Handle stream errors
window.api.receive('stream-error', (error) => {
    console.error('Stream error:', error);
    const statusElement = document.getElementById('status-text');
    if (statusElement) {
        statusElement.textContent = `Error: ${error.message || 'Failed to start stream'}`;
    }
    
    // Re-enable UI elements if needed
    const streamBtn = document.getElementById('stream-btn');
    if (streamBtn) streamBtn.disabled = false;
});

// Handle stream started
window.api.receive('stream-started', (streamInfo) => {
    console.log('Stream started:', streamInfo);
    const statusElement = document.getElementById('status-text');
    if (statusElement) {
        statusElement.textContent = `VLC launched! Playing: ${streamInfo.name}`;
        statusElement.className = 'text-green-400';
    }
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
        // Enable the button and change styling
        launchPlayerBtn.disabled = false;
        launchPlayerBtn.className = 'bg-green-600 hover:bg-green-700 px-6 py-2 rounded-lg font-medium transition-colors text-white cursor-pointer';
    } else {
        console.error('[DEBUG] Launch button element not found!');
    }
    
    const statusElement = document.getElementById('status');
    if (statusElement) {
        statusElement.textContent = 'Ready to launch media player';
        console.log('[DEBUG] Status updated to: Ready to launch media player');
    }
});

// Handle media player launched event
window.api.receive('media-player-launched', (data) => {
    console.log('Media player launched:', data);
    const statusElement = document.getElementById('status');
    if (statusElement) {
        statusElement.textContent = `Media player launched: ${data.fileName}`;
    }
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

// Function to set status bar to idle state
function setStatusBarIdle() {
    updateElement('status', 'No video selected');
    updateElement('status-text', 'Search and select a torrent to start streaming');
    updateElement('mini-status', 'No video selected');
    
    // Reset all stats to idle state
    updateElement('downloadSpeed', '--');
    updateElement('downloaded', '--');
    updateElement('totalSize', '--');
    updateElement('progressPercent', '--');
    updateElement('numPeers', '--');
    updateElement('eta', '--');
    updateElement('mini-speed', '--');
    
    // Reset progress bars
    const progressBar = document.getElementById('progressBar');
    const miniProgressBar = document.getElementById('mini-progressBar');
    if (progressBar) {
        progressBar.style.width = '0%';
        progressBar.className = 'bg-gray-600 h-2 rounded-full transition-all duration-300';
    }
    if (miniProgressBar) {
        miniProgressBar.style.width = '0%';
    }
    
    // Disable buttons
    const launchBtn = document.getElementById('launchPlayerBtn');
    const stopBtn = document.getElementById('stopBtn');
    const pauseResumeBtn = document.getElementById('pauseResumeBtn');
    const miniStopBtn = document.getElementById('mini-stopBtn');
    const miniPauseResumeBtn = document.getElementById('mini-pauseResumeBtn');
    
    if (launchBtn) {
        launchBtn.disabled = true;
        launchBtn.className = 'bg-gray-500 px-4 py-1 rounded font-medium transition-colors text-gray-300 cursor-not-allowed text-sm';
    }
    if (stopBtn) {
        stopBtn.disabled = true;
        stopBtn.className = 'bg-gray-500 px-4 py-1 rounded font-medium transition-colors text-gray-300 cursor-not-allowed text-sm';
    }
    if (pauseResumeBtn) {
        pauseResumeBtn.disabled = true;
        pauseResumeBtn.className = 'bg-gray-500 px-4 py-1 rounded font-medium transition-colors text-gray-300 cursor-not-allowed text-sm';
        pauseResumeBtn.textContent = 'Pause';
    }
    if (miniStopBtn) {
        miniStopBtn.disabled = true;
        miniStopBtn.className = 'bg-gray-500 px-3 py-1 rounded font-medium transition-colors text-gray-300 cursor-not-allowed text-sm';
    }
    if (miniPauseResumeBtn) {
        miniPauseResumeBtn.disabled = true;
        miniPauseResumeBtn.className = 'bg-gray-500 px-3 py-1 rounded font-medium transition-colors text-gray-300 cursor-not-allowed text-sm';
        miniPauseResumeBtn.textContent = 'Pause';
    }
    
    // Make stats text gray
    const statElements = ['downloadSpeed', 'downloaded', 'totalSize', 'progressPercent', 'numPeers', 'eta'];
    statElements.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.className = 'text-gray-500 font-medium';
        }
    });
}

// Function to set status bar to downloading state
function setStatusBarDownloading() {
    // Enable pause/resume and stop buttons
    const stopBtn = document.getElementById('stopBtn');
    const pauseResumeBtn = document.getElementById('pauseResumeBtn');
    const miniStopBtn = document.getElementById('mini-stopBtn');
    const miniPauseResumeBtn = document.getElementById('mini-pauseResumeBtn');
    
    if (stopBtn) {
        stopBtn.disabled = false;
        stopBtn.className = 'bg-red-600 hover:bg-red-700 px-4 py-1 rounded font-medium transition-colors text-white text-sm';
    }
    if (pauseResumeBtn) {
        pauseResumeBtn.disabled = false;
        pauseResumeBtn.className = 'bg-yellow-600 hover:bg-yellow-700 px-4 py-1 rounded font-medium transition-colors text-white text-sm';
        pauseResumeBtn.textContent = 'Pause';
    }
    if (miniStopBtn) {
        miniStopBtn.disabled = false;
        miniStopBtn.className = 'bg-red-600 hover:bg-red-700 px-3 py-1 rounded font-medium transition-colors text-white text-sm';
    }
    if (miniPauseResumeBtn) {
        miniPauseResumeBtn.disabled = false;
        miniPauseResumeBtn.className = 'bg-yellow-600 hover:bg-yellow-700 px-3 py-1 rounded font-medium transition-colors text-white text-sm';
        miniPauseResumeBtn.textContent = 'Pause';
    }
    
    // Make progress bar blue
    const progressBar = document.getElementById('progressBar');
    if (progressBar) {
        progressBar.className = 'bg-blue-600 h-2 rounded-full transition-all duration-300';
    }
    
    // Make stats text white
    const statElements = ['downloadSpeed', 'downloaded', 'totalSize', 'progressPercent', 'numPeers', 'eta'];
    statElements.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.className = 'text-white font-medium';
        }
    });
}

// Function to set status bar to paused state
function setStatusBarPaused() {
    // Update status text
    updateElement('status', 'Download paused');
    updateElement('status-text', 'Click Resume to continue downloading');
    updateElement('mini-status', 'Paused');
    
    // Enable resume and stop buttons
    const stopBtn = document.getElementById('stopBtn');
    const pauseResumeBtn = document.getElementById('pauseResumeBtn');
    const miniStopBtn = document.getElementById('mini-stopBtn');
    const miniPauseResumeBtn = document.getElementById('mini-pauseResumeBtn');
    
    if (stopBtn) {
        stopBtn.disabled = false;
        stopBtn.className = 'bg-red-600 hover:bg-red-700 px-4 py-1 rounded font-medium transition-colors text-white text-sm';
    }
    if (pauseResumeBtn) {
        pauseResumeBtn.disabled = false;
        pauseResumeBtn.className = 'bg-green-600 hover:bg-green-700 px-4 py-1 rounded font-medium transition-colors text-white text-sm';
        pauseResumeBtn.textContent = 'Resume';
    }
    if (miniStopBtn) {
        miniStopBtn.disabled = false;
        miniStopBtn.className = 'bg-red-600 hover:bg-red-700 px-3 py-1 rounded font-medium transition-colors text-white text-sm';
    }
    if (miniPauseResumeBtn) {
        miniPauseResumeBtn.disabled = false;
        miniPauseResumeBtn.className = 'bg-green-600 hover:bg-green-700 px-3 py-1 rounded font-medium transition-colors text-white text-sm';
        miniPauseResumeBtn.textContent = 'Resume';
    }
    
    // Make progress bar orange to indicate paused state
    const progressBar = document.getElementById('progressBar');
    if (progressBar) {
        progressBar.className = 'bg-orange-500 h-2 rounded-full transition-all duration-300';
    }
    
    // Keep stats text white but update speed to show paused
    updateElement('downloadSpeed', '0 MB/s (Paused)');
    updateElement('mini-speed', 'Paused');
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
    elements.videoPlayer = document.getElementById('videoPlayer');
    elements.videoPlaceholder = document.getElementById('videoPlaceholder');
    elements.progressContainer = document.getElementById('progressContainer');
    elements.progressBar = document.getElementById('progressBar');
    elements.statusText = document.getElementById('status');
    elements.downloadSpeed = document.getElementById('downloadSpeed');
    elements.downloaded = document.getElementById('downloaded');
    elements.totalSize = document.getElementById('totalSize');

    // Media player elements
    elements.mediaPlayerModal = document.getElementById('mediaPlayerModal');
    elements.closeMediaPlayer = document.getElementById('closeMediaPlayer');
    elements.customVideoPlayer = document.getElementById('customVideoPlayer');
    elements.customAudioPlayer = document.getElementById('customAudioPlayer');
    elements.playPauseBtn = document.getElementById('playPauseBtn');
    elements.playPauseIcon = document.getElementById('playPauseIcon');
    elements.seekBar = document.getElementById('seekBar');
    elements.stopBtn = document.getElementById('stopBtn');
}

function setupEventListeners() {
    const searchBtn = document.getElementById('searchBtn');
    const searchInput = document.getElementById('searchInput');
    const stopBtn = document.getElementById('stopBtn');
    
    if (searchBtn) {
        searchBtn.addEventListener('click', handleSearch);
    }
    
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleSearch();
        });
    }
    
    if (stopBtn) {
        stopBtn.addEventListener('click', stopStream);
    }
    
    const launchPlayerBtn = document.getElementById('launchPlayerBtn');
    if (launchPlayerBtn) {
        launchPlayerBtn.addEventListener('click', launchMediaPlayer);
    }
    
    // Media player controls
    if (elements.mediaPlayerModal && elements.closeMediaPlayer) {
        elements.closeMediaPlayer.addEventListener('click', () => {
            elements.mediaPlayerModal.style.display = 'none';
        });
    }
}

function setupIpcHandlers() {
    // IPC handlers are now set up globally above
    // This function can be used for other setup if needed
}

// Helper function to format bytes to human readable string
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Helper function to format seconds to human readable time
function formatTimeDetailed(seconds) {
    if (seconds === Infinity) return '∞';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    
    if (h > 0) {
        return `${h}h ${m}m ${s}s`;
    } else if (m > 0) {
        return `${m}m ${s}s`;
    } else {
        return `${s}s`;
    }
}

// Helper function to format time
function formatTime(seconds) {
    if (isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

// --- Custom Modal Player Controls ---
function getCurrentMedia() {
    return elements.customVideoPlayer && !elements.customVideoPlayer.paused ? elements.customVideoPlayer :
           elements.customAudioPlayer && !elements.customAudioPlayer.paused ? elements.customAudioPlayer : null;
}

// Handle window resize to maintain aspect ratio
function handleResize() {
    const { customVideoPlayer } = elements;
    if (!customVideoPlayer) return;
    
    const container = customVideoPlayer.parentElement;
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    
    const videoRatio = customVideoPlayer.videoWidth / customVideoPlayer.videoHeight;
    const containerRatio = containerWidth / containerHeight;
    
    if (containerRatio > videoRatio) {
        // Container is wider than video aspect ratio
        customVideoPlayer.style.width = `${containerHeight * videoRatio}px`;
        customVideoPlayer.style.height = `${containerHeight}px`;
    } else {
        // Container is taller than video aspect ratio
        customVideoPlayer.style.width = `${containerWidth}px`;
        customVideoPlayer.style.height = `${containerWidth / videoRatio}px`;
    }
}

// Set up window resize handler
function setupVideoResizeHandler() {
    const { customVideoPlayer } = elements;
    if (customVideoPlayer) {
        customVideoPlayer.addEventListener('loadedmetadata', handleResize);
        window.addEventListener('resize', handleResize);
    }
}

// Set up media controls
function setupMediaControls() {
    if (elements.mediaPlayerModal) {
        // Play/Pause toggle
        elements.playPauseBtn.addEventListener('click', () => {
            const media = getCurrentMedia();
            if (!media) return;
            if (media.paused) {
                media.play();
                elements.playPauseIcon.textContent = '\u23F8'; // Pause
            } else {
                media.pause();
                elements.playPauseIcon.textContent = '\u25B6'; // Play
            }
        });

        // Update play/pause icon on play/pause
        [elements.customVideoPlayer, elements.customAudioPlayer].forEach(media => {
            media.addEventListener('play', () => {
                elements.playPauseIcon.textContent = '\u23F8';
            });
            media.addEventListener('pause', () => {
                elements.playPauseIcon.textContent = '\u25B6';
            });
        });

        // Seek bar
        [elements.customVideoPlayer, elements.customAudioPlayer].forEach(media => {
            media.addEventListener('timeupdate', () => {
                if (elements.seekBar) {
                    elements.seekBar.value = media.duration ? (media.currentTime / media.duration) * 100 : 0;
                    elements.currentTimeLabel.textContent = formatTime(media.currentTime);
                    elements.durationLabel.textContent = formatTime(media.duration);
                }
            });
            media.addEventListener('loadedmetadata', () => {
                if (elements.seekBar) {
                    elements.seekBar.max = 100;
                    elements.durationLabel.textContent = formatTime(media.duration);
                }
            });
        });
        if (elements.seekBar) {
            elements.seekBar.addEventListener('input', () => {
                const media = getCurrentMedia();
                if (media && media.duration) {
                    const seekTo = (elements.seekBar.value / 100) * media.duration;
                    elements.currentTimeLabel.textContent = formatTime(seekTo);
                }
            });
            elements.seekBar.addEventListener('change', () => {
                const media = getCurrentMedia();
                if (media && media.duration) {
                    media.currentTime = (elements.seekBar.value / 100) * media.duration;
                }
            });
        }

        // Volume
        if (elements.volumeBar) {
            elements.volumeBar.addEventListener('input', () => {
                const media = getCurrentMedia();
                if (media) {
                    media.volume = elements.volumeBar.value;
                    elements.volumeLabel.textContent = Math.round(elements.volumeBar.value * 100) + '%';
                }
            });
        }

        // Close modal
        elements.closeMediaPlayer.addEventListener('click', () => {
            elements.mediaPlayerModal.classList.add('hidden');
            // Pause and reset both players
            elements.customVideoPlayer.pause();
            elements.customAudioPlayer.pause();
            elements.customVideoPlayer.src = '';
            elements.customAudioPlayer.src = '';
        });

        // ESC key closes modal
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !elements.mediaPlayerModal.classList.contains('hidden')) {
                elements.closeMediaPlayer.click();
            }
        });
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
    let results, page, totalPages, totalResults;
    if (Array.isArray(data)) {
        // Old format - for backward compatibility
        results = data;
        page = 1;
        totalPages = 1;
        totalResults = data.length;
    } else {
        // New paginated format
        results = data.results || [];
        page = data.page || 1;
        totalPages = data.totalPages || 0;
        totalResults = data.totalResults || 0;
    }
    
    // Update pagination state
    currentPage = page;
    window.totalPages = totalPages;
    window.totalResults = totalResults;
    
    // Clear previous results
    resultsContainer.innerHTML = '';
    
    // Update results info
    const resultsInfo = document.getElementById('resultsInfo');
    const resultsCount = document.getElementById('resultsCount');
    if (resultsInfo && resultsCount) {
        if (totalResults > 0) {
            resultsCount.textContent = `${totalResults} results found`;
            resultsInfo.classList.remove('hidden');
        } else {
            resultsInfo.classList.add('hidden');
        }
    }
    
    if (!results || !Array.isArray(results) || results.length === 0) {
        resultsContainer.innerHTML = `
            <div class="text-center py-8 text-gray-400">
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
                <div class="text-center py-8 text-gray-400">
                    <p>No valid torrents found. Try a different search term.</p>
                </div>
            `;
            return;
        }

        // Display the valid results
        resultsContainer.innerHTML = validResults.map(result => `
            <div class="bg-gray-700 p-4 rounded-lg hover:bg-gray-600 transition-colors cursor-pointer mb-2" 
                 data-magnet="${result.magnet}">
                <h3 class="font-medium text-lg mb-1 truncate" title="${result.name}">${result.name}</h3>
                <div class="flex justify-between text-sm text-gray-400">
                    <span>${result.size || 'Unknown size'}</span>
                    <span>👥 ${result.seeds || 0} seeders</span>
                </div>
                ${result.provider ? `<div class="text-xs text-gray-500 mt-1">Source: ${result.provider}</div>` : ''}
            </div>
        `).join('');

        // Add click handlers to result items
        document.querySelectorAll('#resultsContainer > div').forEach((item, index) => {
            const result = validResults[index];
            item.addEventListener('click', () => startStream(result.magnet, result.name));
        });
        
        // Setup pagination controls
        setupPagination(page, totalPages);

    } catch (error) {
        console.error('Error displaying results:', error);
        resultsContainer.innerHTML = `
            <div class="text-center py-8 text-red-400">
                <p>Error displaying results. Please try again.</p>
                <p class="text-xs mt-2">${error.message}</p>
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
    button.className = pageNum === currentPage 
        ? 'px-3 py-2 bg-blue-600 text-white rounded-md font-medium'
        : 'px-3 py-2 bg-gray-700 text-gray-300 rounded-md hover:bg-gray-600 transition-colors';
    
    if (pageNum !== currentPage) {
        button.onclick = () => performSearch(currentSearchQuery, pageNum);
    }
    
    pageNumbers.appendChild(button);
}

function createEllipsis() {
    const span = document.createElement('span');
    span.textContent = '...';
    span.className = 'px-2 py-2 text-gray-400';
    return span;
}

async function startStream(magnet, name) {
    // Show loading state
    const statusElement = document.getElementById('status-text');
    if (statusElement) {
        statusElement.textContent = 'Starting stream...';
    }
    
    // Disable launch button until ready
    const launchPlayerBtn = document.getElementById('launchPlayerBtn');
    if (launchPlayerBtn) {
        launchPlayerBtn.disabled = true;
        launchPlayerBtn.className = 'bg-gray-500 px-4 py-1 rounded font-medium transition-colors text-gray-300 cursor-not-allowed text-sm';
    }
    
    // Show the bottom status bar immediately
    showBottomStatusBar();
    
    // Initialize progress display
    const statusEl = document.getElementById('status');
    if (statusEl) {
        statusEl.textContent = 'Connecting to peers...';
    }
    
    // Hide any existing video
    const videoPlayer = document.getElementById('video-player');
    if (videoPlayer) {
        videoPlayer.style.display = 'none';
        videoPlayer.src = '';
    }
    
    // Show the video placeholder
    const videoPlaceholder = document.getElementById('video-placeholder');
    if (videoPlaceholder) {
        videoPlaceholder.style.display = 'flex';
        videoPlaceholder.textContent = 'Loading stream...';
    }
    
    try {
        // Send request to start the stream using invoke for proper response handling
        const result = await window.api.invoke('start-stream', magnet);
        
        // Update status
        if (statusElement) {
            statusElement.textContent = 'Stream started - VLC should be opening...';
        }
    } catch (error) {
        console.error('Error starting stream:', error);
        
        // Show error state
        if (statusElement) {
            statusElement.textContent = `Error: ${error.message}`;
        }
        
        // Hide bottom status bar on error
        hideBottomStatusBar();
        
        // Show error in video placeholder
        if (videoPlaceholder) {
            videoPlaceholder.textContent = `Failed to start stream: ${error.message}`;
        }
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
        saveBtn.className = 'bg-green-700 px-6 py-2 rounded-lg font-medium transition-colors';
        
        setTimeout(() => {
            saveBtn.textContent = originalText;
            saveBtn.className = 'bg-green-600 hover:bg-green-700 px-6 py-2 rounded-lg font-medium transition-colors';
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

