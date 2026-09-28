package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
	"github.com/floegence/flowersec/flowersec-go/v5/controlplane"
)

type outputWriter struct {
	mu sync.Mutex
}

func (writer *outputWriter) write(value any) {
	writer.mu.Lock()
	defer writer.mu.Unlock()
	_ = json.NewEncoder(os.Stdout).Encode(value)
}

func main() {
	certificatePath := flag.String("certificate", "", "PEM certificate path")
	privateKeyPath := flag.String("private-key", "", "PEM private key path")
	nativeCode := flag.Bool("native-codespace", false, "serve the native CodeSpace HTTP fixture")
	fileContinuity := flag.Bool("file-continuity", false, "forward file RPCs to the controlled continuity fixture")
	visualGit := flag.Bool("visual-git", false, "serve read-only Git appearance fixtures")
	allowedOrigin := flag.String("allowed-origin", "", "exact browser origin")
	httpUpstream := flag.String("http-upstream", "", "fixture HTTP upstream for session requests")
	flag.Parse()
	if err := run(*certificatePath, *privateKeyPath, *allowedOrigin, *httpUpstream, *nativeCode, *visualGit, *fileContinuity); err != nil {
		_, _ = fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(certificatePath, privateKeyPath, allowedOrigin, httpUpstream string, nativeCode, visualGit, fileContinuity bool) error {
	if strings.TrimSpace(certificatePath) == "" || strings.TrimSpace(privateKeyPath) == "" || strings.TrimSpace(allowedOrigin) == "" {
		return errors.New("certificate, private key, and allowed origin are required")
	}
	certificate, err := tls.LoadX509KeyPair(certificatePath, privateKeyPath)
	if err != nil {
		return fmt.Errorf("load TLS identity: %w", err)
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return fmt.Errorf("listen: %w", err)
	}
	defer listener.Close()

	wssURL := "wss://" + listener.Addr().String() + flowersec.WebSocketDirectPath
	endpoints, err := controlplane.NewEndpointSet(controlplane.EndpointConfig{
		ID: "built-dist-wss", URL: wssURL, TLS: controlplane.CAPolicy(),
	})
	if err != nil {
		return fmt.Errorf("create endpoint set: %w", err)
	}
	expiresAt := time.Now().UTC().Add(4 * time.Minute).Truncate(time.Second)
	projection := json.RawMessage(`{"appBasePath":"/_redeven_proxy/env/","http":{"additionalPathPrefixes":["/_redeven_proxy/api/","/_redevplugin/api/plugins"],"extraRequestHeaders":["X-ReDevPlugin-CSRF","X-ReDevPlugin-Expected-Management-Revision"]},"limits":{"maxBodyBytes":268435456},"mode":"service_worker","serviceWorker":{"scope":"/_redeven_proxy/env/","scriptUrl":"/_redeven_proxy/env/_redeven_sw.js"},"version":2}`)
	if nativeCode {
		projection = json.RawMessage(`{"appBasePath":"/","controllerBridge":{"allowedOrigins":["https://app.native.test"]},"mode":"controller_bridge","version":2}`)
	}
	issued, err := controlplane.NewIssuer().IssueDirect(controlplane.DirectIssueOptions{
		Session: controlplane.SessionOptions{
			ChannelID: "channel-1", ExpiresAt: expiresAt,
			IdleTimeout: time.Minute, MaxInboundStreams: 64,
		},
		Endpoints: endpoints, RendezvousGroupID: "group-1",
		ListenerAudience: "listener-1", UpstreamAddress: listener.Addr().String(),
		Metadata: controlplane.ArtifactMetadata{Scopes: []controlplane.Scope{{
			Name: "proxy.runtime", Version: 2, Critical: true,
			Payload: projection,
		}}},
	})
	if err != nil {
		var controlErr *controlplane.ControlPlaneError
		if errors.As(err, &controlErr) {
			return fmt.Errorf("issue direct artifact (%s at %s): %w", controlErr.Code(), controlErr.FieldPath(), err)
		}
		return fmt.Errorf("issue direct artifact: %w", err)
	}

	handlers, err := newHandlers(nativeCode, visualGit, fileContinuity, httpUpstream)
	if err != nil {
		return err
	}
	if httpUpstream != "" {
		proxy, err := flowersec.NewProxyServer(flowersec.ProxyServerOptions{
			Upstream: httpUpstream, UpstreamOrigin: allowedOrigin,
			ExtraRequestHeaders: []string{"X-ReDevPlugin-CSRF", "X-ReDevPlugin-Expected-Management-Revision"},
			MaxBodyBytes:        256 << 20,
		})
		if err != nil {
			return err
		}
		defer proxy.Close()
		if err := proxy.RegisterStreamHandlers(handlers); err != nil {
			return err
		}
	}
	var authorized atomic.Bool
	writer := &outputWriter{}
	acceptor, err := flowersec.NewAcceptor(flowersec.AcceptorOptions{
		AllowedOrigins:    []string{allowedOrigin},
		MaxInboundStreams: 64,
		Authorize: func(_ context.Context, request controlplane.RuntimeAuthorizationRequest) (controlplane.AuthorizationResponse, error) {
			if !authorized.CompareAndSwap(false, true) {
				return controlplane.RejectRuntime("permission_denied", false)
			}
			response, authorizeErr := controlplane.AuthorizeRuntime(request, issued.AuthorizationRecord(), "built-dist-lease")
			if authorizeErr != nil {
				authorized.Store(false)
				return controlplane.AuthorizationResponse{}, authorizeErr
			}
			writer.write(map[string]string{"type": "event", "event": "websocket_authorized"})
			return response, nil
		},
		Release: func(context.Context, string) {
			writer.write(map[string]string{"type": "event", "event": "lease_released"})
		},
		ResolveHandlers: func(context.Context, controlplane.RuntimeAuthorizationRequest) (*flowersec.SessionHandlers, error) {
			return handlers, nil
		},
		OnSession: func(ctx context.Context, _ flowersec.Session, _ string) error {
			writer.write(map[string]string{"type": "event", "event": "session_established"})
			writer.write(map[string]string{"type": "event", "event": "session_serving"})
			writer.write(map[string]string{"type": "event", "event": "runtime_ready"})
			<-ctx.Done()
			return context.Cause(ctx)
		},
	})
	if err != nil {
		return fmt.Errorf("create acceptor: %w", err)
	}
	server, err := flowersec.NewWebSocketHTTPServer(flowersec.WebSocketHTTPServerOptions{
		Handler: acceptor.Handler(),
		TLSConfig: &tls.Config{
			MinVersion:   tls.VersionTLS13,
			Certificates: []tls.Certificate{certificate},
		},
	})
	if err != nil {
		return fmt.Errorf("create WebSocket server: %w", err)
	}
	serveDone := make(chan error, 1)
	go func() { serveDone <- server.Serve(listener) }()

	writer.write(map[string]any{
		"type": "ready", "artifact": string(issued.ArtifactJSON()),
		"channel_id": "channel-1", "expires_at": expiresAt.Format(time.RFC3339),
		"wss_url": wssURL,
	})

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	stdinClosed := make(chan struct{})
	go func() {
		reader := bufio.NewReader(os.Stdin)
		_, _ = reader.ReadByte()
		close(stdinClosed)
	}()
	select {
	case <-ctx.Done():
	case <-stdinClosed:
	case serveErr := <-serveDone:
		if serveErr != nil && !errors.Is(serveErr, net.ErrClosed) && !errors.Is(serveErr, http.ErrServerClosed) {
			return serveErr
		}
		return nil
	}
	if err := server.Close(); err != nil {
		return err
	}
	serveErr := <-serveDone
	if serveErr != nil && !errors.Is(serveErr, net.ErrClosed) && !errors.Is(serveErr, http.ErrServerClosed) {
		return serveErr
	}
	return nil
}

func newHandlers(nativeCode, visualGit, fileContinuity bool, httpUpstream string) (*flowersec.SessionHandlers, error) {
	handlers, err := flowersec.NewSessionHandlers(flowersec.SessionHandlerOptions{})
	if err != nil {
		return nil, err
	}
	registrations := map[uint32]flowersec.RPCHandler{
		1001: func(context.Context, json.RawMessage) (any, *flowersec.RPCError) {
			entries := []map[string]any{}
			for _, name := range []string{"src", "assets", "package.json", "README.md", "main.py", "index.ts", "app.js", "photo.png", "movie.mp4", "archive.zip"} {
				kind := "file"
				if name == "src" || name == "assets" {
					kind = "folder"
				}
				entries = append(entries, map[string]any{"name": name, "path": "/workspace/" + name, "is_directory": kind == "folder", "entry_type": kind, "resolved_type": kind, "size": 2048, "modified_at": 1789516800000, "created_at": 1789516800000})
			}
			return map[string]any{"entries": entries}, nil
		},
		1010: func(context.Context, json.RawMessage) (any, *flowersec.RPCError) {
			return map[string]any{"agent_home_path_abs": "/workspace", "home_path_abs": "/workspace", "default_root_id": "home", "roots": []map[string]any{{"id": "home", "label": "Workspace", "path": "/workspace", "path_abs": "/workspace", "kind": "home", "permissions": map[string]bool{"read": true, "write": true}}}}, nil
		},
		1101: func(context.Context, json.RawMessage) (any, *flowersec.RPCError) {
			return map[string]any{"available": false, "git_available": true, "unavailable_reason": "not_a_repository"}, nil
		},
		1106: func(context.Context, json.RawMessage) (any, *flowersec.RPCError) {
			return map[string]any{"repo_root_path": "/workspace", "local": []any{}, "remote": []any{}}, nil
		},
		1130: func(context.Context, json.RawMessage) (any, *flowersec.RPCError) {
			return map[string]bool{"workspace_revision_v1": true, "workspace_path_status_v1": true, "workspace_directory_scope_v1": true, "stash_section_diff_v1": true}, nil
		},
		4001: func(context.Context, json.RawMessage) (any, *flowersec.RPCError) {
			return map[string]any{"server_time_ms": time.Now().UnixMilli()}, nil
		},
		4501: func(context.Context, json.RawMessage) (any, *flowersec.RPCError) {
			return map[string]any{"password_required": false, "unlocked": true}, nil
		},
		4502: func(context.Context, json.RawMessage) (any, *flowersec.RPCError) {
			return map[string]any{"unlocked": true}, nil
		},
		5001: func(context.Context, json.RawMessage) (any, *flowersec.RPCError) {
			return map[string]any{"sessions": []any{}}, nil
		},
		2017: func(context.Context, json.RawMessage) (any, *flowersec.RPCError) {
			return map[string]any{"revision": 1, "groups": []any{map[string]any{
				"id": "default", "name": "Default", "default_working_dir": "/workspace",
				"sort_order": 0, "created_at_ms": 1, "updated_at_ms": 1, "is_default": true,
			}}}, nil
		},
		2002: func(context.Context, json.RawMessage) (any, *flowersec.RPCError) {
			return map[string]any{"sessions": []any{}}, nil
		},
	}
	if fileContinuity {
		if httpUpstream == "" {
			return nil, errors.New("file continuity requires a fixture upstream")
		}
		for _, typeID := range []uint32{1001, 1010} {
			registrations[typeID] = func(ctx context.Context, body json.RawMessage) (any, *flowersec.RPCError) {
				request, err := http.NewRequestWithContext(ctx, "POST", fmt.Sprintf("%s/__fixture/files/%d", httpUpstream, typeID), bytes.NewReader(body))
				if err != nil {
					return nil, &flowersec.RPCError{Code: 503, Message: err.Error()}
				}
				response, err := http.DefaultClient.Do(request)
				if err != nil {
					return nil, &flowersec.RPCError{Code: 503, Message: err.Error()}
				}
				defer response.Body.Close()
				if response.StatusCode != 200 {
					return nil, &flowersec.RPCError{Code: uint32(response.StatusCode), Message: "File fixture unavailable"}
				}
				var data any
				if err := json.NewDecoder(response.Body).Decode(&data); err != nil {
					return nil, &flowersec.RPCError{Code: 500, Message: err.Error()}
				}
				return data, nil
			}
		}
	}
	if visualGit {
		commit := map[string]any{"hash": "abcdef1234567890", "short_hash": "abcdef1", "parents": []string{}, "subject": "Refine mobile navigation and preserve workspace state", "author_name": "Developer", "author_time_ms": 1789516800000}
		files := []any{}
		for index := 0; index < 24; index++ {
			files = append(files, map[string]any{"path": fmt.Sprintf("src/feature-%d.ts", index), "change_type": "modified", "additions": 70, "deletions": 1})
		}
		registrations[1119] = func(_ context.Context, body json.RawMessage) (any, *flowersec.RPCError) {
			var request struct {
				File struct {
					Path string `json:"path"`
				} `json:"file"`
			}
			if err := json.Unmarshal(body, &request); err != nil {
				return nil, &flowersec.RPCError{Code: 400, Message: "Invalid visual diff request"}
			}
			patch := "@@ -1,1 +1,70 @@\n-old\n"
			for line := 0; line < 70; line++ {
				patch += fmt.Sprintf("+const line%d = %d;\n", line, line)
			}
			return map[string]any{"repo_root_path": "/workspace", "file": map[string]any{"path": request.File.Path, "change_type": "modified", "additions": 70, "deletions": 1, "patch_text": patch}}, nil
		}
		// This fixture exposes reads only; mutation RPCs remain unregistered.
		responses := map[uint32]any{
			1101: map[string]any{"available": true, "git_available": true, "repo_root_path": "/workspace", "head_ref": "main", "head_commit": "abcdef1234567890"},
			1102: map[string]any{"repo_root_path": "/workspace", "commits": []any{commit}, "has_more": false},
			1103: map[string]any{"repo_root_path": "/workspace", "commit": commit, "files": files},
			1104: map[string]any{"repo_root_path": "/workspace", "worktree_path": "/workspace", "head_ref": "main", "head_commit": "abcdef1234567890", "upstream_ref": "origin/main", "workspace_summary": map[string]any{}, "workspace_revision": "visual-1"},
			1105: map[string]any{"repo_root_path": "/workspace", "summary": map[string]any{}, "staged": []any{}, "unstaged": []any{}, "untracked": []any{}, "conflicted": []any{}},
			1106: map[string]any{"repo_root_path": "/workspace", "current_ref": "main", "local": []any{map[string]any{"name": "main", "full_name": "refs/heads/main", "kind": "local", "current": true, "upstream_ref": "origin/main", "worktree_path": "/workspace", "subject": "Refine theme surfaces"}}, "remote": []any{map[string]any{"name": "origin/main", "full_name": "refs/remotes/origin/main", "kind": "remote", "subject": "Refine theme surfaces"}}},
			1121: map[string]any{"repo_root_path": "/workspace", "stashes": []any{}},
			1128: map[string]any{"repo_root_path": "/workspace", "summary": map[string]any{}, "items": []any{}, "workspace_revision": "visual-1", "total_count": 0, "has_more": false},
			1131: map[string]any{"repo_root_path": "/workspace", "workspace_revision": "visual-1", "items": []any{}},
		}
		for typeID, response := range responses {
			registrations[typeID] = func(context.Context, json.RawMessage) (any, *flowersec.RPCError) { return response, nil }
		}
	}
	for typeID, handler := range registrations {
		if err := handlers.HandleRPC(typeID, handler); err != nil {
			return nil, err
		}
	}
	if nativeCode {
		var unlocked atomic.Bool
		if err := handlers.HandleStream("code/auth_v1", func(_ context.Context, incoming flowersec.IncomingStream) error {
			if incoming.Metadata.Values()["delegation"] == "native-delegation" {
				unlocked.Store(true)
			}
			return json.NewEncoder(incoming.Stream).Encode(map[string]any{"unlocked": unlocked.Load(), "resume_token": "native-resume"})
		}); err != nil {
			return nil, err
		}
		if err := handlers.HandleStream("code/http_v1", func(ctx context.Context, incoming flowersec.IncomingStream) error {
			origin, _ := incoming.Metadata.Values()["presentation_origin"].(string)
			return flowersec.ServeHTTPStream(ctx, incoming.Stream, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if !unlocked.Load() {
					http.Error(w, "locked", 423)
					return
				}
				if origin != "http://"+r.Host {
					http.Error(w, "wrong origin", 403)
					return
				}
				w.Header().Set("X-Native-Path", r.URL.RequestURI())
				w.Header().Set("Content-Type", "text/plain; charset=utf-8")
				w.Header().Set("X-Content-Type-Options", "nosniff")
				io.Copy(w, r.Body)
			}), flowersec.HTTPStreamOptions{})
		}); err != nil {
			return nil, err
		}
	}
	return handlers, nil
}
