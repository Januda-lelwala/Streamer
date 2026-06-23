// Tauri IPC compatibility shim.
//
// The original Electron app talked to the main process through a preload
// bridge exposed as `window.api` with `send` / `invoke` / `receive`.
// Tauri exposes `window.__TAURI__` (enabled via `app.withGlobalTauri`).
// This shim re-creates the old `window.api` surface on top of Tauri's
// `invoke` (command calls) and `event.listen` (push events) so the rest of
// the renderer code can stay unchanged.

(function () {
    const tauri = window.__TAURI__;
    if (!tauri) {
        console.error('[api] window.__TAURI__ not found. Are you running inside Tauri?');
        return;
    }

    const invoke = tauri.core.invoke;
    const listen = tauri.event.listen;

    // Map the old hyphenated channel names to Rust command names.
    const COMMANDS = {
        'start-stream': 'start_stream',
        'stop-stream': 'stop_stream',
        'launch-media-player': 'launch_media_player',
        'pause-stream': 'pause_stream',
        'resume-stream': 'resume_stream',
    };

    // Channels pushed from Rust via `app.emit(...)`.
    const EVENT_CHANNELS = [
        'download-progress',
        'media-player-ready',
        'media-player-launched',
        'stream-error',
        'stream-paused',
        'stream-resumed',
    ];

    // channel -> [callback]
    const receivers = {};

    function dispatch(channel, payload) {
        (receivers[channel] || []).forEach((fn) => {
            try {
                fn(payload);
            } catch (e) {
                console.error(`[api] receiver for "${channel}" threw:`, e);
            }
        });
    }

    // Subscribe to every Rust-emitted event channel once and fan out to the
    // registered receivers.
    EVENT_CHANNELS.forEach((channel) => {
        listen(channel, (event) => dispatch(channel, event.payload));
    });

    // Normalize a Tauri rejection (usually a String) into an Error with a
    // `.message`, which the renderer code expects.
    function toError(err) {
        if (err instanceof Error) return err;
        if (typeof err === 'string') return new Error(err);
        return new Error(JSON.stringify(err));
    }

    window.api = {
        // Fire-and-forget style. The only `send` channel used is
        // 'search-torrents', whose result is delivered back through the
        // 'search-results' receiver to mirror the old IPC contract.
        send: (channel, data) => {
            if (channel === 'search-torrents') {
                const { query, page } =
                    typeof data === 'string' ? { query: data, page: 1 } : data || {};
                invoke('search_torrents', { query, page: page || 1 })
                    .then((results) => dispatch('search-results', results))
                    .catch((err) => {
                        console.error('[api] search failed:', err);
                        dispatch('search-results', {
                            results: [],
                            page: 1,
                            totalPages: 0,
                            totalResults: 0,
                            query: query,
                        });
                    });
                return;
            }
            console.warn(`[api] unhandled send channel: ${channel}`);
        },

        // Request/response style.
        invoke: (channel, data) => {
            const command = COMMANDS[channel];
            if (!command) {
                return Promise.reject(new Error(`Unknown invoke channel: ${channel}`));
            }
            let args;
            if (channel === 'start-stream') {
                args = { magnet: data };
            } else {
                args = {};
            }
            return invoke(command, args).catch((err) => {
                throw toError(err);
            });
        },

        // Subscribe to a push channel.
        receive: (channel, func) => {
            if (!receivers[channel]) receivers[channel] = [];
            receivers[channel].push(func);
        },

        removeAllListeners: (channel) => {
            delete receivers[channel];
        },
    };
})();
