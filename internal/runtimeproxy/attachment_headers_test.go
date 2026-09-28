package runtimeproxy

import (
	"context"
	"encoding/binary"
	"encoding/json"
	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestNativeAttachmentHeadersCrossProductProxy(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		expected := map[string]string{
			"Upload-Staging-Scope-ID": "scope-test", "Upload-Staging-Capability": "cap-test",
			"Upload-Content-Length": "2", "Upload-Content-SHA256": "content-test",
			"Upload-Display-Name-SHA256": "name-test", "Idempotency-Key": "request-test",
		}
		for name, value := range expected {
			if r.Header.Get(name) != value {
				t.Errorf("lost %s", name)
			}
		}
		for _, name := range []string{"Authorization", "X-Unrelated-Secret"} {
			if r.Header.Get(name) != "" {
				t.Errorf("forwarded unrelated header %s", name)
			}
		}
		w.Header().Set("Upload-Staging-Capability", "response-cap-test")
		w.Header().Set("X-Unrelated-Secret", "secret")
		_, _ = io.WriteString(w, `{}`)
	}))
	defer upstream.Close()
	status, headers := proxyAttachmentRequest(t, Options{
		Upstream: upstream.URL, UpstreamOrigin: "https://env.example.test", ExtraRequestHeaders: EnvAppRequestHeaders(), ExtraResponseHeaders: EnvAppResponseHeaders(),
	})
	if status != http.StatusOK || headers["upload-staging-capability"] != "response-cap-test" {
		t.Fatalf("attachment capability was not delivered: status=%d headers=%v", status, headers)
	}
	if headers["x-unrelated-secret"] != "" {
		t.Fatal("unrelated response header crossed proxy")
	}
}

type attachmentProxyStream struct{ net.Conn }

func (*attachmentProxyStream) Kind() string                           { return "flowersec-proxy/http1" }
func (*attachmentProxyStream) TerminalError() *flowersec.SessionError { return nil }
func (s *attachmentProxyStream) CloseWrite() error                    { return s.Close() }
func (s *attachmentProxyStream) Reset() error                         { return s.Close() }

type attachmentProxySession struct {
	flowersec.Session
	incoming chan flowersec.IncomingStream
}

func (s *attachmentProxySession) AcceptStream(ctx context.Context) (flowersec.IncomingStream, error) {
	select {
	case incoming := <-s.incoming:
		return incoming, nil
	case <-ctx.Done():
		return flowersec.IncomingStream{}, ctx.Err()
	}
}
func (*attachmentProxySession) Close() error { return nil }

func proxyAttachmentRequest(t *testing.T, options Options) (int, map[string]string) {
	t.Helper()
	handlers, err := flowersec.NewStreamHandlers(flowersec.StreamHandlerOptions{})
	if err != nil {
		t.Fatal(err)
	}
	proxy, err := RegisterStreamHandlers(handlers, options)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = proxy.Close() })
	client, server := net.Pipe()
	defer client.Close()
	defer server.Close()
	if err := client.SetDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatal(err)
	}
	sess := &attachmentProxySession{incoming: make(chan flowersec.IncomingStream, 1)}
	sess.incoming <- flowersec.IncomingStream{
		Kind: "flowersec-proxy/http1", Metadata: flowersec.EmptyStreamMetadata(), Stream: &attachmentProxyStream{server},
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- handlers.Serve(ctx, sess) }()
	defer func() {
		_ = client.Close()
		cancel()
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			t.Error("proxy handler did not stop")
		}
	}()
	metadata, err := json.Marshal(map[string]any{
		"v": 1, "request_id": "plugin-startup", "method": "POST",
		"path": "/_redeven_proxy/api/ai/uploads",
		"headers": []map[string]string{
			{"name": "content-type", "value": "application/json"},

			{"name": "Upload-Staging-Scope-ID", "value": "scope-test"},
			{"name": "Upload-Staging-Capability", "value": "cap-test"},
			{"name": "Upload-Content-Length", "value": "2"},
			{"name": "Upload-Content-SHA256", "value": "content-test"},
			{"name": "Upload-Display-Name-SHA256", "value": "name-test"},
			{"name": "Idempotency-Key", "value": "request-test"},
			{"name": "Authorization", "value": "untrusted"},
			{"name": "X-Unrelated-Secret", "value": "untrusted"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, chunk := range [][]byte{metadata, []byte(`{}`), nil} {
		if err := binary.Write(client, binary.BigEndian, uint32(len(chunk))); err != nil {
			t.Fatal(err)
		}
		if len(chunk) > 0 {
			if _, err := client.Write(chunk); err != nil {
				t.Fatal(err)
			}
		}
	}
	readChunk := func() []byte {
		var size uint32
		if err := binary.Read(client, binary.BigEndian, &size); err != nil {
			t.Fatal(err)
		}
		if size > 1<<20 {
			t.Fatalf("oversized proxy response: %d", size)
		}
		chunk := make([]byte, size)
		if _, err := io.ReadFull(client, chunk); err != nil {
			t.Fatal(err)
		}
		return chunk
	}
	var response struct {
		OK      bool `json:"ok"`
		Status  int  `json:"status"`
		Headers []struct {
			Name  string `json:"name"`
			Value string `json:"value"`
		} `json:"headers"`
	}
	if err := json.Unmarshal(readChunk(), &response); err != nil {
		t.Fatal(err)
	}
	if !response.OK {
		t.Fatalf("proxy transport failed: %+v", response)
	}
	var body []byte
	for {
		chunk := readChunk()
		if len(chunk) == 0 {
			break
		}
		body = append(body, chunk...)
	}
	if string(body) != `{}` {
		t.Fatalf("unexpected proxy response body: %q", body)
	}
	headers := map[string]string{}
	for _, header := range response.Headers {
		headers[strings.ToLower(header.Name)] = header.Value
	}
	return response.Status, headers
}
