package agent

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/gatewaycloud"
	"github.com/floegence/redeven/internal/testutil/gatewayfixture"
)

func TestGatewayDesktopJoinRejectsImplicitBindingReplacement(t *testing.T) {
	for _, cfg := range []*config.Config{
		{EnvironmentID: "owned"},
		{GatewayMigrationEvidence: &gatewaycloud.MigrationEvidence{RequestPublicID: "pending-migration"}},
		{GatewayPublication: &gatewaycloud.RuntimeConfig{RequestPublicID: "existing", Revoked: true}},
	} {
		store, _ := gatewayfixture.New(t, "https://gateway.internal:7443", "127.0.0.1:7443")
		cfg.Gateway = gatewayfixture.Enroll(t, store, "runtime")
		a := &Agent{cfg: cfg, configPath: filepath.Join(t.TempDir(), "config.json")}
		if err := a.advanceGatewayPublication(context.Background()); err == nil {
			t.Fatal("replaced an existing binding without migration")
		}
		if a.cfg != cfg {
			t.Fatal("rejection mutated local consent")
		}
	}
	a := &Agent{cfg: &config.Config{}, configPath: filepath.Join(t.TempDir(), "config.json")}
	if err := a.advanceGatewayPublication(context.Background()); err == nil {
		t.Fatal("missing local consent accepted")
	}
	if a.cfg.GatewayPublication != nil {
		t.Fatal("enrollment appeared without material")
	}
}
