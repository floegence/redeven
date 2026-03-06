package accessrpc

import (
	"context"
	"errors"
	"net"
	"testing"

	"github.com/floegence/flowersec/flowersec-go/rpc"
	rpctyped "github.com/floegence/flowersec/flowersec-go/rpc/typed"
	"github.com/floegence/redeven-agent/internal/accessgate"
	"github.com/floegence/redeven-agent/internal/fs"
	"github.com/floegence/redeven-agent/internal/session"
)

func TestService_ResumeUnlocksProtectedRPC(t *testing.T) {
	gate := accessgate.New(accessgate.Options{Password: "secret"})
	proxyMeta := session.Meta{
		ChannelID:    "ch-proxy",
		EndpointID:   "env_demo",
		FloeApp:      "com.floegence.redeven.agent",
		CodeSpaceID:  "env-ui",
		SessionKind:  "envapp_proxy",
		UserPublicID: "user_demo",
		CanRead:      true,
	}
	rpcMeta := proxyMeta
	rpcMeta.ChannelID = "ch-rpc"
	rpcMeta.SessionKind = "envapp_rpc"

	gate.RegisterChannel(proxyMeta)
	gate.RegisterChannel(rpcMeta)

	unlockResult, err := gate.UnlockChannel(proxyMeta.ChannelID, "secret")
	if err != nil {
		t.Fatalf("UnlockChannel() error = %v", err)
	}
	if unlockResult.ResumeToken == "" {
		t.Fatalf("resume token missing")
	}

	serverConn, clientConn := net.Pipe()
	defer serverConn.Close()
	defer clientConn.Close()

	router := rpc.NewRouter()
	New(gate).Register(router, &rpcMeta)
	fs.NewService(t.TempDir()).RegisterWithAccessGate(router, &rpcMeta, gate)

	srv := rpc.NewServer(serverConn, router)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		_ = srv.Serve(ctx)
	}()

	client := rpc.NewClient(clientConn)

	status, err := rpctyped.Call[struct{}, StatusResponse](ctx, client, TypeIDAccessStatus, &struct{}{})
	if err != nil {
		t.Fatalf("access.status error = %v", err)
	}
	if !status.PasswordRequired || status.Unlocked {
		t.Fatalf("unexpected initial status: %#v", status)
	}

	if _, err := rpctyped.Call[struct{}, map[string]string](ctx, client, fs.TypeID_FS_GET_HOME, &struct{}{}); err == nil {
		t.Fatalf("expected protected RPC to fail before resume")
	} else {
		var callErr *rpc.CallError
		if !errors.As(err, &callErr) {
			t.Fatalf("expected CallError, got %T (%v)", err, err)
		}
		if callErr.Code != 423 {
			t.Fatalf("protected RPC code = %d, want 423", callErr.Code)
		}
	}

	if _, err := rpctyped.Call[ResumeRequest, ResumeResponse](ctx, client, TypeIDAccessResume, &ResumeRequest{Token: unlockResult.ResumeToken}); err != nil {
		t.Fatalf("access.resume error = %v", err)
	}

	home, err := rpctyped.Call[struct{}, map[string]string](ctx, client, fs.TypeID_FS_GET_HOME, &struct{}{})
	if err != nil {
		t.Fatalf("fs.get_home after resume error = %v", err)
	}
	if home == nil || (*home)["path"] == "" {
		t.Fatalf("fs.get_home returned empty path")
	}
}
