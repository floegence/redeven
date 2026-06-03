package catalog

import (
	"context"
	"testing"

	"github.com/floegence/redeven/internal/runtimegateway/protocol"
)

func TestServiceListEnvironmentsReturnsEmptyCatalog(t *testing.T) {
	resp, err := NewService().ListEnvironments(context.Background(), protocol.CatalogRequest{ProtocolVersion: protocol.Version})
	if err != nil {
		t.Fatalf("ListEnvironments() error = %v", err)
	}
	if resp.ProtocolVersion != protocol.Version {
		t.Fatalf("ProtocolVersion = %q, want %q", resp.ProtocolVersion, protocol.Version)
	}
	if len(resp.Environments) != 0 {
		t.Fatalf("Environments length = %d, want 0", len(resp.Environments))
	}
	if resp.Gateway.GatewayID == "" {
		t.Fatalf("Gateway metadata is empty: %#v", resp.Gateway)
	}
}

func TestServiceListEnvironmentsNormalizesSourceCatalog(t *testing.T) {
	resp, err := NewService(
		WithGatewayMetadata(protocol.GatewayMetadata{
			GatewayID: " gateway_custom ",
			Status:    protocol.GatewayStatusOnline,
		}),
		WithEnvironmentSource(EnvironmentSourceFunc(func(context.Context) ([]protocol.Environment, error) {
			return []protocol.Environment{
				{
					GatewayEnvID: " env_demo ",
					DisplayName:  " Demo ",
					State:        protocol.EnvironmentStateAvailable,
					Capabilities: []protocol.EnvironmentCapability{
						protocol.EnvironmentCapabilityOpen,
						"bad",
					},
				},
			}, nil
		})),
	).ListEnvironments(context.Background(), protocol.CatalogRequest{ProtocolVersion: protocol.Version})
	if err != nil {
		t.Fatalf("ListEnvironments() error = %v", err)
	}
	if resp.Gateway.GatewayID != "gateway_custom" {
		t.Fatalf("GatewayID = %q", resp.Gateway.GatewayID)
	}
	if len(resp.Environments) != 1 {
		t.Fatalf("Environments length = %d, want 1", len(resp.Environments))
	}
	if got := resp.Environments[0].Capabilities; len(got) != 1 || got[0] != protocol.EnvironmentCapabilityOpen {
		t.Fatalf("Capabilities = %#v", got)
	}
}

func TestServiceListEnvironmentsMergesAllSources(t *testing.T) {
	resp, err := NewService(
		WithEnvironmentSource(EnvironmentSourceFunc(func(context.Context) ([]protocol.Environment, error) {
			return []protocol.Environment{{
				GatewayEnvID:       "env_local",
				DisplayName:        "Local",
				AccessCapabilities: []protocol.EnvironmentCapability{protocol.EnvironmentCapabilityOpen},
			}}, nil
		})),
		WithEnvironmentSource(EnvironmentSourceFunc(func(context.Context) ([]protocol.Environment, error) {
			return []protocol.Environment{{
				GatewayEnvID:       "env_profile",
				DisplayName:        "Profile",
				AccessCapabilities: []protocol.EnvironmentCapability{protocol.EnvironmentCapabilityOpen},
			}}, nil
		})),
	).ListEnvironments(context.Background(), protocol.CatalogRequest{ProtocolVersion: protocol.Version})
	if err != nil {
		t.Fatalf("ListEnvironments() error = %v", err)
	}
	if len(resp.Environments) != 2 {
		t.Fatalf("Environments length = %d, want 2: %#v", len(resp.Environments), resp.Environments)
	}
	if resp.Environments[0].GatewayEnvID != "env_local" || resp.Environments[1].GatewayEnvID != "env_profile" {
		t.Fatalf("Environments = %#v", resp.Environments)
	}
}

func TestServiceListEnvironmentsRejectsUnsupportedProtocolVersion(t *testing.T) {
	_, err := NewService().ListEnvironments(context.Background(), protocol.CatalogRequest{ProtocolVersion: "v0"})
	if err != protocol.ErrUnsupportedProtocolVersion {
		t.Fatalf("ListEnvironments() error = %v, want %v", err, protocol.ErrUnsupportedProtocolVersion)
	}
}
