//! Desktop OAuth loopback (RFC 8252).
//!
//! The web app cannot receive a browser redirect under the `tauri://` origin, so
//! the native build runs sign-in by opening the system browser and listening on
//! a fixed loopback port for the callback. This module owns only the transport:
//! it opens the browser to the authorize URL the web built and returns the raw
//! callback query string (`code` + `state`). The PKCE verifier and the token
//! exchange stay in the web layer, so no secret ever reaches Rust.

use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::time::{Duration, Instant};

/// The fixed loopback the desktop flow listens on. Gatekeeper's `facet-app`
/// OAuth client must register `http://127.0.0.1:8973/callback` as an allowed
/// redirect for native login to complete (a separate infra step)
const LOOPBACK_ADDR: &str = "127.0.0.1:8973";

/// How long to wait for the browser to complete login before giving up, so an
/// abandoned login never leaks the listener thread.
const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);

/// Self-contained page served back to the browser after the callback lands, so
/// the tab reads as part of Facet rather than a bare confirmation.
const CALLBACK_PAGE: &str = r#"<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Facet</title>
    <style>
      html, body { margin: 0; height: 100%; display: flex; align-items: center;
        justify-content: center; background: #0f1217; color: #d8dde3;
        font-family: system-ui, sans-serif; }
      .card { text-align: center; padding: 40px 48px; border-radius: 12px;
        background: #161b22; border: 1px solid #2a313b; }
      .mark { font-size: 2.5rem; line-height: 1; margin-bottom: 12px; }
      h1 { margin: 0 0 8px; font-size: 1.2rem; color: #3dd68c; }
      p { margin: 0; font-size: 0.9rem; color: #8b939e; }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="mark">🔶</div>
      <h1>Signed in to Facet</h1>
      <p>You can close this tab and return to the app.</p>
    </div>
  </body>
</html>"#;

/// Open `url` in the user's default browser. `url` is always one the caller
/// built (the authorize URL), never derived from untrusted input.
fn open_browser(url: &str) -> bool {
    #[cfg(target_os = "linux")]
    let mut command = std::process::Command::new("xdg-open");
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(target_os = "windows")]
    let mut command = std::process::Command::new("cmd");

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    command.arg(url);
    // The empty string is the (unused) window title `start` expects before the
    // URL, so a URL that looks like a flag is never misread
    #[cfg(target_os = "windows")]
    command.args(["/C", "start", "", url]);

    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        let _ = url;
        return false;
    }

    #[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
    {
        use std::process::Stdio;
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .is_ok()
    }
}

/// Extract the query string from an HTTP request line like
/// `GET /callback?code=...&state=... HTTP/1.1`.
fn query_from_request_line(line: &str) -> String {
    line.split_whitespace()
        .nth(1)
        .and_then(|path| path.split_once('?').map(|(_, query)| query.to_owned()))
        .unwrap_or_default()
}

/// Run the desktop loopback sign-in: open the browser to `authorize_url`, wait
/// for the redirect on the loopback port, and return the raw callback query
/// string (`code` + `state`). Sync so Tauri runs it on a worker thread; the
/// caller (web) verifies `state` and exchanges the code
#[tauri::command]
pub fn oauth_loopback(authorize_url: &str) -> Result<String, String> {
    let listener =
        TcpListener::bind(LOOPBACK_ADDR).map_err(|e| format!("could not bind loopback: {e}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("could not configure loopback: {e}"))?;

    if !open_browser(authorize_url) {
        return Err("could not open the system browser".to_owned());
    }

    let deadline = Instant::now() + LOGIN_TIMEOUT;
    loop {
        match listener.accept() {
            Ok((mut stream, _)) => {
                // Read the request line, then (reader dropped) write the reply
                let query = {
                    let mut reader = BufReader::new(&stream);
                    let mut line = String::new();
                    reader
                        .read_line(&mut line)
                        .map_err(|e| format!("could not read callback: {e}"))?;
                    query_from_request_line(&line)
                };

                let _ = write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    CALLBACK_PAGE.len(),
                    CALLBACK_PAGE,
                );
                let _ = stream.flush();

                if query.is_empty() {
                    return Err("callback carried no query".to_owned());
                }
                return Ok(query);
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() >= deadline {
                    return Err("timed out waiting for the browser redirect".to_owned());
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => return Err(format!("loopback accept failed: {e}")),
        }
    }
}
