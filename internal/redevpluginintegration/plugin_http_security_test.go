package redevpluginintegration

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
	"github.com/floegence/redeven/internal/accessproxy"
	"github.com/floegence/redeven/internal/runtimeproxy"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/sessionhop"
)

func TestPluginStartupHTTPRoutesRequireAuthenticatedOriginAndCSRF(t *testing.T) {
	const channel = "plugin_startup_channel"
	const origin = "https://env.example.test"
	options := ownerScopeTestOptions(t, t.TempDir())
	options.PermissionPolicy = testPermissionPolicy(t, "execute_read_write")
	active := true
	options.ResolveSessionMeta = func(id string) (*session.Meta, bool) {
		return &session.Meta{
			ChannelID: channel, EndpointID: "env_startup", UserPublicID: "user_startup",
			FloeApp: "com.floegence.redeven.agent", CodeSpaceID: "env-ui",
			CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true,
		}, active && id == channel
	}
	integration, err := New(context.Background(), options)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := integration.Close(); err != nil {
			t.Error(err)
		}
	})

	for _, endpoint := range []string{"catalog/query", "runtime/recover-enabled"} {
		t.Run(endpoint, func(t *testing.T) {
			for _, tc := range []struct {
				name, requestOrigin, proof, channel string
				role                                RouteRole
				active, allowed                     bool
			}{
				{"authorized", origin, csrfProof, channel, RouteRoleEnvTrusted, true, true},
				{"missing_csrf", origin, "", channel, RouteRoleEnvTrusted, true, false},
				{"wrong_csrf", origin, "wrong", channel, RouteRoleEnvTrusted, true, false},
				{"wrong_origin", "https://foreign.example", csrfProof, channel, RouteRoleEnvTrusted, true, false},
				{"missing_session", origin, csrfProof, "", RouteRoleEnvTrusted, true, false},
				{"retired_session", origin, csrfProof, channel, RouteRoleEnvTrusted, false, false},
				{"untrusted_app", origin, csrfProof, channel, "", true, false},
			} {
				t.Run(tc.name, func(t *testing.T) {
					active = tc.active
					req := httptest.NewRequest(http.MethodPost, "/_redevplugin/api/plugins/"+endpoint, strings.NewReader(`{}`))
					req.Header.Set("Content-Type", "application/json")
					req.Header.Set("Origin", tc.requestOrigin)
					if tc.proof != "" {
						req.Header.Set(csrfHeader, tc.proof)
					}
					req.Header.Set(sessionhop.HeaderChannelID, tc.channel)
					req = WithRouteRole(req, tc.role)
					req, err = WithTrustedOrigin(req, origin)
					if err != nil {
						t.Fatal(err)
					}
					response := httptest.NewRecorder()
					integration.Handler().ServeHTTP(response, req)
					var payload struct {
						OK bool `json:"ok"`
					}
					if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
						t.Fatal(err)
					}
					if tc.allowed {
						if response.Code != http.StatusOK || !payload.OK {
							t.Fatalf("startup request failed: %d %s", response.Code, response.Body.String())
						}
					} else if response.Code < 400 || payload.OK {
						t.Fatalf("unauthorized request succeeded: %d %s", response.Code, response.Body.String())
					}
				})
			}
		})
	}

	// Exercise the released Flowersec proxy in front of the real platform handler.
	// The channel comes from the authenticated host hop, never browser headers.
	active = true
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" || r.Header.Get(sessionhop.HeaderChannelID) != channel {
			t.Error("browser credentials crossed the proxy boundary")
		}
		r = WithRouteRole(r, RouteRoleEnvTrusted)
		bound, err := WithTrustedOrigin(r, origin)
		if err != nil {
			t.Error(err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		integration.Handler().ServeHTTP(w, bound)
	}))
	defer upstream.Close()
	hop, err := accessproxy.New(accessproxy.Options{
		Meta: session.Meta{ChannelID: channel}, Upstream: upstream.URL, ExternalOrigin: origin,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = hop.Close() }()
	if err := hop.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	for _, endpoint := range []string{"catalog/query", "runtime/recover-enabled"} {
		for _, allowCSRF := range []bool{false, true} {
			name := endpoint + "/filtered"
			if allowCSRF {
				name = endpoint + "/forwarded"
			}
			t.Run(name, func(t *testing.T) {
				options := runtimeproxy.Options{Upstream: hop.URL(), UpstreamOrigin: origin}
				if allowCSRF {
					options.ExtraRequestHeaders = []string{csrfHeader}
				}
				status, body := proxyPluginStartupRequest(t, options, endpoint, origin)
				if allowCSRF {
					var result struct {
						OK bool `json:"ok"`
					}
					if err := json.Unmarshal(body, &result); err != nil || status != http.StatusOK || !result.OK {
						t.Fatalf("forwarded request: status=%d body=%s err=%v", status, body, err)
					}
				} else if status != http.StatusForbidden || !strings.Contains(string(body), "PLUGIN_CSRF_REQUIRED") {
					t.Fatalf("filtered request: status=%d body=%s", status, body)
				}
			})
		}
	}
}

type pluginProxyStream struct{ net.Conn }

func (*pluginProxyStream) Kind() string                           { return "flowersec-proxy/http1" }
func (*pluginProxyStream) TerminalError() *flowersec.SessionError { return nil }
func (s *pluginProxyStream) CloseWrite() error                    { return s.Close() }
func (s *pluginProxyStream) Reset() error                         { return s.Close() }

type pluginProxySession struct {
	flowersec.Session
	incoming chan flowersec.IncomingStream
}

func (s *pluginProxySession) AcceptStream(ctx context.Context) (flowersec.IncomingStream, error) {
	select {
	case incoming := <-s.incoming:
		return incoming, nil
	case <-ctx.Done():
		return flowersec.IncomingStream{}, ctx.Err()
	}
}
func (*pluginProxySession) Close() error { return nil }

func proxyPluginStartupRequest(t *testing.T, options runtimeproxy.Options, endpoint, origin string) (int, []byte) {
	t.Helper()
	handlers, err := flowersec.NewStreamHandlers(flowersec.StreamHandlerOptions{})
	if err != nil {
		t.Fatal(err)
	}
	proxy, err := runtimeproxy.RegisterStreamHandlers(handlers, options)
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
	sess := &pluginProxySession{incoming: make(chan flowersec.IncomingStream, 1)}
	sess.incoming <- flowersec.IncomingStream{
		Kind: "flowersec-proxy/http1", Metadata: flowersec.EmptyStreamMetadata(), Stream: &pluginProxyStream{server},
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
		"path": "/_redevplugin/api/plugins/" + endpoint, "external_origin": origin,
		"headers": []map[string]string{
			{"name": "content-type", "value": "application/json"},
			{"name": "origin", "value": origin},
			{"name": csrfHeader, "value": csrfProof},
			{"name": "Authorization", "value": "untrusted"},
			{"name": sessionhop.HeaderChannelID, "value": "untrusted"},
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
		OK     bool `json:"ok"`
		Status int  `json:"status"`
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
	return response.Status, body
}
