use redevplugin_worker_sdk::{
    IO_FLAG_EOF, WorkerError, WorkerRequest, WorkerResult,
    error::{Error as PlatformError, ErrorCode},
    export_worker, fs, http, tcp, udp, websocket,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

const BYTES: usize = 64 * 1024 * 1024;
const CHUNK: usize = 64 * 1024;
// Preserve the published default per-request ceiling; qualify 64 MiB in 64 requests.
const HTTP_SEGMENT: usize = 1024 * 1024;
const SEGMENT_SHA256: &str = "cc2cffa7208256c3d2e7fc44bc928e2b18c4390920e90bf087c97fcc4bec1f23";
const EXPECTED_SHA256: &str = "77a0c90e19a4122c3bb62fa54f710f121a215a2123ea7f0b38ec1b1265bcac83";

fn server(params: &Value) -> Result<(u16, u16, u16, u16), WorkerError> {
    let value = params.get("server").unwrap_or(&Value::Null);
    let port = |name: &str| {
        value
            .get(name)
            .and_then(Value::as_u64)
            .map(|v| v as u16)
            .filter(|v| *v > 0)
            .ok_or_else(|| WorkerError::invalid_request(format!("{name} port is invalid")))
    };
    Ok((
        port("http").unwrap_or(18080),
        port("ws").unwrap_or(18080),
        port("tcp").unwrap_or(18081),
        port("udp").unwrap_or(18082),
    ))
}

fn platform_error(error: PlatformError) -> WorkerError {
    let code = match error.code {
        ErrorCode::InvalidArgument => "INVALID_ARGUMENT",
        ErrorCode::PermissionDenied => "PERMISSION_DENIED",
        ErrorCode::NotFound => "NOT_FOUND",
        ErrorCode::AlreadyExists => "ALREADY_EXISTS",
        ErrorCode::NotEmpty => "NOT_EMPTY",
        ErrorCode::CrossDevice => "CROSS_DEVICE",
        ErrorCode::ResourceClosed => "RESOURCE_CLOSED",
        ErrorCode::Canceled => "CANCELED",
        ErrorCode::Timeout => "TIMEOUT",
        ErrorCode::WouldBlock => "WOULD_BLOCK",
        ErrorCode::IoError => "IO_ERROR",
        ErrorCode::MountUnavailable => "MOUNT_UNAVAILABLE",
        ErrorCode::NetworkError => "NETWORK_ERROR",
        ErrorCode::ResourceLimit => "RESOURCE_LIMIT",
        ErrorCode::Internal => "INTERNAL",
        ErrorCode::RuntimeUnavailable => "RUNTIME_UNAVAILABLE",
        ErrorCode::RedirectRequiresReplay => "REDIRECT_REQUIRES_REPLAY",
        ErrorCode::Unknown => "UNKNOWN",
    };
    WorkerError::new(code, error.message)
}

fn read_json_body(mut body: http::ResponseBody) -> Result<Value, WorkerError> {
    let mut bytes = Vec::new();
    loop {
        let (chunk, flags) = body.read(CHUNK).map_err(platform_error)?;
        if bytes.len() + chunk.len() > CHUNK {
            return Err(WorkerError::new(
                "SMOKE_RESPONSE_INVALID",
                "fixture response exceeded the bounded JSON response size",
            ));
        }
        bytes.extend_from_slice(&chunk);
        if flags & IO_FLAG_EOF != 0 {
            body.close().map_err(platform_error)?;
            return serde_json::from_slice(&bytes)
                .map_err(|error| WorkerError::new("SMOKE_RESPONSE_INVALID", error.to_string()));
        }
        if chunk.is_empty() {
            return Err(WorkerError::new(
                "SMOKE_RESPONSE_INVALID",
                "fixture response made no progress",
            ));
        }
    }
}

fn run(params: Value) -> WorkerResult {
    let (http_port, ws_port, tcp_port, udp_port) = server(&params)?;
    let uri = "redevfs://environment/tmp/redevplugin-io-smoke/data.bin";
    let renamed = "redevfs://environment/tmp/redevplugin-io-smoke/renamed.bin";
    fs::mkdir(
        "redevfs://environment/tmp/redevplugin-io-smoke",
        true,
        0o700,
    )
    .map_err(platform_error)?;
    let mut source = vec![0_u8; CHUNK];
    for (index, byte) in source.iter_mut().enumerate() {
        *byte = (index % 251) as u8;
    }
    let mut file = fs::File::open(
        uri,
        fs::OpenOptions {
            write: true,
            create: true,
            truncate: true,
            ..fs::OpenOptions::default()
        },
    )
    .map_err(platform_error)?;
    for _ in 0..(BYTES / CHUNK) {
        file.write_all(&source).map_err(platform_error)?;
    }
    file.sync().map_err(platform_error)?;
    file.close().map_err(platform_error)?;
    let stat = fs::stat(uri, true).map_err(platform_error)?;
    let mut dir = fs::Directory::open("redevfs://environment/tmp/redevplugin-io-smoke")
        .map_err(platform_error)?;
    let page = dir.next(32).map_err(platform_error)?;
    dir.close().map_err(platform_error)?;
    fs::rename(uri, renamed, true).map_err(platform_error)?;
    let mut watch = fs::Watch::open("redevfs://environment/tmp/redevplugin-io-smoke")
        .map_err(platform_error)?;
    fs::rename(renamed, uri, true).map_err(platform_error)?;
    let event = watch.next(5_000).map_err(platform_error)?;
    watch.close().map_err(platform_error)?;

    let mut file = fs::File::open(uri, fs::OpenOptions { read: true, ..fs::OpenOptions::default() }).map_err(platform_error)?;
    let mut uploaded_bytes = 0_usize;
    let mut file_hash = Sha256::new();
    for _ in 0..(BYTES / HTTP_SEGMENT) {
        let mut upload = http::RequestBody::begin(http::HttpRequest {
            connector_id: "smoke.http".into(), method: "POST".into(),
            url: format!("http://127.0.0.1:{http_port}/upload"), headers: vec![],
            redirect: http::RedirectMode::Follow, timeout_ms: Some(30_000),
        }).map_err(platform_error)?;
        let mut segment_bytes = 0;
        while segment_bytes < HTTP_SEGMENT {
            let (chunk, _) = file.read(CHUNK.min(HTTP_SEGMENT - segment_bytes)).map_err(platform_error)?;
            if chunk.is_empty() { return Err(WorkerError::new("SMOKE_STREAM_STALLED", "file ended early")); }
            file_hash.update(&chunk);
            upload.write_all(&chunk).map_err(platform_error)?;
            segment_bytes += chunk.len();
        }
        let response = upload.finish().map_err(platform_error)?;
        if response.status != 200 { return Err(WorkerError::new("SMOKE_RESPONSE_INVALID", "upload status")); }
        let result = read_json_body(response.body)?;
        if result["bytes"].as_u64() != Some(HTTP_SEGMENT as u64) || result["sha256"].as_str() != Some(SEGMENT_SHA256) {
            return Err(WorkerError::new("SMOKE_CONTENT_MISMATCH", "HTTP upload segment mismatch"));
        }
        uploaded_bytes += segment_bytes;
    }
    file.close().map_err(platform_error)?;
    let upload_sha256 = format!("{:x}", file_hash.finalize());
    if uploaded_bytes != BYTES || upload_sha256 != EXPECTED_SHA256 {
        return Err(WorkerError::new("SMOKE_CONTENT_MISMATCH", "file content mismatch"));
    }
    fs::remove(uri, false).map_err(platform_error)?;
    let mut download_bytes = 0_usize;
    for _ in 0..(BYTES / HTTP_SEGMENT) {
        let download = http::RequestBody::begin(http::HttpRequest {
            connector_id: "smoke.http".into(), method: "GET".into(),
            url: format!("http://127.0.0.1:{http_port}/download?bytes={HTTP_SEGMENT}"),
            headers: vec![], redirect: http::RedirectMode::Follow, timeout_ms: Some(30_000),
        }).map_err(platform_error)?;
        let response = download.finish().map_err(platform_error)?;
        if response.status != 200 { return Err(WorkerError::new("SMOKE_RESPONSE_INVALID", "download status")); }
        let mut download_body = response.body;
        let mut segment_bytes = 0;
        loop {
            let (chunk, flags) = download_body.read(CHUNK).map_err(platform_error)?;
            for (index, byte) in chunk.iter().enumerate() {
                if *byte != (((segment_bytes + index) % CHUNK) % 251) as u8 {
                    return Err(WorkerError::new("SMOKE_CONTENT_MISMATCH", "HTTP download content mismatch"));
                }
            }
            segment_bytes += chunk.len();
            if flags & IO_FLAG_EOF != 0 { download_body.close().map_err(platform_error)?; break; }
            if chunk.is_empty() { return Err(WorkerError::new("SMOKE_STREAM_STALLED", "HTTP download stalled")); }
        }
        if segment_bytes != HTTP_SEGMENT { return Err(WorkerError::new("SMOKE_CONTENT_MISMATCH", "HTTP download segment size mismatch")); }
        download_bytes += segment_bytes;
    }

    // Limits are acceptance outcomes, not settings to relax for this fixture.
    let mut oversized = http::RequestBody::begin(http::HttpRequest {
        connector_id: "smoke.http".into(), method: "POST".into(),
        url: format!("http://127.0.0.1:{http_port}/upload"), headers: vec![],
        redirect: http::RedirectMode::Follow, timeout_ms: Some(30_000),
    }).map_err(platform_error)?;
    let mut upload_limit = false;
    for _ in 0..=(HTTP_SEGMENT / CHUNK) {
        if let Err(error) = oversized.write_all(&source) {
            if error.code != ErrorCode::ResourceLimit { return Err(platform_error(error)); }
            upload_limit = true;
            break;
        }
    }
    if !upload_limit {
        match oversized.finish() {
            Err(error) if error.code == ErrorCode::ResourceLimit => upload_limit = true,
            Err(error) => return Err(platform_error(error)),
            Ok(_) => return Err(WorkerError::new("SMOKE_LIMIT_MISSING", "oversized upload accepted")),
        }
    }
    let request = http::RequestBody::begin(http::HttpRequest {
        connector_id: "smoke.http".into(), method: "GET".into(),
        url: format!("http://127.0.0.1:{http_port}/download?bytes={}", HTTP_SEGMENT + 1),
        headers: vec![], redirect: http::RedirectMode::Follow, timeout_ms: Some(30_000),
    }).map_err(platform_error)?;
    let mut body = request.finish().map_err(platform_error)?.body;
    let mut limited_bytes = 0;
    loop {
        match body.read(CHUNK) {
            Err(error) if error.code == ErrorCode::ResourceLimit => break,
            Err(error) => return Err(platform_error(error)),
            Ok((chunk, flags)) => {
                limited_bytes += chunk.len();
                if limited_bytes > HTTP_SEGMENT || flags & IO_FLAG_EOF != 0 {
                    return Err(WorkerError::new("SMOKE_LIMIT_MISSING", "oversized download accepted"));
                }
            }
        }
    }
    if limited_bytes != HTTP_SEGMENT { return Err(WorkerError::new("SMOKE_LIMIT_MISMATCH", "download ceiling changed")); }

    let mut ws = websocket::WebSocket::open(websocket::WebSocketOpen {
        connector_id: "smoke.ws".into(),
        url: format!("ws://127.0.0.1:{ws_port}/ws"),
        headers: vec![],
        subprotocols: vec![],
        timeout_ms: Some(30_000),
    })
    .map_err(platform_error)?;
    for index in 0..100 {
        let expected = format!("message-{index}");
        ws.send_text(&expected).map_err(platform_error)?;
        if ws.receive().map_err(platform_error)? != websocket::Message::Text(expected) {
            return Err(WorkerError::new("SMOKE_CONTENT_MISMATCH", "WebSocket echo mismatch"));
        }
    }
    ws.close(1000, "done").map_err(platform_error)?;
    let mut tcp = tcp::TcpStream::connect(tcp::TcpConnect {
        connector_id: "smoke.tcp".into(),
        host: "127.0.0.1".into(),
        port: tcp_port,
        timeout_ms: Some(30_000),
        no_delay: true,
        keep_alive_ms: None,
    })
    .map_err(platform_error)?;
    for index in 0..100 {
        let data = format!("tcp-{index}");
        tcp.write_all(data.as_bytes()).map_err(platform_error)?;
        let mut received = Vec::new();
        while received.len() < data.len() {
            let (chunk, flags) = tcp.read(data.len() - received.len()).map_err(platform_error)?;
            if chunk.is_empty() || flags & IO_FLAG_EOF != 0 {
                return Err(WorkerError::new("SMOKE_CONTENT_MISMATCH", "TCP echo ended early"));
            }
            received.extend_from_slice(&chunk);
        }
        if received != data.as_bytes() {
            return Err(WorkerError::new("SMOKE_CONTENT_MISMATCH", "TCP echo mismatch"));
        }
    }
    tcp.close().map_err(platform_error)?;
    let mut udp = udp::UdpSocket::connect(udp::UdpConnect {
        connector_id: "smoke.udp".into(),
        host: "127.0.0.1".into(),
        port: udp_port,
        timeout_ms: Some(30_000),
    })
    .map_err(platform_error)?;
    for index in 0..100 {
        let expected = format!("udp-{index}");
        udp.send(expected.as_bytes()).map_err(platform_error)?;
        if udp.receive().map_err(platform_error)? != expected.as_bytes() {
            return Err(WorkerError::new("SMOKE_CONTENT_MISMATCH", "UDP echo mismatch"));
        }
    }
    udp.close().map_err(platform_error)?;
    Ok(json!({
        "manifest": "redevplugin.manifest.v9", "fs": {"bytes": stat.size, "sha256": upload_sha256, "expected_sha256": EXPECTED_SHA256, "list": !page.entries.is_empty(), "stat": stat.size == BYTES as u64, "rename": true, "watch": event.sequence > 0, "remove": true},
        "http": {"download_bytes": download_bytes, "upload_bytes": uploaded_bytes, "sha256": upload_sha256, "request_bytes": HTTP_SEGMENT, "requests_per_direction": BYTES / HTTP_SEGMENT, "upload_limit_enforced": upload_limit, "download_limit_enforced": true}, "websocket": {"messages": 100}, "tcp": {"exchanges": 100}, "udp": {"datagrams": 100}
    }))
}

fn hold(params: Value) -> WorkerResult {
    let (http_port, ws_port, tcp_port, _) = server(&params)?;
    let body = http::RequestBody::begin(http::HttpRequest {
        connector_id: "smoke.http".into(),
        method: "GET".into(),
        url: format!("http://127.0.0.1:{http_port}/hold"),
        headers: vec![],
        redirect: http::RedirectMode::Follow,
        timeout_ms: Some(300_000),
    })
    .map_err(platform_error)?;
    let response = body.finish().map_err(platform_error)?;
    let mut ws = websocket::WebSocket::open(websocket::WebSocketOpen {
        connector_id: "smoke.ws".into(),
        url: format!("ws://127.0.0.1:{ws_port}/ws"),
        headers: vec![],
        subprotocols: vec![],
        timeout_ms: Some(300_000),
    })
    .map_err(platform_error)?;
    let mut tcp = tcp::TcpStream::connect(tcp::TcpConnect {
        connector_id: "smoke.tcp".into(),
        host: "127.0.0.1".into(),
        port: tcp_port,
        timeout_ms: Some(300_000),
        no_delay: true,
        keep_alive_ms: None,
    })
    .map_err(platform_error)?;
    let mut hold_body = response.body;
    let _ = (&mut ws, &mut tcp);
    loop {
        let _ = hold_body.read(CHUNK).map_err(platform_error)?;
    }
}

fn handle(request: WorkerRequest) -> WorkerResult {
    match request.method.as_str() {
        "smoke.run" => run(request.params),
        "smoke.hold" => hold(request.params),
        _ => Err(WorkerError::invalid_request("unsupported I/O smoke method")),
    }
}
export_worker!(handle);
