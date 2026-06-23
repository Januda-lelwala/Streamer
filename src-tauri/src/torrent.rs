//! Torrent streaming manager.
//!
//! Port of the Electron `TorrentManager` (which used `webtorrent`) onto
//! `librqbit`. Responsibilities:
//!   * add a magnet link, downloading only video files into a temp dir,
//!   * report download progress to the UI via Tauri events,
//!   * tell the UI when enough has downloaded to launch a media player,
//!   * launch VLC pointed at the (partially downloaded) file,
//!   * pause / resume / stop the active stream.

use std::path::PathBuf;
use std::process::Child;
use std::sync::Arc;
use std::time::Duration;

use librqbit::api::{Api, TorrentIdOrHash};
use librqbit::{AddTorrent, AddTorrentOptions, Session};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

const VIDEO_EXTS: &[&str] = &[".mp4", ".mkv", ".webm", ".avi", ".mov"];
const ONLY_FILES_REGEX: &str = r"(?i)\.(mp4|mkv|webm|avi|mov)$";
const MIN_DOWNLOAD_BYTES: u64 = 1024 * 1024; // 1 MB before media player is "ready"

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    progress: f64,
    download_speed: f64,
    downloaded: u64,
    length: u64,
    num_peers: u64,
    file_name: String,
    done: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaReady {
    file_path: String,
    file_name: String,
    downloaded: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Launched {
    file_path: String,
    file_name: String,
}

/// A selectable video file inside a torrent (e.g. one episode of a series).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoFile {
    /// Index of the file within the torrent — used as librqbit's file id.
    pub file_id: usize,
    pub name: String,
    pub size: u64,
    pub size_human: String,
}

#[derive(Clone, Serialize)]
struct Message {
    message: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PauseMessage {
    message: String,
    torrent_name: String,
}

/// The currently active stream.
struct Current {
    id: usize,
    file_path: PathBuf,
    file_name: String,
    vlc: Option<Child>,
    progress_task: Option<tauri::async_runtime::JoinHandle<()>>,
}

pub struct TorrentManager {
    api: Arc<Api>,
    temp_dir: PathBuf,
    current: Option<Current>,
}

impl TorrentManager {
    pub fn new(session: Arc<Session>, temp_dir: PathBuf) -> Self {
        let api = Arc::new(Api::new(session, None));
        Self {
            api,
            temp_dir,
            current: None,
        }
    }

    fn idh(id: usize) -> TorrentIdOrHash {
        TorrentIdOrHash::from(id)
    }

    /// Tear down any in-flight stream: kill VLC, stop progress reporting and
    /// remove the torrent (deleting its files).
    pub async fn stop_current(&mut self) {
        if let Some(mut cur) = self.current.take() {
            if let Some(task) = cur.progress_task.take() {
                task.abort();
            }
            if let Some(mut child) = cur.vlc.take() {
                let _ = child.kill();
            }
            let _ = self
                .api
                .api_torrent_action_delete(Self::idh(cur.id))
                .await;
        }
    }

    /// List the video files contained in a torrent without downloading it, so
    /// the user can choose which one (e.g. which episode) to stream.
    pub async fn list_files(&self, magnet: &str) -> Result<Vec<VideoFile>, String> {
        if !magnet.starts_with("magnet:") {
            return Err("Invalid magnet URI format".to_string());
        }

        let opts = AddTorrentOptions {
            list_only: true,
            ..Default::default()
        };

        let resp = tokio::time::timeout(
            Duration::from_secs(60),
            self.api.api_add_torrent(AddTorrent::from_url(magnet), Some(opts)),
        )
        .await
        .map_err(|_| "Timed out reading torrent metadata (no peers?)".to_string())?
        .map_err(|e| format!("Failed to read torrent: {e}"))?;

        let files = resp.details.files.unwrap_or_default();
        let mut videos: Vec<VideoFile> = files
            .iter()
            .enumerate()
            .filter(|(_, f)| {
                VIDEO_EXTS
                    .iter()
                    .any(|ext| f.name.to_lowercase().ends_with(ext))
            })
            .map(|(idx, f)| VideoFile {
                file_id: idx,
                name: f.name.clone(),
                size: f.length,
                size_human: format_bytes(f.length),
            })
            .collect();

        // Sort by name so episodes appear in a natural order.
        videos.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        Ok(videos)
    }

    pub async fn start_stream(
        &mut self,
        app: &AppHandle,
        magnet: &str,
        file_id: Option<usize>,
    ) -> Result<String, String> {
        if !magnet.starts_with("magnet:") {
            return Err("Invalid magnet URI format".to_string());
        }

        // Clean up any previous stream first.
        self.stop_current().await;

        // If the caller chose a specific file, download only that one;
        // otherwise fall back to "all video files" and auto-pick the largest.
        let opts = AddTorrentOptions {
            output_folder: Some(self.temp_dir.to_string_lossy().to_string()),
            overwrite: true,
            only_files: file_id.map(|id| vec![id]),
            only_files_regex: if file_id.is_some() {
                None
            } else {
                Some(ONLY_FILES_REGEX.to_string())
            },
            ..Default::default()
        };

        let resp = self
            .api
            .api_add_torrent(AddTorrent::from_url(magnet), Some(opts))
            .await
            .map_err(|e| format!("Failed to add torrent: {e}"))?;

        let id = resp.id.ok_or_else(|| "Torrent was not assigned an id".to_string())?;
        let idh = Self::idh(id);

        // Wait for metadata so the file list is available.
        let handle = self
            .api
            .mgr_handle(idh)
            .map_err(|e| format!("Failed to get torrent handle: {e}"))?;
        // Bound how long we wait for metadata so a dead magnet doesn't hang
        // the command (and the manager lock) forever.
        match tokio::time::timeout(Duration::from_secs(60), handle.wait_until_initialized()).await {
            Ok(Ok(())) => {}
            Ok(Err(e)) => return Err(format!("Failed to fetch torrent metadata: {e}")),
            Err(_) => {
                let _ = self.api.api_torrent_action_delete(idh).await;
                return Err("Timed out fetching torrent metadata (no peers?)".to_string());
            }
        }

        let details = self
            .api
            .api_torrent_details(idh)
            .map_err(|e| format!("Failed to get torrent details: {e}"))?;

        let output_folder = PathBuf::from(&details.output_folder);
        let files = details.files.unwrap_or_default();

        // Resolve which file to stream: the explicitly chosen one, or the
        // largest video file if none was specified.
        let components: Vec<String> = if let Some(id) = file_id {
            match files.get(id) {
                Some(f) => f.components.clone(),
                None => {
                    let msg = "Selected file not found in torrent".to_string();
                    let _ = app.emit("stream-error", Message { message: msg.clone() });
                    return Err(msg);
                }
            }
        } else {
            let mut best: Option<(u64, Vec<String>)> = None;
            for f in &files {
                let is_video = VIDEO_EXTS
                    .iter()
                    .any(|ext| f.name.to_lowercase().ends_with(ext));
                if !f.included || !is_video {
                    continue;
                }
                if best.as_ref().map(|(len, _)| f.length > *len).unwrap_or(true) {
                    best = Some((f.length, f.components.clone()));
                }
            }
            match best {
                Some((_, c)) => c,
                None => {
                    let msg = "No supported video file found in torrent".to_string();
                    let _ = app.emit("stream-error", Message { message: msg.clone() });
                    return Err(msg);
                }
            }
        };

        let mut file_path = output_folder;
        for c in &components {
            file_path.push(c);
        }
        let file_name = components
            .last()
            .cloned()
            .unwrap_or_else(|| details.name.clone().unwrap_or_default());

        // Spawn the progress-reporting / readiness loop.
        let task = spawn_progress_loop(
            app.clone(),
            self.api.clone(),
            id,
            file_path.clone(),
            file_name.clone(),
        );

        self.current = Some(Current {
            id,
            file_path,
            file_name,
            vlc: None,
            progress_task: Some(task),
        });

        Ok("Stream started".to_string())
    }

    pub async fn stop_stream(&mut self) -> Result<(), String> {
        self.stop_current().await;
        Ok(())
    }

    pub async fn pause_stream(&mut self, app: &AppHandle) -> Result<String, String> {
        let cur = self
            .current
            .as_mut()
            .ok_or_else(|| "No active torrent to pause".to_string())?;

        if let Some(task) = cur.progress_task.take() {
            task.abort();
        }
        self.api
            .api_torrent_action_pause(Self::idh(cur.id))
            .await
            .map_err(|e| format!("Failed to pause: {e}"))?;

        let _ = app.emit(
            "stream-paused",
            PauseMessage {
                message: "Download paused".to_string(),
                torrent_name: cur.file_name.clone(),
            },
        );
        Ok("Stream paused successfully".to_string())
    }

    pub async fn resume_stream(&mut self, app: &AppHandle) -> Result<String, String> {
        let (id, file_path, file_name) = {
            let cur = self
                .current
                .as_ref()
                .ok_or_else(|| "No paused torrent to resume".to_string())?;
            (cur.id, cur.file_path.clone(), cur.file_name.clone())
        };

        self.api
            .api_torrent_action_start(Self::idh(id))
            .await
            .map_err(|e| format!("Failed to resume: {e}"))?;

        let task = spawn_progress_loop(
            app.clone(),
            self.api.clone(),
            id,
            file_path,
            file_name.clone(),
        );
        if let Some(cur) = self.current.as_mut() {
            cur.progress_task = Some(task);
        }

        let _ = app.emit(
            "stream-resumed",
            PauseMessage {
                message: "Download resumed".to_string(),
                torrent_name: file_name,
            },
        );
        Ok("Stream resumed successfully".to_string())
    }

    pub async fn launch_media_player(&mut self, app: &AppHandle) -> Result<Launched, String> {
        let cur = self
            .current
            .as_mut()
            .ok_or_else(|| "No active torrent to launch media player for".to_string())?;

        if !cur.file_path.exists() {
            return Err("Media file not found. Please wait for download to start.".to_string());
        }

        let vlc_path = resolve_vlc_path()?;

        // Kill any previously launched player.
        if let Some(mut child) = cur.vlc.take() {
            let _ = child.kill();
        }

        let child = std::process::Command::new(&vlc_path)
            .arg("--fullscreen")
            .arg("--no-video-title-show")
            .arg("--no-osd")
            .arg(&cur.file_path)
            .spawn()
            .map_err(|e| {
                format!(
                    "Failed to start VLC ({}). Please install VLC from https://www.videolan.org/vlc/ ({e})",
                    vlc_path
                )
            })?;

        cur.vlc = Some(child);

        let launched = Launched {
            file_path: cur.file_path.to_string_lossy().to_string(),
            file_name: cur.file_name.clone(),
        };
        let _ = app.emit("media-player-launched", launched.clone());
        Ok(launched)
    }
}

fn format_bytes(bytes: u64) -> String {
    if bytes == 0 {
        return "0 Bytes".to_string();
    }
    const UNITS: [&str; 5] = ["Bytes", "KB", "MB", "GB", "TB"];
    let k = 1024f64;
    let b = bytes as f64;
    let i = ((b.ln() / k.ln()).floor() as usize).min(UNITS.len() - 1);
    format!("{:.2} {}", b / k.powi(i as i32), UNITS[i])
}

fn resolve_vlc_path() -> Result<String, String> {
    if cfg!(target_os = "macos") {
        let p = "/Applications/VLC.app/Contents/MacOS/VLC";
        if std::path::Path::new(p).exists() {
            Ok(p.to_string())
        } else {
            Err("VLC not found at /Applications/VLC.app. Please install VLC Media Player.".to_string())
        }
    } else {
        // On Windows / Linux rely on `vlc` being on PATH.
        Ok("vlc".to_string())
    }
}

/// Spawn the 1 Hz loop that emits `download-progress` and, once enough data is
/// available, a one-shot `media-player-ready` event.
fn spawn_progress_loop(
    app: AppHandle,
    api: Arc<Api>,
    id: usize,
    file_path: PathBuf,
    file_name: String,
) -> tauri::async_runtime::JoinHandle<()> {
    tauri::async_runtime::spawn(async move {
        let idh = TorrentIdOrHash::from(id);
        let mut media_ready = false;
        loop {
            let stats = match api.api_stats_v1(idh) {
                Ok(s) => s,
                Err(_) => break, // torrent gone
            };

            let value = serde_json::to_value(&stats).unwrap_or(serde_json::Value::Null);
            let downloaded = value
                .get("progress_bytes")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let total = value.get("total_bytes").and_then(|v| v.as_u64()).unwrap_or(0);
            let done = value
                .get("finished")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            // MiB/s reported by librqbit -> bytes/s for the UI.
            let download_speed = value
                .pointer("/live/download_speed/mbps")
                .and_then(|v| v.as_f64())
                .map(|mbps| mbps * 1024.0 * 1024.0)
                .unwrap_or(0.0);
            let num_peers = value
                .pointer("/live/snapshot/peer_stats/live")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);

            let progress = if total > 0 {
                (downloaded as f64 / total as f64) * 100.0
            } else {
                0.0
            };

            let _ = app.emit(
                "download-progress",
                Progress {
                    progress,
                    download_speed,
                    downloaded,
                    length: total,
                    num_peers,
                    file_name: file_name.clone(),
                    done,
                },
            );

            if !media_ready && (downloaded > MIN_DOWNLOAD_BYTES || file_path.exists()) {
                media_ready = true;
                let _ = app.emit(
                    "media-player-ready",
                    MediaReady {
                        file_path: file_path.to_string_lossy().to_string(),
                        file_name: file_name.clone(),
                        downloaded,
                    },
                );
            }

            if done {
                break;
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    })
}
