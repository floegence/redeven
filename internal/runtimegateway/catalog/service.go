package catalog

import (
	"context"

	"github.com/floegence/redeven/internal/runtimegateway/protocol"
)

type Service struct{}

func NewService() *Service {
	return &Service{}
}

func (s *Service) ListEnvironments(ctx context.Context, _ protocol.CatalogRequest) (protocol.CatalogResponse, error) {
	if err := ctx.Err(); err != nil {
		return protocol.CatalogResponse{}, err
	}
	return protocol.NewCatalogResponse(nil), nil
}
