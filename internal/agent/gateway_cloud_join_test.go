package agent

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/gatewaycloud"
	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
)

func TestGatewayDesktopJoinRejectsImplicitBindingReplacement(t *testing.T) {
	for _, cfg := range []*config.Config{
		{EnvironmentID: "owned"},
		{GatewayCloudMigration: &gatewaycloud.RuntimeConfig{RequestPublicID: "pending-migration"}},
		{GatewayCloud: &gatewaycloud.RuntimeConfig{RequestPublicID: "existing", Revoked: true}},
	} {
		a := &Agent{cfg: cfg, configPath: filepath.Join(t.TempDir(), "config.json")}
		if _, err := a.JoinGatewayCloud(context.Background(), &gc.JoinMaterial{RequestPublicID: "replacement"}); err == nil {
			t.Fatal("replaced an existing binding without migration")
		}
		if a.cfg != cfg {
			t.Fatal("rejection mutated local consent")
		}
	}
	a := &Agent{cfg: &config.Config{}, configPath: filepath.Join(t.TempDir(), "config.json")}
	if _, err := a.JoinGatewayCloud(context.Background(), nil); err == nil {
		t.Fatal("missing local consent accepted")
	}
	if a.cfg.GatewayCloud != nil {
		t.Fatal("enrollment appeared without material")
	}
}
