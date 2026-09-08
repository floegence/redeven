package appserver

import (
	"context"
	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/session"
	"net/http"
	"testing"
)

type storageMaintenanceTestProvider struct {
	*controlledAIServiceProvider
	restores []string
}

func (p *storageMaintenanceTestProvider) ListFlowerSnapshots(context.Context) ([]ai.FlowerSnapshotSummary, error) {
	return []ai.FlowerSnapshotSummary{}, nil
}
func (p *storageMaintenanceTestProvider) RestoreFlowerSnapshot(id string) error {
	p.restores = append(p.restores, id)
	return nil
}

func TestFlowerRestoreRequiresAdministratorAndExactConfirmationWhileBlocked(t *testing.T) {
	provider := &storageMaintenanceTestProvider{controlledAIServiceProvider: &controlledAIServiceProvider{snapshot: AIReadinessSnapshot{State: AIReadinessBlocked, ReasonCode: "store_integrity_error"}}}
	admin, origin := newAIReadinessTestServer(t, provider, session.Meta{CanRead: true, CanAdmin: true})
	const endpoint = "/_redeven_proxy/api/ai/maintenance/restore"
	for _, body := range []string{
		`{"snapshot_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}`,
		`{"snapshot_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","confirmed":false}`,
		`{"snapshot_id":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","confirmed":true}`,
		`{"snapshot_id":"../../outside","confirmed":true}`,
		`{"snapshot_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","confirmed":true,"extra":1}`,
		`{"snapshot_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","confirmed":true} {}`,
	} {
		res := serveAIReadinessTestRequest(admin, origin, http.MethodPost, endpoint, []byte(body))
		if res.Code != http.StatusBadRequest {
			t.Fatalf("status=%d body=%s", res.Code, res.Body.String())
		}
	}
	reader, readerOrigin := newAIReadinessTestServer(t, provider, session.Meta{CanRead: true, CanWrite: true, CanExecute: true})
	const confirmed = `{"snapshot_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","confirmed":true}`
	denied := serveAIReadinessTestRequest(reader, readerOrigin, http.MethodPost, endpoint, []byte(confirmed))
	if denied.Code != http.StatusForbidden || len(provider.restores) != 0 {
		t.Fatalf("permission bypass: status=%d restores=%v", denied.Code, provider.restores)
	}
	res := serveAIReadinessTestRequest(admin, origin, http.MethodPost, endpoint, []byte(confirmed))
	if res.Code != http.StatusAccepted || len(provider.restores) != 1 {
		t.Fatalf("restore: status=%d body=%s", res.Code, res.Body.String())
	}
	res = serveAIReadinessTestRequest(admin, origin, http.MethodGet, "/_redeven_proxy/api/ai/maintenance/snapshots", nil)
	if res.Code != http.StatusOK {
		t.Fatalf("blocked backup listing=%d %s", res.Code, res.Body.String())
	}
	if acquires, _, _ := provider.counts(); acquires != 0 {
		t.Fatal("maintenance tried opening the blocked generation")
	}
}
