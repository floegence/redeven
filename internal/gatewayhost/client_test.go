package gatewayhost

import (
	"context"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/gatewayservice"
	"github.com/floegence/redeven/internal/gatewaystate"
)

func TestOpenReadsCompleteOfficialServiceRecord(t *testing.T) {
	root := t.TempDir()
	token := strings.Repeat("x", 43)
	owner, err := gatewayservice.New(gatewayservice.Options{StateRoot: root, HostAdminToken: token, PublicURL: "https://gateway.internal:7443", PublicListen: "127.0.0.1:0"})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	server, listeners, err := owner.Start(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	// The real CLI publishes all these fields. A partial projection must not
	// weaken the shared strict JSON reader or reject a healthy Gateway.
	record := map[string]any{"status": "running", "pid": 123, "listen": listeners[0].Addr().String(), "public_listen": "127.0.0.1:7443", "state_root": root, "executable": "/fixture/redeven-gateway", "process_started_at_unix_ms": 1}
	if err := gatewaystate.Write(root+"/gateway-service.pid.json", record); err != nil {
		t.Fatal(err)
	}
	if err := gatewaystate.Write(TokenPath(root), token); err != nil {
		t.Fatal(err)
	}
	client, err := Open(root)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	catalog, err := client.Catalog(context.Background())
	if err != nil || !catalog.Gateway.Permissions.ManageAttachments {
		t.Fatal("official catalog rejected", err)
	}
	record["status"] = "stopped"
	_ = gatewaystate.Write(root+"/gateway-service.pid.json", record)
	if _, err := Open(root); err == nil {
		t.Fatal("stopped service record accepted")
	}
	record["status"] = "running"
	record["unrecognized_authority"] = true
	_ = gatewaystate.Write(root+"/gateway-service.pid.json", record)
	if _, err := Open(root); err == nil {
		t.Fatal("unknown service-record shape accepted")
	}
}
