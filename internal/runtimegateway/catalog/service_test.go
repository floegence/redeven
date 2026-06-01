package catalog

import (
	"context"
	"testing"

	"github.com/floegence/redeven/internal/runtimegateway/protocol"
)

func TestServiceListEnvironmentsReturnsEmptyCatalog(t *testing.T) {
	resp, err := NewService().ListEnvironments(context.Background(), protocol.CatalogRequest{})
	if err != nil {
		t.Fatalf("ListEnvironments() error = %v", err)
	}
	if resp.ProtocolVersion != protocol.Version {
		t.Fatalf("ProtocolVersion = %q, want %q", resp.ProtocolVersion, protocol.Version)
	}
	if len(resp.Environments) != 0 {
		t.Fatalf("Environments length = %d, want 0", len(resp.Environments))
	}
}
