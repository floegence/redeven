package managedwebservice

import (
	"context"
	"path/filepath"

	"github.com/floegence/redeven/internal/templatemarket"
)

type TemplateMarketBackend interface {
	TemplateMarket(context.Context, bool) (templatemarket.Snapshot, error)
}

func (m *Manager) TemplateMarket(ctx context.Context, refresh bool) (templatemarket.Snapshot, error) {
	m.mu.Lock()
	if m.templateMarket == nil {
		m.templateMarket = &templatemarket.Service{Path: filepath.Join(m.stateDir, "template-market.json"), Client: m.downloads.packageHTTPClient()}
	}
	service := m.templateMarket
	m.mu.Unlock()
	if !refresh {
		return service.Cached(), nil
	}
	result, err := service.Refresh(ctx)
	if err != nil {
		return result, serviceError("TEMPLATE_MARKET_UNAVAILABLE", "The template market could not be refreshed. Saved templates remain available.", 503, true, err)
	}
	return result, nil
}
