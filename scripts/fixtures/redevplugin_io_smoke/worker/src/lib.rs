use redevplugin_worker_sdk::{
    IO_FLAG_EOF, WorkerError, WorkerRequest, WorkerResult,
    error::{Error as PlatformError, ErrorCode},
    export_worker, fs, http, tcp, udp, websocket,
};
use serde_json::{Value, json};

const BYTES: usize = 64 * 1024 * 1024;
const CHUNK: usize = 64 * 1024;
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

fn validate_samples(chunk: &[u8], offset: usize) -> Result<(), WorkerError> {
    if chunk.is_empty() {
        return Ok(());
    }
    for index in [0, chunk.len() / 2, chunk.len() - 1] {
        let expected = (((offset + index) % CHUNK) % 251) as u8;
        if chunk[index] != expected {
            return Err(WorkerError::new(
                "SMOKE_CONTENT_MISMATCH",
                "streamed payload sample did not match deterministic content",
            ));
        }
    }
    Ok(())
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

    let mut upload = http::RequestBody::begin(http::HttpRequest {
        method: "POST".into(),
        url: format!("http://127.0.0.1:{http_port}/upload"),
        headers: vec![],
        redirect: http::RedirectMode::Follow,
        timeout_ms: Some(180_000),
    })
    .map_err(platform_error)?;
    let mut file = fs::File::open(
        uri,
        fs::OpenOptions {
            read: true,
            ..fs::OpenOptions::default()
        },
    )
    .map_err(platform_error)?;
    let mut uploaded_bytes = 0_usize;
    loop {
        let (chunk, flags) = file.read(CHUNK).map_err(platform_error)?;
        validate_samples(&chunk, uploaded_bytes)?;
        upload.write_all(&chunk).map_err(platform_error)?;
        uploaded_bytes += chunk.len();
        if flags & IO_FLAG_EOF != 0 {
            break;
        }
        if chunk.is_empty() {
            return Err(WorkerError::new(
                "SMOKE_STREAM_STALLED",
                "file stream made no progress",
            ));
        }
    }
    file.close().map_err(platform_error)?;
    let upload_response = upload.finish().map_err(platform_error)?;
    let upload_result = read_json_body(upload_response.body)?;
    let upload_sha256 = upload_result
        .get("sha256")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    if uploaded_bytes != BYTES || upload_sha256 != EXPECTED_SHA256 {
        return Err(WorkerError::new(
            "SMOKE_CONTENT_MISMATCH",
            "file-to-HTTP stream did not preserve the deterministic payload",
        ));
    }
    fs::remove(uri, false).map_err(platform_error)?;
    let download = http::RequestBody::begin(http::HttpRequest {
        method: "GET".into(),
        url: format!("http://127.0.0.1:{http_port}/download"),
        headers: vec![],
        redirect: http::RedirectMode::Follow,
        timeout_ms: Some(180_000),
    })
    .map_err(platform_error)?;
    let download_response = download.finish().map_err(platform_error)?;
    let mut download_body = download_response.body;
    let mut download_bytes = 0_usize;
    loop {
        let (chunk, flags) = download_body.read(CHUNK).map_err(platform_error)?;
        validate_samples(&chunk, download_bytes)?;
        download_bytes += chunk.len();
        if flags & IO_FLAG_EOF != 0 {
            download_body.close().map_err(platform_error)?;
            break;
        }
        if chunk.is_empty() {
            return Err(WorkerError::new(
                "SMOKE_STREAM_STALLED",
                "HTTP download stream made no progress",
            ));
        }
    }
    if download_bytes != BYTES {
        return Err(WorkerError::new(
            "SMOKE_CONTENT_MISMATCH",
            "HTTP download size did not match the deterministic payload",
        ));
    }

    let mut ws = websocket::WebSocket::open(websocket::WebSocketOpen {
        url: format!("ws://127.0.0.1:{ws_port}/ws"),
        headers: vec![],
        subprotocols: vec![],
        timeout_ms: Some(30_000),
    })
    .map_err(platform_error)?;
    for index in 0..100 {
        ws.send_text(&format!("message-{index}"))
            .map_err(platform_error)?;
        let _ = ws.receive().map_err(platform_error)?;
    }
    ws.close(1000, "done").map_err(platform_error)?;
    let mut tcp = tcp::TcpStream::connect(tcp::TcpConnect {
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
        let _ = tcp.read(1024).map_err(platform_error)?;
    }
    tcp.close().map_err(platform_error)?;
    let mut udp = udp::UdpSocket::connect(udp::UdpConnect {
        host: "127.0.0.1".into(),
        port: udp_port,
        timeout_ms: Some(30_000),
    })
    .map_err(platform_error)?;
    for index in 0..100 {
        udp.send(format!("udp-{index}").as_bytes())
            .map_err(platform_error)?;
        let _ = udp.receive().map_err(platform_error)?;
    }
    udp.close().map_err(platform_error)?;
    Ok(json!({
        "manifest": "redevplugin.manifest.v9", "fs": {"bytes": stat.size, "sha256": upload_sha256, "expected_sha256": EXPECTED_SHA256, "list": !page.entries.is_empty(), "stat": stat.size == BYTES as u64, "rename": true, "watch": event.sequence > 0, "remove": true},
        "http": {"download_bytes": download_bytes, "upload_bytes": upload_result.get("bytes").and_then(Value::as_u64), "sha256": upload_result.get("sha256").and_then(Value::as_str)}, "websocket": {"messages": 100}, "tcp": {"exchanges": 100}, "udp": {"datagrams": 100}
    }))
}

fn hold(params: Value) -> WorkerResult {
    let (http_port, ws_port, tcp_port, _) = server(&params)?;
    let body = http::RequestBody::begin(http::HttpRequest {
        method: "GET".into(),
        url: format!("http://127.0.0.1:{http_port}/hold"),
        headers: vec![],
        redirect: http::RedirectMode::Follow,
        timeout_ms: Some(300_000),
    })
    .map_err(platform_error)?;
    let response = body.finish().map_err(platform_error)?;
    let mut ws = websocket::WebSocket::open(websocket::WebSocketOpen {
        url: format!("ws://127.0.0.1:{ws_port}/ws"),
        headers: vec![],
        subprotocols: vec![],
        timeout_ms: Some(300_000),
    })
    .map_err(platform_error)?;
    let mut tcp = tcp::TcpStream::connect(tcp::TcpConnect {
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
