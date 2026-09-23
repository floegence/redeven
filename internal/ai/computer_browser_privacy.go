package ai

import (
	"context"
	"errors"
	"strings"
)

// Native ancestry and projection privacy share the source owner. Inventories
// cannot reintroduce a private popup through a second workspace or AI discovery.
// The caller holds connectMu, keeping the source owner stable during the query.
func (r *ComputerUseRuntime) browserInventoryPrivacy(ctx context.Context, endpoint string, tabs []ComputerBrowserTab) ([]ComputerBrowserTab, error) {
	if r.browserHost == nil {
		return tabs, nil
	}
	// A Chrome profile can also be reachable through CDP. Refresh the native
	// identities and retained popup ancestry before querying that second path;
	// profile labels and endpoint spelling never define the privacy boundary.
	if !strings.HasPrefix(endpoint, "extension:") {
		r.mu.RLock()
		hub := r.extension
		r.mu.RUnlock()
		var clients []*computerExtensionClient
		if hub != nil {
			hub.mu.Lock()
			for _, client := range hub.profiles {
				clients = append(clients, client)
			}
			hub.mu.Unlock()
		}
		for _, client := range clients {
			inventory, err := client.tabs(ctx)
			if err != nil {
				return nil, err
			}
			if err := r.browserHost.call(ctx, "source.inventory", map[string]any{"endpoint": "extension:" + client.profile.ID, "tabs": inventory}, nil); err != nil {
				if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
					return nil, &TargetStartupError{Code: "TARGET_CONNECTION_REQUIRED", Reason: "browser_connection_failed"}
				}
				return nil, err
			}
		}
	}
	var filtered []ComputerBrowserTab
	if err := r.browserHost.call(ctx, "source.inventory", map[string]any{"endpoint": endpoint, "tabs": tabs}, &filtered); err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return nil, &TargetStartupError{Code: "TARGET_CONNECTION_REQUIRED", Reason: "browser_connection_failed"}
		}
		return nil, err
	}
	return filtered, nil
}
