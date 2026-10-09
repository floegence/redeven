// Command testpeer is the private Go/Node membership interoperability fixture.
// Its Runtime never listens on TCP; all application traffic uses reverse streams.
package main

import (
	"bufio"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
	"github.com/floegence/flowersec/flowersec-go/v5/controlplane"
	"github.com/floegence/redeven/internal/gatewayflow"
	gm "github.com/floegence/redeven/internal/gatewaymembership"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

func run() error {
	root, err := os.MkdirTemp("", "redeven-member-peer-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(root)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	defer listener.Close()
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return err
	}
	hooks, err := gm.NewPolicyHooks(gm.HookConfig{})
	if err != nil {
		return err
	}
	store, err := gm.NewStore(filepath.Join(root, "members.json"), gm.GatewayIdentity{ID: "gateway_interop", PrivateKey: key}, "https://LOCALHOST:"+strconv.Itoa(listener.Addr().(*net.TCPAddr).Port), listener.Addr().String(), hooks)
	if err != nil {
		return err
	}
	unavailable, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	unavailableAddress := unavailable.Addr().String()
	_ = unavailable.Close()
	if err := store.UpdateEndpoints([]gp.GatewayEndpoint{
		{EndpointID: "a_unreachable", Address: "https://" + unavailableAddress, Scope: gp.GatewayEndpointPublic, Priority: 0},
		{EndpointID: "z_lan", Address: "https://localhost:" + strconv.Itoa(listener.Addr().(*net.TCPAddr).Port), Scope: gp.GatewayEndpointLAN, Priority: 1},
	}); err != nil {
		return err
	}
	flows := gm.NewConnections(gatewayflow.New(0, 0))
	defer flows.Close()
	store.SetCommitHandler(flows.Apply)
	endpoint, err := gm.NewListener(store, flows, func(id string) bool { return id == "desktop" })
	if err != nil {
		return err
	}
	tlsConfig, err := store.TLSConfig()
	if err != nil {
		return err
	}
	server, err := endpoint.Server(tlsConfig, nil)
	if err != nil {
		return err
	}
	serverDone := make(chan struct{})
	go func() { defer close(serverDone); _ = server.Serve(listener) }()
	defer func() { _ = server.Close(); <-serverDone }()
	invitation, err := store.Invite("admin")
	if err != nil {
		return err
	}
	state, err := gm.PrepareRuntime(invitation, "runtime_interop", gp.MemberMetadata{Hostname: "Isolated Runtime"})
	if err != nil {
		return err
	}
	var mu sync.Mutex
	current := func() *gm.RuntimeConfig { mu.Lock(); defer mu.Unlock(); return state.Clone() }
	runtime, err := gm.NewRuntimeConnection(current, func(next *gm.RuntimeConfig) error { mu.Lock(); defer mu.Unlock(); state = next.Clone(); return nil })
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	applicationAcceptor, err := flowersec.NewAcceptor(flowersec.AcceptorOptions{OnSession: func(context.Context, flowersec.Session, string) error {
		return errors.New("application session denied")
	}, AllowedOrigins: []string{current().Service.Origin}, Authorize: func(context.Context, controlplane.RuntimeAuthorizationRequest) (controlplane.AuthorizationResponse, error) {
		return controlplane.RejectRuntime("permission_denied", false)
	}})
	if err != nil {
		return err
	}
	runtimeDone := make(chan error, 1)
	go func() {
		runtimeDone <- runtime.Run(ctx, func(origin string) gm.RuntimeApplication {
			return gm.RuntimeApplication{WebSocketHandler: applicationAcceptor.Handler(), Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "text/plain; charset=utf-8")
				w.Header().Set("X-Content-Type-Options", "nosniff")
				if r.TLS == nil || "https://"+r.Host != origin {
					http.Error(w, "wrong authority", http.StatusForbidden)
					return
				}
				if r.URL.Path == "/stream" {
					w.WriteHeader(http.StatusOK)
					_, _ = w.Write([]byte("ready\n"))
					w.(http.Flusher).Flush()
					<-r.Context().Done()
					return
				}
				if r.Method == http.MethodPost {
					_, _ = io.Copy(w, r.Body)
					return
				}
				_, _ = io.WriteString(w, "private-runtime-content")
			})}
		})
	}()
	defer func() { cancel(); <-runtimeDone }()
	snapshot := runtime.Snapshot()
	for snapshot.State != flowersec.ConnectionConnected {
		if snapshot.State == flowersec.ConnectionFailed {
			return errors.New("member connection failed")
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(5 * time.Millisecond):
			snapshot = runtime.Snapshot()
		}
	}
	for !flows.IsConnected(current().MemberID) {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Millisecond):
		}
	}
	member := current()
	encoder := json.NewEncoder(os.Stdout)
	if err := encoder.Encode(map[string]any{"ready": true, "gateway_id": member.GatewayID, "endpoints": member.ConnectionEndpoints(), "gateway_tls_root_pem": member.GatewayTLSRootPEM, "runtime_id": member.RuntimePublicID, "member_id": member.MemberID, "member_version": member.MemberVersion}); err != nil {
		return err
	}
	scanner := bufio.NewScanner(os.Stdin)
	for scanner.Scan() {
		var request struct {
			ID     int    `json:"id"`
			Action string `json:"action"`
		}
		if json.Unmarshal(scanner.Bytes(), &request) != nil {
			return errors.New("invalid peer command")
		}
		var data any
		switch request.Action {
		case "offer":
			data, err = store.AccessOffer(ctx, member.MemberID, "desktop")
		case "service":
			data, err = store.ServiceIdentity(member.MemberID, member.MemberVersion)
		case "rotate":
			next := current()
			err = next.Rotate(ctx, func(updated *gm.RuntimeConfig) error {
				mu.Lock()
				defer mu.Unlock()
				state = updated.Clone()
				return nil
			})
		case "remove":
			err = store.Remove(member.MemberID, member.MemberVersion)
		case "stop":
			return nil
		default:
			return errors.New("unknown peer command")
		}
		response := map[string]any{"id": request.ID, "data": data}
		if err != nil {
			response["error"] = "operation_failed"
		}
		if err := encoder.Encode(response); err != nil {
			return err
		}
	}
	return scanner.Err()
}
func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
