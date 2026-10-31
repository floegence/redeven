package codeapp

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/floegence/redeven/internal/redevpluginintegration"
	"github.com/floegence/redevplugin/v3/pkg/mutation"
	"github.com/floegence/redevplugin/v3/pkg/security"
)

// Plugin readiness never gates the host product indefinitely. Initialization
// owns its result until the host accepts it; a canceled or late result is closed.
const pluginInitializationTimeout = 10 * time.Second

func openPluginIntegration(ctx context.Context, open func(context.Context) (*redevpluginintegration.Integration, error)) (*redevpluginintegration.Integration, error) {
	startupCtx, cancel := context.WithTimeout(ctx, pluginInitializationTimeout)
	defer cancel()
	if err := startupCtx.Err(); err != nil {
		return nil, err
	}
	type result struct {
		integration *redevpluginintegration.Integration
		err         error
	}
	completed := make(chan result)
	go func() {
		value, err := constructPluginIntegration(startupCtx, open)
		select {
		case completed <- result{value, err}:
		case <-startupCtx.Done():
			_ = value.Close()
		}
	}()
	select {
	case value := <-completed:
		return value.integration, value.err
	case <-startupCtx.Done():
		return nil, startupCtx.Err()
	}
}

func constructPluginIntegration(ctx context.Context, open func(context.Context) (*redevpluginintegration.Integration, error)) (integration *redevpluginintegration.Integration, err error) {
	defer func() {
		if failure := recover(); failure != nil {
			integration = nil
			err = fmt.Errorf("plugin initialization panic: %v", failure)
		}
	}()
	return open(ctx)
}

func pluginPlatformHandler(integration *redevpluginintegration.Integration) http.Handler {
	if integration != nil {
		return integration.Handler()
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Reuse the published failure contract, before dispatching any effect.
		failure := map[string]any{
			"code":    security.ErrRuntimeUnavailable,
			"message": "Plugin services are unavailable. Other Runtime features remain available.",
			"details": map[string]any{},
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			failure["mutation_outcome"] = mutation.OutcomeNotCommitted
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": failure})
	})
}

func pluginWebSurfaceHandler(integration *redevpluginintegration.Integration) http.Handler {
	if integration != nil {
		return integration.WebSurfaceHandler()
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		http.Error(w, "Plugin services are unavailable.", http.StatusServiceUnavailable)
	})
}
