package desktopbridge

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"testing"
	"time"
)

func TestServerWritesHelloBeforeReadingClientFrames(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	inReader, inWriter := io.Pipe()
	defer inWriter.Close()
	defer inReader.Close()
	var out bytes.Buffer
	server := Server{
		Hello: Hello{
			RuntimeVersion: "v0.0.0-test",
			LocalUI:        HelloLocalUI{Available: true, BasePath: "/"},
		},
	}

	done := make(chan error, 1)
	go func() {
		done <- server.Serve(ctx, inReader, &out)
	}()

	deadline := time.Now().Add(time.Second)
	for out.Len() == 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	cancel()
	_ = inWriter.Close()
	if err := <-done; err != nil && !errors.Is(err, context.Canceled) {
		t.Fatalf("Serve error: %v", err)
	}

	header, payload, err := ReadFrame(bytes.NewReader(out.Bytes()))
	if err != nil {
		t.Fatalf("ReadFrame hello error: %v", err)
	}
	if header.Type != FrameTypeHello {
		t.Fatalf("first frame type=%q, want %q", header.Type, FrameTypeHello)
	}
	var hello Hello
	if err := json.Unmarshal(payload, &hello); err != nil {
		t.Fatalf("hello json: %v", err)
	}
	if hello.ProtocolVersion != ProtocolVersion {
		t.Fatalf("hello protocol=%q, want %q", hello.ProtocolVersion, ProtocolVersion)
	}
}

func TestServerRoutesStreamOpenAndDataThroughSurfaceConn(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	streamID := "local-ui-1"
	openPayload, err := json.Marshal(StreamOpen{Surface: StreamSurfaceLocalUI})
	if err != nil {
		t.Fatalf("marshal stream open: %v", err)
	}

	clientConn, serverConn := net.Pipe()
	defer clientConn.Close()
	defer serverConn.Close()
	dialed := make(chan struct{}, 1)
	received := make(chan string, 1)
	server := Server{
		DialSurface: func(context.Context, StreamSurface) (net.Conn, error) {
			dialed <- struct{}{}
			go func() {
				buf := make([]byte, 128)
				n, _ := serverConn.Read(buf)
				received <- string(buf[:n])
				_, _ = serverConn.Write([]byte("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n"))
				_ = serverConn.Close()
			}()
			return clientConn, nil
		},
		Hello: Hello{
			RuntimeVersion: "v0.0.0-test",
			LocalUI:        HelloLocalUI{Available: true, BasePath: "/"},
		},
	}

	bridgeInReader, bridgeInWriter := io.Pipe()
	defer bridgeInReader.Close()
	defer bridgeInWriter.Close()
	bridgeOutReader, bridgeOutWriter := io.Pipe()
	defer bridgeOutReader.Close()
	defer bridgeOutWriter.Close()
	done := make(chan error, 1)
	go func() {
		done <- server.Serve(ctx, bridgeInReader, bridgeOutWriter)
	}()

	select {
	case <-dialed:
	default:
	}
	header, _, err := ReadFrame(bridgeOutReader)
	if err != nil {
		t.Fatalf("read hello: %v", err)
	}
	if header.Type != FrameTypeHello {
		t.Fatalf("first frame=%q, want hello", header.Type)
	}

	go func() {
		_ = WriteFrame(bridgeInWriter, FrameHeader{StreamID: streamID, Type: FrameTypeStreamOpen}, openPayload)
		_ = WriteFrame(bridgeInWriter, FrameHeader{StreamID: streamID, Type: FrameTypeStreamData}, []byte("GET / HTTP/1.1\r\n\r\n"))
	}()

	select {
	case <-dialed:
	case <-time.After(time.Second):
		t.Fatal("surface was not dialed")
	}
	select {
	case got := <-received:
		if got != "GET / HTTP/1.1\r\n\r\n" {
			t.Fatalf("surface received %q", got)
		}
	case <-time.After(time.Second):
		t.Fatal("surface did not receive bridge data")
	}

	header, payload, err := ReadFrame(bridgeOutReader)
	if err != nil {
		t.Fatalf("read stream data: %v", err)
	}
	if header.Type != FrameTypeStreamData {
		t.Fatalf("second frame=%q, want stream_data", header.Type)
	}
	if !bytes.Contains(payload, []byte("200 OK")) {
		t.Fatalf("bridge payload=%q, want HTTP response", payload)
	}

	cancel()
	_ = bridgeInWriter.Close()
	if err := <-done; err != nil && !errors.Is(err, context.Canceled) {
		t.Fatalf("Serve error: %v", err)
	}
}

func TestServerShutdownFrameEndsBridgeContext(t *testing.T) {
	inReader, inWriter := io.Pipe()
	defer inReader.Close()
	defer inWriter.Close()
	bridgeOutReader, bridgeOutWriter := io.Pipe()
	defer bridgeOutReader.Close()
	defer bridgeOutWriter.Close()
	shutdownCalled := make(chan struct{}, 1)
	server := Server{
		Hello: Hello{
			RuntimeVersion: "v0.0.0-test",
			LocalUI:        HelloLocalUI{Available: true, BasePath: "/"},
		},
		OnShutdown: func() {
			shutdownCalled <- struct{}{}
		},
	}

	done := make(chan error, 1)
	go func() {
		done <- server.Serve(context.Background(), inReader, bridgeOutWriter)
	}()

	header, _, err := ReadFrame(bridgeOutReader)
	if err != nil {
		t.Fatalf("read hello: %v", err)
	}
	if header.Type != FrameTypeHello {
		t.Fatalf("first frame=%q, want hello", header.Type)
	}

	if err := WriteFrame(inWriter, FrameHeader{Type: FrameTypeShutdownRuntime}, nil); err != nil {
		t.Fatalf("write shutdown: %v", err)
	}
	select {
	case <-shutdownCalled:
	case <-time.After(time.Second):
		t.Fatal("shutdown callback was not called")
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Serve shutdown error: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("bridge did not stop after shutdown frame")
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
			if err != nil {
				t.Fatalf("trustedLoopbackAddrFromURL(%q) error = %v", test.raw, err)
			}
			if got != test.want {
				t.Fatalf("trustedLoopbackAddrFromURL(%q) = %q, want %q", test.raw, got, test.want)
			}
		})
	}
}
