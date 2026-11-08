package appserver

import (
	"github.com/floegence/redeven/internal/session"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestStorageInventoryRequiresAdminAndNeverOpensFlower(t *testing.T) {
	provider := &controlledAIServiceProvider{snapshot: AIReadinessSnapshot{State: AIReadinessBlocked}}
	admin, origin := newAIReadinessTestServer(t, provider, session.Meta{CanRead: true, CanAdmin: true})
	admin.stateDir = t.TempDir()
	os.WriteFile(filepath.Join(admin.stateDir, "secrets.json"), []byte("never disclose secret bytes"), 0600)
	response := serveAIReadinessTestRequest(admin, origin, http.MethodGet, "/_redeven_proxy/api/storage", nil)
	if response.Code != http.StatusOK || strings.Contains(response.Body.String(), "never disclose") || response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("%d %s", response.Code, response.Body.String())
	}
	reader, readerOrigin := newAIReadinessTestServer(t, provider, session.Meta{CanRead: true})
	denied := serveAIReadinessTestRequest(reader, readerOrigin, http.MethodGet, "/_redeven_proxy/api/storage", nil)
	if denied.Code != http.StatusForbidden {
		t.Fatal(denied.Code)
	}
	if acquires, _, _ := provider.counts(); acquires != 0 {
		t.Fatal("storage inspection opened Flower")
	}
}
