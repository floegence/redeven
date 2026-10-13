package ai

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/floegence/redeven/internal/config"
)

type catalogConnection struct {
	provider      config.AIProvider
	key, identity string
	next          time.Time
	failures      int
}
type catalogFlight struct {
	identity string
	done     chan struct{}
	result   ModelCatalogResponse
	err      error
}

// The Runtime is the sole inventory writer. User preferences and active runs
// are never mutated by this owner. Network work has no role in resolve.
type modelCatalogManager struct {
	mu          sync.Mutex
	root        string
	resolveKey  func(string) (string, bool, error)
	discover    func(context.Context, ModelCatalogRequest) (ModelCatalogResponse, error)
	changed     func()
	connections map[string]catalogConnection
	snapshots   map[string][]config.AIProviderModel
	flights     map[string]*catalogFlight
	slots       chan struct{}
	kick        chan struct{}
	autoUpdate  bool
}

func newModelCatalogManager(root string, resolveKey func(string) (string, bool, error), discover func(context.Context, ModelCatalogRequest) (ModelCatalogResponse, error), changed func()) *modelCatalogManager {
	return &modelCatalogManager{root: root, resolveKey: resolveKey, discover: discover, changed: changed, connections: map[string]catalogConnection{}, snapshots: map[string][]config.AIProviderModel{}, flights: map[string]*catalogFlight{}, slots: make(chan struct{}, 4), kick: make(chan struct{}, 1)}
}

func providerCatalogRequest(p config.AIProvider, key string) ModelCatalogRequest {
	return ModelCatalogRequest{ProviderID: p.ID, Type: p.Type, BaseURL: p.BaseURL, AuthMethod: p.EffectiveAuthMethod(), AccountID: p.AccountID, APIKey: key}
}
func catalogRequestIdentity(in ModelCatalogRequest) string {
	return config.ModelCatalogIdentity(config.AIProvider{ID: in.ProviderID, Type: in.Type, BaseURL: in.BaseURL, AuthMethod: in.AuthMethod, AccountID: in.AccountID}, in.APIKey)
}
func (m *modelCatalogManager) wake() {
	select {
	case m.kick <- struct{}{}:
	default:
	}
}
func (m *modelCatalogManager) configure(cfg *config.AIConfig) {
	if m == nil {
		return
	}
	next := map[string]catalogConnection{}
	if cfg != nil {
		for _, p := range cfg.Providers {
			key := ""
			if m.resolveKey != nil && p.EffectiveAuthMethod() != config.AIAuthChatGPT {
				var err error
				key, _, err = m.resolveKey(p.ID)
				if err != nil {
					continue
				}
			}
			identity := config.ModelCatalogIdentity(p, key)
			next[p.ID] = catalogConnection{provider: p, key: key, identity: identity}
		}
	}
	m.mu.Lock()
	retained := map[string][]config.AIProviderModel{}
	for id, c := range next {
		if old, ok := m.connections[id]; ok && old.identity == c.identity {
			c.next, c.failures = old.next, old.failures
		}
		next[id] = c
		if models, ok := m.snapshots[c.identity]; ok {
			retained[c.identity] = models
		} else {
			if models, err := config.ReadModelCatalogSnapshot(m.root, c.identity); err == nil {
				retained[c.identity] = models
			}
		}
	}
	m.snapshots = retained
	m.connections = next
	m.autoUpdate = cfg != nil && cfg.IsAutoUpdateModelCatalogEnabled()
	m.mu.Unlock()
	m.wake()
}
func (m *modelCatalogManager) resolve(cfg *config.AIConfig) *config.AIConfig {
	if m == nil || cfg == nil {
		return cfg
	}
	next := *cfg
	next.Providers = append([]config.AIProvider(nil), cfg.Providers...)
	for i, p := range next.Providers {
		if p.Type == platformGatewayProviderType {
			continue
		}
		m.mu.Lock()
		connection, configured := m.connections[p.ID]
		models, ok := m.snapshots[connection.identity]
		m.mu.Unlock()
		if ok && configured && config.ModelCatalogIdentity(p, connection.key) == connection.identity {
			next.Providers[i] = p.WithDiscoveredModels(models)
		}
	}
	return &next
}
func (m *modelCatalogManager) sync(ctx context.Context, in ModelCatalogRequest) (ModelCatalogResponse, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	identity := catalogRequestIdentity(in)
	for {
		m.mu.Lock()
		if active := m.flights[in.ProviderID]; active != nil {
			m.mu.Unlock()
			select {
			case <-ctx.Done():
				return ModelCatalogResponse{}, ctx.Err()
			case <-active.done:
			}
			if active.identity == identity {
				return active.result, active.err
			}
			continue
		}
		flight := &catalogFlight{identity: identity, done: make(chan struct{})}
		m.flights[in.ProviderID] = flight
		connection, configured := m.connections[in.ProviderID]
		owned := configured && connection.identity == identity
		m.mu.Unlock()
		var result ModelCatalogResponse
		var err error
		select {
		case m.slots <- struct{}{}:
			result, err = m.discover(ctx, in)
			<-m.slots
		case <-ctx.Done():
			err = ctx.Err()
		}
		if err == nil {
			err = ctx.Err()
		}
		if err == nil && result.Models == nil {
			err = errors.New("incomplete model catalog response")
		}
		models := make([]config.AIProviderModel, 0, len(result.Models))
		for _, model := range result.Models {
			models = append(models, model.AIProviderModel)
		}
		if err == nil {
			err = config.ValidateModelCatalogSnapshot(models)
		}
		changed := false
		m.mu.Lock()
		current, exists := m.connections[in.ProviderID]
		if owned && (!exists || current.identity != identity) {
			err = errors.New("provider connection changed during model synchronization")
		}
		if err == nil && catalogEndpointSupported(in) {
			// A successful draft sync is saved under its connection identity too.
			// Saving that connection subsequently loads this file without a second request.
			err = config.WriteModelCatalogSnapshot(m.root, identity, models)
			if err == nil && exists && current.identity == identity {
				before, _ := json.Marshal(m.snapshots[identity])
				after, _ := json.Marshal(models)
				changed = string(before) != string(after)
				m.snapshots[identity] = (config.AIProvider{Models: models}).CatalogModels()
			}
		}
		if owned && exists && current.identity == identity {
			if err == nil {
				current.failures = 0
				current.next = time.Now().Add(15 * time.Minute)
			} else {
				delays := []time.Duration{time.Minute, 5 * time.Minute, 15 * time.Minute}
				current.next = time.Now().Add(delays[min(current.failures, len(delays)-1)])
				current.failures++
			}
			m.connections[in.ProviderID] = current
		}
		flight.result, flight.err = result, err
		delete(m.flights, in.ProviderID)
		close(flight.done)
		m.mu.Unlock()
		if changed && m.changed != nil {
			m.changed()
		}
		m.wake()
		return result, err
	}
}
func (m *modelCatalogManager) run(ctx context.Context) {
	var workers sync.WaitGroup
	defer workers.Wait()
	timer := time.NewTimer(0)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-m.kick:
		case <-timer.C:
		}
		m.mu.Lock()
		if !m.autoUpdate {
			m.mu.Unlock()
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			continue
		}
		now := time.Now()
		delay := 15 * time.Minute
		for id, c := range m.connections {
			if !c.provider.IsEnabled() || !catalogEndpointSupported(providerCatalogRequest(c.provider, c.key)) {
				continue
			}
			if m.flights[id] != nil {
				continue
			}
			if !c.next.After(now) {
				// Reserve the scheduler deadline before releasing its lock. sync owns the flight.
				c.next = now.Add(30 * time.Second)
				m.connections[id] = c
				workers.Add(1)
				go func(c catalogConnection) {
					defer workers.Done()
					_, _ = m.sync(ctx, providerCatalogRequest(c.provider, c.key))
				}(c)
			}
			delay = min(delay, max(time.Second, time.Until(c.next)))
		}
		m.mu.Unlock()
		if !timer.Stop() {
			select {
			case <-timer.C:
			default:
			}
		}
		timer.Reset(delay)
	}
}
