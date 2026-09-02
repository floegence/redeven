package main

import (
	"bufio"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
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
	allowedOrigin := flag.String("allowed-origin", "", "exact browser origin")
	flag.Parse()
	if err := run(*certificatePath, *privateKeyPath, *allowedOrigin); err != nil {
		_, _ = fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(certificatePath, privateKeyPath, allowedOrigin string) error {
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
	issued, err := controlplane.NewIssuer().IssueDirect(controlplane.DirectIssueOptions{
		Session: controlplane.SessionOptions{
			ChannelID: "channel-1", ExpiresAt: expiresAt,
			IdleTimeout: time.Minute, MaxInboundStreams: 64,
		},
		Endpoints: endpoints, RendezvousGroupID: "group-1",
		ListenerAudience: "listener-1", UpstreamAddress: listener.Addr().String(),
		Metadata: controlplane.ArtifactMetadata{Scopes: []controlplane.Scope{{
			Name: "proxy.runtime", Version: 2, Critical: true,
			Payload: json.RawMessage(`{"appBasePath":"/_redeven_proxy/env/","mode":"service_worker","serviceWorker":{"scope":"/_redeven_proxy/env/","scriptUrl":"/_redeven_proxy/env/_redeven_sw.js"},"version":2}`),
		}}},
	})
	if err != nil {
		var controlErr *controlplane.ControlPlaneError
		if errors.As(err, &controlErr) {
			return fmt.Errorf("issue direct artifact (%s at %s): %w", controlErr.Code(), controlErr.FieldPath(), err)
		}
		return fmt.Errorf("issue direct artifact: %w", err)
	}

	handlers, err := newHandlers()
	if err != nil {
		return err
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

func newHandlers() (*flowersec.SessionHandlers, error) {
	handlers, err := flowersec.NewSessionHandlers(flowersec.SessionHandlerOptions{})
	if err != nil {
		return nil, err
	}
	registrations := map[uint32]flowersec.RPCHandler{
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
		2002: func(context.Context, json.RawMessage) (any, *flowersec.RPCError) {
			return map[string]any{"sessions": []any{}}, nil
		},
	}
	for typeID, handler := range registrations {
		if err := handlers.HandleRPC(typeID, handler); err != nil {
			return nil, err
		}
	}
	return handlers, nil
}
