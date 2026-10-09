package agent

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"io"
	"log/slog"
	"net"
	"net/http"
	"path/filepath"
	"testing"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
	"github.com/floegence/redeven/internal/codeapp"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/sessionhop"
	"github.com/floegence/redeven/internal/testutil/redevpluginruntime"
)

func TestRemoteEnvSessionProxyUsesBrowserOriginAndTrustedChannel(t *testing.T) {
	root := t.TempDir()
	cleanup, err := redevpluginruntime.InstallAt(root)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := cleanup(); err != nil {
			t.Error(err)
		}
	})
	meta := &session.Meta{
		ChannelID: "ch_origin_binding", EndpointID: "env_origin", FloeApp: FloeAppRedevenAgent,
		CodeSpaceID: "env-ui", SessionKind: "envapp_rpc", UserPublicID: "user_origin",
		CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true,
	}
	resolve := func(id string) (*session.Meta, bool) { return meta, id == meta.ChannelID }
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	svc, err := codeapp.New(t.Context(), codeapp.Options{
		Logger: logger, StateDir: filepath.Join(root, "state"), StateRoot: root, AgentHomeDir: root,
		ConfigPath: filepath.Join(root, "config.json"), Shell: "/bin/sh",
		AccessPointOrigin:      "https://dev.redeven.test:45443",
		PermissionPolicy:       defaultPermissionPolicyForAgentTest(t),
		ReDevPluginRuntimePath: filepath.Join(root, "redevplugin-runtime"),
		ResolveSessionMeta:     resolve, ResolvePluginSessionMeta: resolve,
		AcquirePluginSession: func(id string) (*session.Meta, func(), bool) { return meta, func() {}, id == meta.ChannelID },
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := svc.Close(); err != nil {
			t.Error(err)
		}
	})
	a := &Agent{cfg: &config.Config{EnvironmentID: meta.EndpointID}, code: svc, log: logger}
	origin, err := svc.ExternalOriginForEnvApp(meta.EndpointID)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, origin, csrf string
		transportOK        bool
		status             int
	}{
		{"authorized", origin, "redeven-env-v1", true, http.StatusOK},
		{"invalid_csrf", origin, "invalid", true, http.StatusForbidden},
		{"foreign_origin", "https://foreign.example", "redeven-env-v1", false, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			handlers, err := flowersec.NewStreamHandlers(flowersec.StreamHandlerOptions{})
			if err != nil {
				t.Fatal(err)
			}
			client, server := net.Pipe()
			defer client.Close()
			defer server.Close()
			if err := client.SetDeadline(time.Now().Add(5 * time.Second)); err != nil {
				t.Fatal(err)
			}
			sess := &envProxySession{incoming: make(chan flowersec.IncomingStream, 1)}
			sess.incoming <- flowersec.IncomingStream{Kind: "flowersec-proxy/http1", Metadata: flowersec.EmptyStreamMetadata(), Stream: &envProxyStream{server}}
			ctx, cancel := context.WithCancel(t.Context())
			done := make(chan error, 1)
			go func() { done <- a.serveRedevenAgentSession(ctx, sess, meta, &remoteSessionPlan{streams: handlers}) }()
			defer func() {
				_ = client.Close()
				cancel()
				select {
				case <-done:
				case <-time.After(5 * time.Second):
					t.Error("Env proxy did not stop")
				}
			}()
			metadata, err := json.Marshal(map[string]any{
				"v": 1, "request_id": "origin-binding", "method": "POST", "path": "/_redevplugin/api/plugins/catalog/query",
				"external_origin": tc.origin,
				"headers": []map[string]string{
					{"name": "Content-Type", "value": "application/json"},
					{"name": "X-ReDevPlugin-CSRF", "value": tc.csrf},
					// A browser cannot replace the identity on the trusted local hop.
					{"name": sessionhop.HeaderChannelID, "value": "ch_forged"},
				},
			})
			if err != nil {
				t.Fatal(err)
			}
			writerDone := make(chan struct{})
			go func() {
				defer close(writerDone)
				for _, chunk := range [][]byte{metadata, []byte(`{}`), nil} {
					if err := binary.Write(client, binary.BigEndian, uint32(len(chunk))); err != nil {
						return
					}
					if len(chunk) > 0 {
						if _, err := client.Write(chunk); err != nil {
							return
						}
					}
				}
			}()
			defer func() { _ = client.Close(); <-writerDone }()
			read := func() []byte {
				var size uint32
				if err := binary.Read(client, binary.BigEndian, &size); err != nil {
					t.Fatal(err)
				}
				if size > 1<<20 {
					t.Fatal("oversized proxy response")
				}
				b := make([]byte, size)
				if _, err := io.ReadFull(client, b); err != nil {
					t.Fatal(err)
				}
				return b
			}
			var response struct {
				OK     bool `json:"ok"`
				Status int  `json:"status"`
			}
			if err := json.Unmarshal(read(), &response); err != nil {
				t.Fatal(err)
			}
			if response.OK != tc.transportOK || response.Status != tc.status {
				t.Fatalf("proxy response = %+v, want transport=%v status=%d", response, tc.transportOK, tc.status)
			}
			if !response.OK {
				return
			}
			var body []byte
			for {
				b := read()
				if len(b) == 0 {
					break
				}
				body = append(body, b...)
			}
			var result struct {
				OK    bool `json:"ok"`
				Error struct {
					Code string `json:"code"`
				} `json:"error"`
			}
			if err := json.Unmarshal(body, &result); err != nil {
				t.Fatalf("invalid plugin response: %s: %v", body, err)
			}
			if tc.status == http.StatusOK && !result.OK {
				t.Fatalf("plugin request failed: %s", body)
			}
			if tc.status == http.StatusForbidden && result.Error.Code != "PLUGIN_CSRF_INVALID" {
				t.Fatalf("wrong rejection: %s", body)
			}
		})
	}
}

type envProxyStream struct{ net.Conn }

func (*envProxyStream) Kind() string                           { return "flowersec-proxy/http1" }
func (*envProxyStream) TerminalError() *flowersec.SessionError { return nil }
func (s *envProxyStream) CloseWrite() error                    { return s.Close() }
func (s *envProxyStream) Reset() error                         { return s.Close() }

type envProxySession struct {
	flowersec.Session
	incoming chan flowersec.IncomingStream
}

func (s *envProxySession) AcceptStream(ctx context.Context) (flowersec.IncomingStream, error) {
	select {
	case incoming := <-s.incoming:
		return incoming, nil
	case <-ctx.Done():
		return flowersec.IncomingStream{}, ctx.Err()
	}
}
func (*envProxySession) Close() error { return nil }
