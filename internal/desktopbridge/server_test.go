package desktopbridge

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/url"
	"os/exec"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"golang.org/x/net/http2"
)

type bridgeHTTP2Client struct {
	conn   net.Conn
	client *http2.ClientConn
	cancel context.CancelFunc
	done   chan error
}

func newBridgeHTTP2Client(t *testing.T, server Server) *bridgeHTTP2Client {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	clientConn, serverConn := net.Pipe()
	done := make(chan error, 1)
	go func() {
		done <- server.Serve(ctx, serverConn, serverConn)
	}()
	transport := &http2.Transport{}
	client, err := transport.NewClientConn(clientConn)
	if err != nil {
		cancel()
		_ = clientConn.Close()
		t.Fatalf("NewClientConn() error = %v", err)
	}
	harness := &bridgeHTTP2Client{conn: clientConn, client: client, cancel: cancel, done: done}
	t.Cleanup(func() {
		client.Close()
		cancel()
		_ = clientConn.Close()
		select {
		case <-done:
		case <-time.After(time.Second):
			t.Error("bridge HTTP/2 server did not stop")
		}
	})
	return harness
}

func bridgeRequest(method, authority, path string, body io.ReadCloser) *http.Request {
	if body == nil {
		body = http.NoBody
	}
	return &http.Request{
		Method: method,
		URL: &url.URL{
			Scheme: "http",
			Host:   authority,
			Path:   path,
		},
		Host:   authority,
		Body:   body,
		Header: make(http.Header),
	}
}

func openSurface(t *testing.T, client *http2.ClientConn, surface StreamSurface) (*io.PipeWriter, *http.Response) {
	t.Helper()
	reader, writer := io.Pipe()
	response, err := client.RoundTrip(bridgeRequest(http.MethodConnect, surface.Authority(), "", reader))
	if err != nil {
		_ = writer.Close()
		t.Fatalf("CONNECT %s error = %v", surface, err)
	}
	if response.StatusCode != http.StatusOK {
		_ = writer.Close()
		_ = response.Body.Close()
		t.Fatalf("CONNECT %s status = %d, want 200", surface, response.StatusCode)
	}
	return writer, response
}

func TestServerServesHelloOverHTTP2(t *testing.T) {
	bridge := newBridgeHTTP2Client(t, Server{Hello: Hello{
		RuntimeVersion: "v0.0.0-test",
		LocalUI:        HelloLocalUI{Available: true, BasePath: "/"},
	}})

	response, err := bridge.client.RoundTrip(bridgeRequest(http.MethodGet, BridgeAuthority, HelloPath, nil))
	if err != nil {
		t.Fatalf("hello request error = %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("hello status = %d, want 200", response.StatusCode)
	}
	var hello Hello
	if err := json.NewDecoder(response.Body).Decode(&hello); err != nil {
		t.Fatalf("decode hello: %v", err)
	}
	if hello.ProtocolVersion != ProtocolVersion || hello.RuntimeVersion != "v0.0.0-test" {
		t.Fatalf("hello = %#v", hello)
	}
}

func TestGoServerInteroperatesWithNodeHTTP2OverStdio(t *testing.T) {
	nodePath, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	script := `
const http2 = require('node:http2');
const { Duplex } = require('node:stream');
const connection = Duplex.from({ readable: process.stdin, writable: process.stdout });
const session = http2.connect('http://redeven-placement', { createConnection: () => connection });
function fail(error) { console.error(error && error.stack || error); session.destroy(); process.exitCode = 1; }
session.once('error', fail);
const hello = session.request({ ':method': 'GET', ':scheme': 'http', ':authority': 'redeven-placement', ':path': '/redeven/placement/v1/hello' });
const helloChunks = [];
hello.on('data', chunk => helloChunks.push(chunk));
hello.once('error', fail);
hello.once('end', () => {
  const payload = JSON.parse(Buffer.concat(helloChunks));
  if (payload.protocol_version !== 'redeven-desktop-placement-h2/1') return fail(new Error('bad hello'));
  const stream = session.request({ ':method': 'CONNECT', ':authority': 'local-ui' }, { endStream: false });
  const chunks = [];
  stream.once('response', headers => {
    if (headers[':status'] !== 200) return fail(new Error('CONNECT failed'));
    stream.end('ping');
  });
  stream.on('data', chunk => chunks.push(chunk));
  stream.once('error', fail);
  stream.once('end', () => {
    if (Buffer.concat(chunks).toString() !== 'pong') return fail(new Error('bad response'));
    session.destroy();
  });
});
`
	command := exec.CommandContext(ctx, nodePath, "-e", script)
	serverInput, err := command.StdoutPipe()
	if err != nil {
		t.Fatalf("Node stdout pipe: %v", err)
	}
	serverOutput, err := command.StdinPipe()
	if err != nil {
		t.Fatalf("Node stdin pipe: %v", err)
	}
	var stderr bytes.Buffer
	command.Stderr = &stderr
	if err := command.Start(); err != nil {
		t.Fatalf("start Node client: %v", err)
	}
	serverDone := make(chan error, 1)
	go func() {
		serverDone <- (&Server{
			Hello: Hello{RuntimeVersion: "v0.12.0-test"},
			DialSurface: func(context.Context, StreamSurface) (net.Conn, error) {
				bridgeSide, serviceSide := net.Pipe()
				go func() {
					defer serviceSide.Close()
					buffer := make([]byte, 4)
					_, _ = io.ReadFull(serviceSide, buffer)
					if string(buffer) == "ping" {
						_, _ = serviceSide.Write([]byte("pong"))
					}
				}()
				return bridgeSide, nil
			},
		}).Serve(ctx, serverInput, serverOutput)
	}()
	if err := command.Wait(); err != nil {
		t.Fatalf("Node HTTP/2 client error = %v; stderr=%s", err, stderr.String())
	}
	select {
	case <-serverDone:
	case <-ctx.Done():
		t.Fatalf("Go stdio server did not stop: %v", ctx.Err())
	}
}

func TestServerCONNECTCopiesBytesBothDirectionsAndHalfCloses(t *testing.T) {
	requestReceived := make(chan string, 1)
	bridge := newBridgeHTTP2Client(t, Server{DialSurface: func(_ context.Context, surface StreamSurface) (net.Conn, error) {
		if surface != StreamSurfaceLocalUI {
			t.Errorf("surface = %q, want local_ui", surface)
		}
		bridgeSide, serviceSide := net.Pipe()
		go func() {
			defer serviceSide.Close()
			buffer := make([]byte, len("request"))
			_, _ = io.ReadFull(serviceSide, buffer)
			requestReceived <- string(buffer)
			_, _ = serviceSide.Write([]byte("response"))
		}()
		return bridgeSide, nil
	}})

	requestBody, response := openSurface(t, bridge.client, StreamSurfaceLocalUI)
	if _, err := requestBody.Write([]byte("request")); err != nil {
		t.Fatalf("write request: %v", err)
	}
	if err := requestBody.Close(); err != nil {
		t.Fatalf("half-close request: %v", err)
	}
	responseBody, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("read response: %v", err)
	}
	_ = response.Body.Close()
	if string(responseBody) != "response" {
		t.Fatalf("response = %q, want response", responseBody)
	}
	if got := <-requestReceived; got != "request" {
		t.Fatalf("request = %q, want request", got)
	}
}

func TestBlockedStreamDoesNotBlockAnotherStream(t *testing.T) {
	blockedRelease := make(chan struct{})
	bridge := newBridgeHTTP2Client(t, Server{DialSurface: func(_ context.Context, surface StreamSurface) (net.Conn, error) {
		bridgeSide, serviceSide := net.Pipe()
		switch surface {
		case StreamSurfaceLocalUI:
			go func() {
				<-blockedRelease
				_ = serviceSide.Close()
			}()
		case StreamSurfaceRuntimeControl:
			go func() {
				defer serviceSide.Close()
				buffer := make([]byte, 4)
				_, _ = io.ReadFull(serviceSide, buffer)
				_, _ = serviceSide.Write([]byte("pong"))
			}()
		}
		return bridgeSide, nil
	}})

	blockedWriter, blockedResponse := openSurface(t, bridge.client, StreamSurfaceLocalUI)
	blockedWrite := make(chan error, 1)
	go func() {
		_, err := blockedWriter.Write(bytes.Repeat([]byte("a"), 2<<20))
		blockedWrite <- err
	}()
	select {
	case err := <-blockedWrite:
		t.Fatalf("blocked stream write completed early: %v", err)
	case <-time.After(50 * time.Millisecond):
	}

	fastWriter, fastResponse := openSurface(t, bridge.client, StreamSurfaceRuntimeControl)
	if _, err := fastWriter.Write([]byte("ping")); err != nil {
		t.Fatalf("write fast stream: %v", err)
	}
	_ = fastWriter.Close()
	fastBody, err := io.ReadAll(fastResponse.Body)
	if err != nil || string(fastBody) != "pong" {
		t.Fatalf("fast response = %q, %v; want pong", fastBody, err)
	}
	_ = fastResponse.Body.Close()

	close(blockedRelease)
	_ = blockedWriter.Close()
	_ = blockedResponse.Body.Close()
	select {
	case <-blockedWrite:
	case <-time.After(time.Second):
		t.Fatal("blocked stream did not release")
	}
}

func TestServerLimitsConcurrentStreamsTo64(t *testing.T) {
	var active atomic.Int32
	var maximum atomic.Int32
	release := make(chan struct{})
	var once sync.Once
	bridge := newBridgeHTTP2Client(t, Server{DialSurface: func(context.Context, StreamSurface) (net.Conn, error) {
		current := active.Add(1)
		for {
			previous := maximum.Load()
			if current <= previous || maximum.CompareAndSwap(previous, current) {
				break
			}
		}
		bridgeSide, serviceSide := net.Pipe()
		go func() {
			<-release
			_ = serviceSide.Close()
			active.Add(-1)
		}()
		return bridgeSide, nil
	}})

	writers := make([]*io.PipeWriter, 0, MaxConcurrentStreams)
	responses := make([]*http.Response, 0, MaxConcurrentStreams)
	for index := 0; index < MaxConcurrentStreams; index++ {
		writer, response := openSurface(t, bridge.client, StreamSurfaceLocalUI)
		writers = append(writers, writer)
		responses = append(responses, response)
	}
	opened65 := make(chan error, 1)
	go func() {
		reader, writer := io.Pipe()
		response, err := bridge.client.RoundTrip(bridgeRequest(http.MethodConnect, StreamSurfaceLocalUI.Authority(), "", reader))
		if err == nil {
			_ = response.Body.Close()
		}
		_ = writer.Close()
		opened65 <- err
	}()
	rejected65 := false
	select {
	case err := <-opened65:
		if err == nil {
			t.Fatal("65th stream opened while 64 streams were active")
		}
		rejected65 = true
	case <-time.After(50 * time.Millisecond):
	}
	if got := maximum.Load(); got != MaxConcurrentStreams {
		t.Fatalf("maximum concurrent streams = %d, want %d", got, MaxConcurrentStreams)
	}
	once.Do(func() { close(release) })
	for _, writer := range writers {
		_ = writer.Close()
	}
	for _, response := range responses {
		_ = response.Body.Close()
	}
	if !rejected65 {
		select {
		case <-opened65:
		case <-time.After(time.Second):
			t.Fatal("queued 65th stream did not finish after capacity was released")
		}
	}
}

func TestServerRejectsUnknownSurfaceWithoutClosingSession(t *testing.T) {
	bridge := newBridgeHTTP2Client(t, Server{})
	reader, writer := io.Pipe()
	response, err := bridge.client.RoundTrip(bridgeRequest(http.MethodConnect, "unknown", "", reader))
	if err != nil {
		t.Fatalf("unknown CONNECT error = %v", err)
	}
	_ = writer.Close()
	_ = response.Body.Close()
	if response.StatusCode != http.StatusNotFound || response.Header.Get(ErrorCodeHeader) != ErrorSurfaceUnavailable {
		t.Fatalf("unknown CONNECT status=%d code=%q", response.StatusCode, response.Header.Get(ErrorCodeHeader))
	}

	hello, err := bridge.client.RoundTrip(bridgeRequest(http.MethodGet, BridgeAuthority, HelloPath, nil))
	if err != nil {
		t.Fatalf("session failed after stream rejection: %v", err)
	}
	_ = hello.Body.Close()
}

func TestServerShutdownRequestUsesSameHTTP2Session(t *testing.T) {
	shutdownCalled := make(chan struct{}, 1)
	bridge := newBridgeHTTP2Client(t, Server{OnShutdown: func() { shutdownCalled <- struct{}{} }})
	response, err := bridge.client.RoundTrip(bridgeRequest(http.MethodPost, BridgeAuthority, ShutdownRuntimePath, nil))
	if err != nil {
		t.Fatalf("shutdown request error = %v", err)
	}
	_ = response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("shutdown status = %d, want 204", response.StatusCode)
	}
	select {
	case <-shutdownCalled:
	case <-time.After(time.Second):
		t.Fatal("shutdown callback was not called")
	}
}

func TestGatewayProtocolHeaderConnLimitsOnlyHTTPHeadersWhenFirstWriteIncludesLargeBody(t *testing.T) {
	clientConn, serverConn := net.Pipe()
	defer clientConn.Close()
	defer serverConn.Close()
	wrapped := &gatewayProtocolHeaderConn{Conn: clientConn, token: "managed-token"}
	header := []byte("PUT /gateway/v2/runtime-operations/op/artifact HTTP/1.1\r\nHost: gateway.local\r\n\r\n")
	body := bytes.Repeat([]byte{0x5a}, 128*1024)
	request := append(append([]byte(nil), header...), body...)
	injectedHeader := []byte("X-Redeven-Gateway-Managed-Bridge-Token: managed-token\r\n")
	expectedBytes := len(request) + len(injectedHeader)

	writeDone := make(chan error, 1)
	readDone := make(chan []byte, 1)
	go func() {
		buffer := make([]byte, expectedBytes)
		_, err := io.ReadFull(serverConn, buffer)
		if err != nil {
			readDone <- nil
			return
		}
		readDone <- buffer
	}()
	go func() {
		n, err := wrapped.Write(request)
		if err == nil && n != len(request) {
			err = io.ErrShortWrite
		}
		writeDone <- err
	}()
	if err := <-writeDone; err != nil {
		t.Fatalf("large first gateway write error = %v", err)
	}
	forwarded := <-readDone
	if !bytes.Contains(forwarded[:len(header)+len(injectedHeader)], injectedHeader) {
		t.Fatal("managed bridge token was not injected into the bounded HTTP header")
	}
	if !bytes.Equal(forwarded[len(forwarded)-len(body):], body) {
		t.Fatal("large Runtime lifecycle request body changed while injecting the managed bridge token")
	}
}

func TestTrustedLoopbackAddrFromURL(t *testing.T) {
	t.Parallel()

	for _, test := range []struct {
		name    string
		raw     string
		want    string
		wantErr bool
	}{
		{name: "ipv4", raw: "http://127.0.0.1:23998/", want: "127.0.0.1:23998"},
		{name: "ipv6", raw: "http://[::1]:23998/", want: "[::1]:23998"},
		{name: "missing", raw: "", wantErr: true},
		{name: "hostname", raw: "http://localhost:23998/", wantErr: true},
		{name: "non loopback", raw: "http://192.0.2.10:23998/", wantErr: true},
		{name: "missing port", raw: "http://127.0.0.1/", wantErr: true},
		{name: "invalid port", raw: "http://127.0.0.1:notaport/", wantErr: true},
		{name: "zero port", raw: "http://127.0.0.1:0/", wantErr: true},
		{name: "mapped ipv4", raw: "http://[::ffff:127.0.0.1]:23998/", wantErr: true},
		{name: "credentials", raw: "http://user@127.0.0.1:23998/", wantErr: true},
		{name: "path", raw: "http://127.0.0.1:23998/api", wantErr: true},
		{name: "query", raw: "http://127.0.0.1:23998/?token=value", wantErr: true},
		{name: "https", raw: "https://127.0.0.1:23998/", wantErr: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, err := trustedLoopbackAddrFromURL(test.raw)
			if test.wantErr {
				if err == nil {
					t.Fatalf("trustedLoopbackAddrFromURL(%q) = %q, want error", test.raw, got)
				}
				return
			}
			if err != nil || got != test.want {
				t.Fatalf("trustedLoopbackAddrFromURL(%q) = %q, %v; want %q", test.raw, got, err, test.want)
			}
		})
	}
}
