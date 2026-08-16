use redevplugin_worker_sdk::{
    WorkerError, WorkerRequest, WorkerResult,
    error::{Error as PlatformError, ErrorCode},
    export_worker, fs, http, tcp, udp, websocket,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

const BYTES: usize = 64 * 1024 * 1024;
const CHUNK: usize = 64 * 1024;

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
    let mut expected = Sha256::new();
    for _ in 0..(BYTES / CHUNK) {
        file.write_all(&source).map_err(platform_error)?;
        expected.update(&source);
    }
    file.sync().map_err(platform_error)?;
    file.close().map_err(platform_error)?;
    let stat = fs::stat(uri, true).map_err(platform_error)?;
    let read = fs::read_file(uri).map_err(platform_error)?;
    let mut actual = Sha256::new();
    actual.update(&read);
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
    fs::remove(uri, false).map_err(platform_error)?;

    let mut upload = http::RequestBody::begin(http::HttpRequest {
        method: "POST".into(),
        url: format!("http://127.0.0.1:{http_port}/upload"),
        headers: vec![],
        redirect: http::RedirectMode::Follow,
        timeout_ms: Some(180_000),
    })
    .map_err(platform_error)?;
    for _ in 0..(BYTES / CHUNK) {
        upload.write_all(&source).map_err(platform_error)?;
    }
    let upload_response = upload.finish().map_err(platform_error)?;
    let upload_body = upload_response.body.read_all().map_err(platform_error)?;
    let upload_result: Value = serde_json::from_slice(&upload_body)
        .map_err(|error| WorkerError::new("SMOKE_RESPONSE_INVALID", error.to_string()))?;
    let download = http::RequestBody::begin(http::HttpRequest {
        method: "GET".into(),
        url: format!("http://127.0.0.1:{http_port}/download"),
        headers: vec![],
        redirect: http::RedirectMode::Follow,
        timeout_ms: Some(180_000),
    })
    .map_err(platform_error)?;
    let download_response = download.finish().map_err(platform_error)?;
    let download_body = download_response.body.read_all().map_err(platform_error)?;

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
        "manifest": "redevplugin.manifest.v9", "fs": {"bytes": stat.size, "sha256": format!("{:x}", actual.finalize()), "expected_sha256": format!("{:x}", expected.finalize()), "list": !page.entries.is_empty(), "stat": stat.size == BYTES as u64, "rename": true, "watch": event.sequence > 0, "remove": true},
        "http": {"download_bytes": download_body.len(), "upload_bytes": upload_result.get("bytes").and_then(Value::as_u64), "sha256": upload_result.get("sha256").and_then(Value::as_str)}, "websocket": {"messages": 100}, "tcp": {"exchanges": 100}, "udp": {"datagrams": 100}
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
