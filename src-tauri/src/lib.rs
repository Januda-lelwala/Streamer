mod search;
mod torrent;

use librqbit::Session;
use tauri::{AppHandle, State};
use tokio::sync::Mutex;

use search::SearchResponse;
use torrent::{Launched, TorrentManager};

struct AppState {
    mgr: Mutex<TorrentManager>,
}

#[tauri::command]
async fn search_torrents(query: String, page: u32) -> Result<SearchResponse, String> {
    Ok(search::search(&query, page).await)
}

#[tauri::command]
async fn start_stream(
    app: AppHandle,
    state: State<'_, AppState>,
    magnet: String,
) -> Result<String, String> {
    let mut mgr = state.mgr.lock().await;
    mgr.start_stream(&app, &magnet).await
}

#[tauri::command]
async fn stop_stream(state: State<'_, AppState>) -> Result<(), String> {
    let mut mgr = state.mgr.lock().await;
    mgr.stop_stream().await
}

#[tauri::command]
async fn pause_stream(app: AppHandle, state: State<'_, AppState>) -> Result<String, String> {
    let mut mgr = state.mgr.lock().await;
    mgr.pause_stream(&app).await
}

#[tauri::command]
async fn resume_stream(app: AppHandle, state: State<'_, AppState>) -> Result<String, String> {
    let mut mgr = state.mgr.lock().await;
    mgr.resume_stream(&app).await
}

#[tauri::command]
async fn launch_media_player(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Launched, String> {
    let mut mgr = state.mgr.lock().await;
    mgr.launch_media_player(&app).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let temp_dir = std::env::temp_dir().join("torrent-streamer");
    if let Err(e) = std::fs::create_dir_all(&temp_dir) {
        eprintln!("warning: failed to create temp dir {temp_dir:?}: {e}");
    }

    // Create the librqbit session up front (blocking on the async runtime).
    let session = tauri::async_runtime::block_on(async {
        Session::new(temp_dir.clone())
            .await
            .expect("failed to create torrent session")
    });

    let state = AppState {
        mgr: Mutex::new(TorrentManager::new(session, temp_dir)),
    };

    tauri::Builder::default()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            search_torrents,
            start_stream,
            stop_stream,
            pause_stream,
            resume_stream,
            launch_media_player
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
