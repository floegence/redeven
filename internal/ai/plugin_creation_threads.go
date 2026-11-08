package ai

import (
	"context"

	"github.com/floegence/redeven/internal/ai/threadstore"
)

// Sidebar membership is product policy, derived only from durable project
// ownership. It never changes canonical conversation or runtime authority.
func (s *Service) ordinaryThreadSettings(ctx context.Context, list []threadstore.ThreadSettings) ([]threadstore.ThreadSettings, error) {
	if len(list) == 0 {
		return list, nil
	}
	byEndpoint := make(map[string][]string)
	for _, item := range list {
		byEndpoint[item.EndpointID] = append(byEndpoint[item.EndpointID], item.ThreadID)
	}
	managed := make(map[string]bool)
	for endpoint, ids := range byEndpoint {
		if s.pluginCreation == nil {
			break
		}
		owned, err := s.pluginCreation.Store.ManagedThreadIDs(ctx, endpoint, ids)
		if err != nil {
			return nil, err
		}
		for id := range owned {
			managed[id] = true
		}
	}
	out := make([]threadstore.ThreadSettings, 0, len(list))
	for _, item := range list {
		canvasID, err := s.tessivenThreadCanvas(ctx, item.ThreadID)
		if err != nil {
			return nil, err
		}
		if !managed[item.ThreadID] && canvasID == "" {
			out = append(out, item)
		}
	}
	return out, nil
}
