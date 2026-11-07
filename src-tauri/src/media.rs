//! 動画を <video> に流すための小さな HTTP サーバー。
//!
//! Tauri 標準の asset プロトコルは Linux (WebKitGTK) だと動画を再生できず、
//! Windows でも数 GB の録画をシークするときに 1MB ずつしか返さないため、
//! 127.0.0.1 限定・推測できないトークン付きの URL で、許可したフォルダ内の動画だけを配信する。

use std::collections::HashSet;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};

pub struct MediaServer {
    base: String,
    token: String,
    allowed_dirs: Mutex<HashSet<PathBuf>>,
    allowed_files: Mutex<HashSet<PathBuf>>,
}

fn random_token() -> String {
    let mut buf = [0u8; 16];
    getrandom::fill(&mut buf).expect("OS の乱数が使えません");
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

fn canonical(p: &Path) -> Option<PathBuf> {
    // Windows の canonicalize は \\?\C:\... 形式になるが、比較はどちらも同じ関数を通すので揃う
    std::fs::canonicalize(p).ok()
}

impl MediaServer {
    pub fn start() -> std::io::Result<Arc<Self>> {
        let server = Server::http("127.0.0.1:0").map_err(std::io::Error::other)?;
        let port = server
            .server_addr()
            .to_ip()
            .map(|a| a.port())
            .ok_or_else(|| std::io::Error::other("ポートを取得できません"))?;
        let token = random_token();
        let me = Arc::new(Self {
            base: format!("http://127.0.0.1:{port}/{token}/"),
            token,
            allowed_dirs: Mutex::default(),
            allowed_files: Mutex::default(),
        });
        let worker = me.clone();
        std::thread::Builder::new()
            .name("media-server".into())
            .spawn(move || {
                for req in server.incoming_requests() {
                    let me = worker.clone();
                    // 再生中の接続は長く続くので、リクエストごとにスレッドを分ける
                    std::thread::spawn(move || me.handle(req));
                }
            })?;
        Ok(me)
    }

    /// `base + encodeURIComponent(フルパス)` で動画にアクセスできる
    pub fn base_url(&self) -> &str {
        &self.base
    }

    pub fn allow_dir(&self, dir: &Path) {
        if let Some(c) = canonical(dir) {
            self.allowed_dirs.lock().unwrap().insert(c);
        }
    }

    pub fn allow_file(&self, file: &Path) {
        if let Some(c) = canonical(file) {
            self.allowed_files.lock().unwrap().insert(c);
        }
    }

    pub fn is_allowed(&self, path: &Path) -> bool {
        let Some(c) = canonical(path) else {
            return false;
        };
        if !c.is_file() || !crate::files::is_video(&c) {
            return false;
        }
        if self.allowed_files.lock().unwrap().contains(&c) {
            return true;
        }
        c.parent()
            .map(|p| self.allowed_dirs.lock().unwrap().contains(p))
            .unwrap_or(false)
    }

    /// URL のパス部分（`/token/エンコード済みパス?query`）からファイルパスを取り出す
    fn path_from_url(&self, url: &str) -> Option<PathBuf> {
        let path = url.split('?').next()?;
        let rest = path
            .strip_prefix('/')?
            .strip_prefix(self.token.as_str())?
            .strip_prefix('/')?;
        let decoded = percent_encoding::percent_decode_str(rest)
            .decode_utf8()
            .ok()?;
        if decoded.is_empty() {
            return None;
        }
        Some(PathBuf::from(decoded.as_ref()))
    }

    fn handle(&self, req: Request) {
        let _ = match self.respond(&req) {
            Ok(resp) => req.respond(resp),
            Err(status) => req.respond(Response::empty(status)),
        };
    }

    fn respond(&self, req: &Request) -> Result<Response<std::io::Take<File>>, StatusCode> {
        if !matches!(req.method(), Method::Get | Method::Head) {
            return Err(StatusCode(405));
        }
        let path = self.path_from_url(req.url()).ok_or(StatusCode(404))?;
        if !self.is_allowed(&path) {
            return Err(StatusCode(403));
        }
        let mut file = File::open(&path).map_err(|_| StatusCode(404))?;
        let len = file.metadata().map_err(|_| StatusCode(500))?.len();

        let range = req
            .headers()
            .iter()
            .find(|h| h.field.equiv("Range"))
            .map(|h| parse_range(h.value.as_str(), len));

        let mut headers = vec![
            header("Content-Type", content_type(&path)),
            header("Accept-Ranges", "bytes"),
            // OBS が書き込み中のファイルはサイズが変わるので、キャッシュさせない
            header("Cache-Control", "no-store"),
        ];
        let (status, start, count) = match range {
            None => (200, 0, len),
            Some(Some((start, end))) => {
                headers.push(header(
                    "Content-Range",
                    &format!("bytes {start}-{end}/{len}"),
                ));
                (206, start, end - start + 1)
            }
            Some(None) => {
                let mut r = Response::new(
                    StatusCode(416),
                    vec![header("Content-Range", &format!("bytes */{len}"))],
                    file.take(0),
                    Some(0),
                    None,
                );
                r.add_header(header("Accept-Ranges", "bytes"));
                return Ok(r);
            }
        };
        file.seek(SeekFrom::Start(start))
            .map_err(|_| StatusCode(500))?;
        // tiny_http は既定で 32KB 超を chunked で送り Content-Length が消える。
        // 長さが分からないと WebKit はシークできず、moov が末尾にある OBS の mp4 を開けないので必ず付ける。
        Ok(Response::new(
            StatusCode(status),
            headers,
            file.take(count),
            Some(count as usize),
            None,
        )
        .with_chunked_threshold(usize::MAX))
    }
}

fn header(name: &str, value: &str) -> Header {
    Header::from_bytes(name.as_bytes(), value.as_bytes()).expect("valid header")
}

fn content_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("mp4" | "m4v") => "video/mp4",
        Some("mov") => "video/quicktime",
        Some("webm") => "video/webm",
        Some("mkv") => "video/x-matroska",
        _ => "application/octet-stream",
    }
}

/// `bytes=a-b` / `bytes=a-` / `bytes=-n` を (開始, 終了) に。範囲外なら None（416）。
/// 複数範囲は最初の 1 つだけ扱う。
pub fn parse_range(value: &str, len: u64) -> Option<(u64, u64)> {
    let spec = value
        .trim()
        .strip_prefix("bytes=")?
        .split(',')
        .next()?
        .trim();
    let (a, b) = spec.split_once('-')?;
    if len == 0 {
        return None;
    }
    let (start, end) = if a.is_empty() {
        let n: u64 = b.parse().ok()?;
        if n == 0 {
            return None;
        }
        (len.saturating_sub(n), len - 1)
    } else {
        let start: u64 = a.parse().ok()?;
        let end = if b.is_empty() {
            len - 1
        } else {
            b.parse::<u64>().ok()?.min(len - 1)
        };
        (start, end)
    };
    (start <= end && start < len).then_some((start, end))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::net::TcpStream;

    #[test]
    fn parses_ranges() {
        assert_eq!(parse_range("bytes=0-", 100), Some((0, 99)));
        assert_eq!(parse_range("bytes=10-19", 100), Some((10, 19)));
        assert_eq!(parse_range("bytes=90-200", 100), Some((90, 99)));
        assert_eq!(parse_range("bytes=-10", 100), Some((90, 99)));
        assert_eq!(parse_range("bytes=100-", 100), None);
        assert_eq!(parse_range("bytes=5-1", 100), None);
        assert_eq!(parse_range("items=0-1", 100), None);
    }

    fn get(base: &str, path_and_query: &str, range: Option<&str>) -> (u16, Vec<u8>, String) {
        let addr = base
            .trim_start_matches("http://")
            .split('/')
            .next()
            .unwrap();
        let mut s = TcpStream::connect(addr).unwrap();
        let range = range.map(|r| format!("Range: {r}\r\n")).unwrap_or_default();
        write!(
            s,
            "GET {path_and_query} HTTP/1.1\r\nHost: {addr}\r\n{range}Connection: close\r\n\r\n"
        )
        .unwrap();
        let mut buf = Vec::new();
        s.read_to_end(&mut buf).unwrap();
        let split = buf.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
        let head = String::from_utf8_lossy(&buf[..split]).to_string();
        let status = head.split(' ').nth(1).unwrap().parse().unwrap();
        (status, buf[split + 4..].to_vec(), head)
    }

    #[test]
    fn serves_only_allowed_files_with_ranges() {
        let dir = tempfile::tempdir().unwrap();
        let video = dir.path().join("rec 1.mp4");
        let mut data = b"0123456789".to_vec();
        data.resize(100_000, b'x'); // chunked にならないことを確かめるため 32KB より大きく
        std::fs::write(&video, &data).unwrap();
        let secret = dir.path().join("secret.txt");
        std::fs::write(&secret, b"nope").unwrap();

        let srv = MediaServer::start().unwrap();
        let base = srv.base_url().to_string();
        let url_path = |p: &Path| {
            let enc = percent_encoding::utf8_percent_encode(
                p.to_str().unwrap(),
                percent_encoding::NON_ALPHANUMERIC,
            )
            .to_string();
            format!("/{}/{enc}", srv.token)
        };

        // フォルダを許可する前は 403
        assert_eq!(get(&base, &url_path(&video), None).0, 403);
        srv.allow_dir(dir.path());

        let (st, body, head) = get(&base, &url_path(&video), None);
        assert_eq!((st, body.len()), (200, 100_000));
        assert!(head.contains("video/mp4"));
        assert!(head.contains("Content-Length: 100000"), "{head}");
        assert!(head.contains("Accept-Ranges: bytes"));
        assert!(!head.to_ascii_lowercase().contains("chunked"));

        let (st, body, head) = get(
            &base,
            &format!("{}?r=1", url_path(&video)),
            Some("bytes=2-5"),
        );
        assert_eq!((st, body.as_slice()), (206, &b"2345"[..]));
        assert!(head.contains("bytes 2-5/100000"));

        let (st, body, head) = get(&base, &url_path(&video), Some("bytes=50000-"));
        assert_eq!((st, body.len()), (206, 50_000));
        assert!(head.contains("Content-Length: 50000"), "{head}");

        assert_eq!(get(&base, &url_path(&video), Some("bytes=100000-")).0, 416);
        // 動画以外・トークン違いは配信しない
        assert_eq!(get(&base, &url_path(&secret), None).0, 403);
        assert_eq!(
            get(&base, &url_path(&video).replace(&srv.token, "bad"), None).0,
            404
        );
    }
}
