package catalog

import (
	"context"

	"github.com/floegence/redeven/internal/runtimegateway/protocol"
)

type EnvironmentSource interface {
	ListGatewayEnvironments(ctx context.Context) ([]protocol.Environment, error)
}

type EnvironmentSourceFunc func(ctx context.Context) ([]protocol.Environment, error)

func (fn EnvironmentSourceFunc) ListGatewayEnvironments(ctx context.Context) ([]protocol.Environment, error) {
	return fn(ctx)
}

type Service struct {
	gateway protocol.GatewayMetadata
	source  EnvironmentSource
}

type ServiceOption func(*Service)

func WithGatewayMetadata(gateway protocol.GatewayMetadata) ServiceOption {
	return func(s *Service) {
		s.gateway = gateway
	}
}

func WithEnvironmentSource(source EnvironmentSource) ServiceOption {
	return func(s *Service) {
		s.source = source
	}
}

func NewService(options ...ServiceOption) *Service {
	service := &Service{
		gateway: protocol.GatewayMetadata{
			GatewayID:   "local-runtime-gateway",
			DisplayName: "Redeven Runtime Gateway",
			Status:      protocol.GatewayStatusPairingRequired,
			Capabilities: []protocol.GatewayCapability{
				protocol.GatewayCapabilityEnvCatalog,
				protocol.GatewayCapabilityEnvOpenSession,
			},
		},
	}
	for _, option := range options {
		option(service)
	}
	return service
}

func (s *Service) ListEnvironments(ctx context.Context, req protocol.CatalogRequest) (protocol.CatalogResponse, error) {
	if err := ctx.Err(); err != nil {
		return protocol.CatalogResponse{}, err
	}
	if err := protocol.ValidateProtocolVersion(req.ProtocolVersion); err != nil {
		return protocol.CatalogResponse{}, err
	}
	var environments []protocol.Environment
	if s.source != nil {
		listed, err := s.source.ListGatewayEnvironments(ctx)
		if err != nil {
			return protocol.CatalogResponse{}, err
		}
		environments = listed
	}
	return protocol.NewCatalogResponse(s.gateway, environments), nil
}
