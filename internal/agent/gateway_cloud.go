package agent

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/floegence/flowersec/flowersec-go/v5/egress"
	"github.com/floegence/redeven/internal/config"
)

func gatewayProxy(cfg *config.Config) (*egress.HTTPSProxy, error) {
	if cfg == nil {
		return nil, errors.New("missing runtime configuration")
	}
	if cfg.CloudAssociation == nil {
		return nil, nil
	}
	return cfg.CloudProxy()
}

// platformHTTPTransport reads the current explicit route for every official AI request.
func (a *Agent) platformHTTPTransport() (http.RoundTripper, error) {
	proxy, err := gatewayProxy(a.remoteConfigSnapshot())
	if err != nil {
		return nil, err
	}
	if proxy == nil {
		return &http.Transport{ResponseHeaderTimeout: 5 * time.Minute, IdleConnTimeout: 60 * time.Second}, nil
	}
	transport := proxy.HTTPTransport()
	transport.ResponseHeaderTimeout = 5 * time.Minute
	return transport, nil
}

// closeCloudSessions leaves local access and newer generations running. A
// receipt is emitted only after canceled sessions have left the registry.
func (a *Agent) closeCloudSessions(bindingID string, generation int64) bool {
	a.mu.Lock()
	pending := false
	var cancels []context.CancelFunc
	for _, session := range a.sessions {
		if session == nil || session.cloudBindingPublicID != bindingID || session.cloudBindingGeneration > generation {
			continue
		}
		pending = true
		if session.cancel != nil {
			cancels = append(cancels, session.cancel)
		}
	}
	a.mu.Unlock()
	for _, cancel := range cancels {
		cancel()
	}
	return !pending
}
