//! Torrent search.
//!
//! The original Electron app used the Node `torrent-search-api` package which
//! scrapes several indexers. Here we query the Pirate Bay JSON API (apibay),
//! which returns clean JSON (name, info_hash, seeders, leechers, size) for a
//! query, and synthesize magnet links from the returned info hashes.

use serde::{Deserialize, Serialize};

const RESULTS_PER_PAGE: usize = 20;

// Public trackers appended to every synthesized magnet link so the swarm can
// be found even though apibay only gives us an info hash.
const TRACKERS: &[&str] = &[
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.tracker.cl:1337/announce",
    "udp://9.rarbg.com:2810/announce",
    "udp://tracker.openbittorrent.com:6969/announce",
    "udp://exodus.desync.com:6969/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://tracker.dler.org:6969/announce",
    "udp://open.stealth.si:80/announce",
];

#[derive(Debug, Deserialize)]
struct ApibayItem {
    name: String,
    info_hash: String,
    seeders: String,
    leechers: String,
    size: String,
    #[serde(default)]
    num_files: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub name: String,
    pub size: String,
    pub seeds: i64,
    pub peers: i64,
    pub magnet: String,
    pub provider: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse {
    pub results: Vec<SearchResult>,
    pub page: u32,
    pub total_pages: u32,
    pub total_results: u32,
    pub query: String,
}

fn empty_response(query: &str, page: u32) -> SearchResponse {
    SearchResponse {
        results: Vec::new(),
        page,
        total_pages: 0,
        total_results: 0,
        query: query.to_string(),
    }
}

fn format_bytes(bytes: f64) -> String {
    if bytes <= 0.0 {
        return "0 Bytes".to_string();
    }
    const UNITS: [&str; 5] = ["Bytes", "KB", "MB", "GB", "TB"];
    let k = 1024f64;
    let i = (bytes.ln() / k.ln()).floor() as usize;
    let i = i.min(UNITS.len() - 1);
    let value = bytes / k.powi(i as i32);
    format!("{:.2} {}", value, UNITS[i])
}

fn build_magnet(info_hash: &str, name: &str) -> String {
    let mut magnet = format!(
        "magnet:?xt=urn:btih:{}&dn={}",
        info_hash,
        urlencoding::encode(name)
    );
    for tr in TRACKERS {
        magnet.push_str("&tr=");
        magnet.push_str(&urlencoding::encode(tr));
    }
    magnet
}

/// Search for torrents and return a paginated response that matches the shape
/// the original renderer expects.
pub async fn search(query: &str, page: u32) -> SearchResponse {
    let query = query.trim();
    if query.len() < 2 {
        return empty_response(query, page.max(1));
    }
    let page = page.max(1);

    let url = format!(
        "https://apibay.org/q.php?q={}&cat=0",
        urlencoding::encode(query)
    );

    let client = match reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) torrent-streamer")
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("failed to build http client: {e}");
            return empty_response(query, page);
        }
    };

    let items: Vec<ApibayItem> = match client.get(&url).send().await {
        Ok(resp) => match resp.json().await {
            Ok(items) => items,
            Err(e) => {
                tracing::error!("failed to parse search response: {e}");
                return empty_response(query, page);
            }
        },
        Err(e) => {
            tracing::error!("search request failed: {e}");
            return empty_response(query, page);
        }
    };

    // apibay returns a single sentinel item with a zeroed hash when nothing
    // matched.
    let all: Vec<SearchResult> = items
        .into_iter()
        .filter(|it| {
            it.info_hash.len() == 40
                && it.info_hash.chars().any(|c| c != '0')
                && it.name != "No results returned"
        })
        .map(|it| {
            let size = it.size.parse::<f64>().unwrap_or(0.0);
            let files = it.num_files.parse::<i64>().unwrap_or(0);
            let provider = if files > 1 {
                format!("The Pirate Bay ({} files)", files)
            } else {
                "The Pirate Bay".to_string()
            };
            SearchResult {
                magnet: build_magnet(&it.info_hash, &it.name),
                name: it.name,
                size: format_bytes(size),
                seeds: it.seeders.parse().unwrap_or(0),
                peers: it.leechers.parse().unwrap_or(0),
                provider,
            }
        })
        .collect();

    let total_results = all.len();
    let total_pages = ((total_results + RESULTS_PER_PAGE - 1) / RESULTS_PER_PAGE) as u32;

    let start = (page as usize - 1) * RESULTS_PER_PAGE;
    let results: Vec<SearchResult> = if start >= total_results {
        Vec::new()
    } else {
        let end = (start + RESULTS_PER_PAGE).min(total_results);
        all.into_iter().skip(start).take(end - start).collect()
    };

    SearchResponse {
        results,
        page,
        total_pages,
        total_results: total_results as u32,
        query: query.to_string(),
    }
}
