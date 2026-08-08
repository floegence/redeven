package agent

import (
	"context"
	"path/filepath"
	"testing"

	flowersec "github.com/floegence/flowersec/flowersec-go/v2"
	"github.com/floegence/redeven/internal/config"
)

const controlArtifactFixture = `{"v":2,"profile":"flowersec/2","session":{"channel_id":"channel-1","init_expire_at_unix_s":4102444800,"idle_timeout_seconds":60,"establish_timeout_seconds":30,"rekey_prepare_timeout_seconds":10,"rekey_completion_timeout_seconds":30,"max_inbound_streams":64,"e2ee_psk_b64u":"AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA","allowed_suites":[1,2],"default_suite":1,"selected_features":0,"contract_hash_b64u":"ioBJP5DPhg471caMR-huV5I9RlNKY2Pr9fs2GkP8CmA"},"path":{"kind":"direct","rendezvous_group_id":"group-1","listener_audience":"listener-1","routing_token":"routing-token","candidates":[{"id":"w1","carrier":"websocket","url":"wss://example.com/flowersec/v2/direct","wire_profile":"flowersec-direct/2"}]},"scoped":[],"correlation":{"v":2,"tags":[]}}`

func TestControlArtifactSourceUsesPublishedFlowersecLeaseAndPersistsSpend(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	cfg := &config.Config{
		BindingGeneration: 7,
		Direct: &config.DirectConnectInfo{
			ArtifactJSON:   []byte(controlArtifactFixture),
			ExpiresAtUnixS: 4102444800,
		},
	}
	if err := config.Save(path, cfg); err != nil {
		t.Fatalf("Save() error = %v", err)
	}
	a := &Agent{cfg: cfg, configPath: path}
	source := &controlArtifactSource{agent: a}
	var _ flowersec.ArtifactSource = source
	if _, sourceErr := source.Acquire(context.Background()); sourceErr != nil {
		t.Fatalf("Acquire() error = %v", sourceErr)
	}
	if err := a.commitControlArtifactSpend(context.Background(), 7, []byte(controlArtifactFixture)); err != nil {
		t.Fatalf("commitControlArtifactSpend() error = %v", err)
	}
	restarted, err := config.Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if restarted.Direct == nil || !restarted.Direct.Spent {
		t.Fatal("control artifact spend was not persisted")
	}
	if _, sourceErr := source.Acquire(context.Background()); sourceErr == nil ||
		sourceErr.RetryDisposition().Kind != flowersec.RetryDispositionTerminal {
		t.Fatalf("Acquire() spent artifact error = %v, want terminal", sourceErr)
	}
}

func TestControlArtifactSpendRejectsStaleBinding(t *testing.T) {
	a := &Agent{cfg: &config.Config{
		BindingGeneration: 8,
		Direct: &config.DirectConnectInfo{
			ArtifactJSON:   []byte(controlArtifactFixture),
			ExpiresAtUnixS: 4102444800,
		},
	}, configPath: filepath.Join(t.TempDir(), "config.json")}
	if err := a.commitControlArtifactSpend(context.Background(), 7, []byte(controlArtifactFixture)); err == nil {
		t.Fatal("commitControlArtifactSpend() error = nil, want stale binding rejection")
	}
}
