package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/testutil/gatewayfixture"
)

func TestGatewayJoinInitializesFreshRuntimeAndPreservesExistingPermissionCap(t *testing.T) {
	// A failed enrollment still persists the local intent. Startup must be
	// possible before either Gateway or Cloud has delivered its response.
	unavailable := httptest.NewTLSServer(http.NotFoundHandler())
	defer unavailable.Close()
	store, _ := gatewayfixture.New(t, unavailable.URL, "127.0.0.1:7443")
	for _, preset := range []string{"", "read_only"} {
		t.Run("permission_"+preset, func(t *testing.T) {
			root := t.TempDir()
			layout, err := resolveBootstrapTargetLayout(root)
			if err != nil {
				t.Fatal(err)
			}
			policy, err := config.ParsePermissionPolicyPreset(preset)
			if err != nil {
				t.Fatal(err)
			}
			if preset != "" {
				if err := config.Save(layout.ConfigPath, &config.Config{PermissionPolicy: policy}); err != nil {
					t.Fatal(err)
				}
			}
			invitation, err := store.Invite("admin")
			if err != nil {
				t.Fatal(err)
			}
			material, err := json.Marshal(invitation)
			if err != nil {
				t.Fatal(err)
			}
			file := filepath.Join(root, "invitation.json")
			if err := os.WriteFile(file, material, 0600); err != nil {
				t.Fatal(err)
			}
			code, _, _ := runCLITest(t, "gateway", "join", "--state-root", root, "--invitation-file", file)
			if code != 1 {
				t.Fatalf("unavailable Gateway enrollment code = %d", code)
			}
			cfg, err := config.Load(layout.ConfigPath)
			if err != nil {
				t.Fatal(err)
			}
			if cfg.Gateway == nil || !reflect.DeepEqual(cfg.PermissionPolicy, policy) {
				t.Fatal("joining lost local intent or changed the Runtime permission cap")
			}
			if err := cfg.ValidateGatewayManagement(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
