package main

import (
	"context"
	"encoding/json"
	"github.com/floegence/redeven/internal/gatewayhost"
	"github.com/floegence/redeven/internal/gatewaystate"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/runtimegateway/security"
	gatewaytrust "github.com/floegence/redeven/internal/runtimegateway/trust"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/gatewayservice"
	"github.com/floegence/redeven/internal/lockfile"
)

func TestConfigurationResetRequiresConfirmationAndStoppedService(t *testing.T) {
	root := t.TempDir()
	if _, err := gatewayservice.New(gatewayservice.Options{StateRoot: root}); err != nil {
		t.Fatal(err)
	}
	original := []byte("unsupported configuration")
	file := filepath.Join(root, "members.json")
	if err := os.WriteFile(file, original, 0600); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{{"configuration-reset"}, {"configuration-reset", "--state-root", root}} {
		if code := runCLI(args, strings.NewReader(""), &strings.Builder{}, &strings.Builder{}); code == 0 {
			t.Fatal("unconfirmed reset succeeded")
		}
	}
	lock, err := lockfile.Acquire(filepath.Join(root, "gateway-service.lock"))
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Release()
	stderr := &strings.Builder{}
	if code := runCLI([]string{"configuration-reset", "--state-root", root, "--confirm"}, strings.NewReader(""), &strings.Builder{}, stderr); code == 0 || !strings.Contains(stderr.String(), "stop Gateway") {
		t.Fatal("reset while service owns lock")
	}
	after, _ := os.ReadFile(file)
	if string(after) != string(original) {
		t.Fatal("configuration changed")
	}
}

func TestConfigurationResetArchivesRetiredStateAndPreservesIdentity(t *testing.T) {
	root := t.TempDir()
	if _, err := gatewayservice.New(gatewayservice.Options{StateRoot: root}); err != nil {
		t.Fatal(err)
	}
	identity, _ := os.ReadFile(filepath.Join(root, "gateway-trust.json"))
	old := []byte("retired attachment data")
	if err := os.WriteFile(filepath.Join(root, "members.json"), old, 0600); err != nil {
		t.Fatal(err)
	}
	out, stderr := &strings.Builder{}, &strings.Builder{}
	if code := runCLI([]string{"configuration-reset", "--state-root", root, "--confirm"}, strings.NewReader(""), out, stderr); code != 0 {
		t.Fatalf("reset %d: %s", code, stderr)
	}
	after, _ := os.ReadFile(filepath.Join(root, "gateway-trust.json"))
	if string(after) != string(identity) {
		t.Fatal("identity changed")
	}
	archives, _ := filepath.Glob(filepath.Join(root, "configuration-history", "*", "members.json"))
	if len(archives) != 1 {
		t.Fatalf("archives: %v", archives)
	}
	archived, _ := os.ReadFile(archives[0])
	if string(archived) != string(old) {
		t.Fatal("original configuration was not retained")
	}
	if _, err := gatewayservice.New(gatewayservice.Options{StateRoot: root}); err != nil {
		t.Fatal(err)
	}
}

func TestConfigurationResetRejectsUnsafeFilesBeforeArchiving(t *testing.T) {
	for _, target := range []string{"members.json", "gateway-trust.json", "configuration-history"} {
		t.Run(target, func(t *testing.T) {
			root := t.TempDir()
			if _, err := gatewayservice.New(gatewayservice.Options{StateRoot: root}); err != nil {
				t.Fatal(err)
			}
			original, err := os.ReadFile(filepath.Join(root, "members.json"))
			if err != nil {
				t.Fatal(err)
			}
			outside := filepath.Join(t.TempDir(), "outside")
			if err := os.WriteFile(outside, []byte("untouched"), 0600); err != nil {
				t.Fatal(err)
			}
			if err := os.Remove(filepath.Join(root, target)); err != nil && !os.IsNotExist(err) {
				t.Fatal(err)
			}
			if err := os.Symlink(outside, filepath.Join(root, target)); err != nil {
				t.Fatal(err)
			}
			if _, err := resetGatewayConfiguration(root); err == nil {
				t.Fatal("accepted unsafe path")
			}
			data, _ := os.ReadFile(outside)
			if string(data) != "untouched" {
				t.Fatal("changed symlink target")
			}
			if target != "members.json" {
				data, _ := os.ReadFile(filepath.Join(root, "members.json"))
				if string(data) != string(original) {
					t.Fatal("configuration changed")
				}
			}
		})
	}
}

func TestConfigurationResetRejectsInvalidIdentityBeforeArchiving(t *testing.T) {
	root := t.TempDir()
	if _, err := gatewayservice.New(gatewayservice.Options{StateRoot: root}); err != nil {
		t.Fatal(err)
	}
	original, err := os.ReadFile(filepath.Join(root, "members.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "gateway-trust.json"), []byte("{}"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := resetGatewayConfiguration(root); err == nil {
		t.Fatal("accepted invalid identity")
	}
	data, _ := os.ReadFile(filepath.Join(root, "members.json"))
	if string(data) != string(original) {
		t.Fatal("configuration changed")
	}
}

func TestConfigurationResetRestoresHostManagementWithoutReplacingClientTrust(t *testing.T) {
	root := t.TempDir()
	if _, err := gatewayservice.New(gatewayservice.Options{StateRoot: root}); err != nil {
		t.Fatal(err)
	}
	trustPath := filepath.Join(root, "gateway-trust.json")
	raw, err := os.ReadFile(trustPath)
	if err != nil {
		t.Fatal(err)
	}
	var state map[string]any
	if err := json.Unmarshal(raw, &state); err != nil {
		t.Fatal(err)
	}
	clients := map[string]any{}
	var ids []string
	for _, revoked := range []bool{false, true} {
		keys, err := security.GenerateKeyPair()
		if err != nil {
			t.Fatal(err)
		}
		id := security.ClientKeyID(keys.PublicKeyPEM)
		ids = append(ids, id)
		revokedAt := 0
		if revoked {
			revokedAt = 2
		}
		clients[id] = map[string]any{"client_key_id": id, "client_public_key": keys.PublicKeyPEM, "access": !revoked, "paired_at_unix_ms": 1, "revoked_at_unix_ms": revokedAt}
	}
	state["clients"] = clients
	if err := gatewaystate.Write(trustPath, state); err != nil {
		t.Fatal(err)
	}
	identity, err := os.ReadFile(trustPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"members.json", "environments.json", "membership-migration.json", "cloud-access.json", "host-operations.json", "policy-hooks.json"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte("{\"schema_version\":5}"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := gatewayservice.New(gatewayservice.Options{StateRoot: root}); err == nil {
		t.Fatal("retired state unexpectedly started")
	}
	archive, err := resetGatewayConfiguration(root)
	if err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(archive)
	if err != nil || len(entries) != 6 {
		t.Fatalf("archive: %v %v", entries, err)
	}
	token := strings.Repeat("x", 43)
	owner, err := gatewayservice.New(gatewayservice.Options{StateRoot: root, HostAdminToken: token, PublicListen: "127.0.0.1:0"})
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
	if err := gatewaystate.Write(gatewayhost.TokenPath(root), token); err != nil {
		t.Fatal(err)
	}
	shared, err := gatewayhost.New(root, listeners[0].Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer shared.Close()
	var catalog gp.CatalogResponse
	if err := (&hostAdminClient{client: shared}).request(ctx, "/gateway/v6/catalog", gp.CatalogRequest{ProtocolVersion: gp.Version}, &catalog); err != nil {
		t.Fatal(err)
	}
	if !catalog.Gateway.Permissions.ManageAttachments || len(catalog.Attachments) != 0 || catalog.Policy.DefaultEgressAllowed {
		t.Fatal("unexpected recovered catalog", catalog)
	}
	trust := gatewaytrust.NewStore(trustPath)
	if !trust.ClientPermissions(ids[0]).Access || trust.ClientPermissions(ids[1]).Access {
		t.Fatal("client admission or revocation changed")
	}
	after, err := os.ReadFile(trustPath)
	if err != nil || string(after) != string(identity) {
		t.Fatal("device trust changed", err)
	}
}

func TestInterruptedConfigurationResetBlocksStartupAndReplay(t *testing.T) {
	root := t.TempDir()
	if _, err := gatewayservice.New(gatewayservice.Options{StateRoot: root}); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(filepath.Join(root, "members.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := gatewaystate.Write(filepath.Join(root, "configuration-reset.json"), map[string]any{"archive_path": "configuration-history/reset-interrupted"}); err != nil {
		t.Fatal(err)
	}
	if _, err := gatewayservice.New(gatewayservice.Options{StateRoot: root}); err == nil || !strings.Contains(err.Error(), "interrupted configuration reset") {
		t.Fatal("startup ignored incomplete reset", err)
	}
	if _, err := resetGatewayConfiguration(root); err == nil || !strings.Contains(err.Error(), "interrupted configuration reset") {
		t.Fatal("reset blindly replayed", err)
	}
	after, err := os.ReadFile(filepath.Join(root, "members.json"))
	if err != nil || string(after) != string(before) {
		t.Fatal("interrupted reset changed configuration", err)
	}
}
