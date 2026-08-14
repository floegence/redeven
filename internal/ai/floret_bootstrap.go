package ai

import (
	"context"
	"errors"
	"strings"
	"sync"

	"github.com/floegence/floret/v4/identity"
	flruntime "github.com/floegence/floret/v4/runtime"
	"github.com/floegence/redeven/internal/session"
)

// floretBootstrapResult contains the only two Floret runtime boundaries used
// by Redeven: the typed thread service and its product effect adapter.
type floretBootstrapResult struct {
	close         func() error
	threadRuntime flruntime.ThreadService
	effects       *floretEffectAdapter
}

// floretEffectAdapter is a short-lived command inbox, not lifecycle state. A
// runtime execution consumes one original product request by request key;
// Floret remains the sole owner of thread and turn state.
type floretEffectAdapter struct {
	mu      sync.Mutex
	service *Service
	pending map[string]floretEffectRequest
}

type floretEffectRequest struct {
	meta   session.Meta
	req    SendUserTurnRequest
	effect *threadEffect
	agent  *flruntime.Agent
}

func newFloretEffectAdapter() *floretEffectAdapter {
	return &floretEffectAdapter{pending: make(map[string]floretEffectRequest)}
}

func floretEffectRequestKey(threadID identity.ThreadID, requestKey string) string {
	return threadID.String() + "\x00" + strings.TrimSpace(requestKey)
}

func (adapter *floretEffectAdapter) bind(service *Service) {
	adapter.mu.Lock()
	adapter.service = service
	adapter.mu.Unlock()
}

func (adapter *floretEffectAdapter) put(threadID identity.ThreadID, requestKey string, request floretEffectRequest) {
	adapter.mu.Lock()
	adapter.pending[floretEffectRequestKey(threadID, requestKey)] = request
	adapter.mu.Unlock()
}

func (adapter *floretEffectAdapter) drop(threadID identity.ThreadID, requestKey string) {
	adapter.mu.Lock()
	delete(adapter.pending, floretEffectRequestKey(threadID, requestKey))
	adapter.mu.Unlock()
}

func (adapter *floretEffectAdapter) Agent(ctx context.Context, request flruntime.AgentRequest) (*flruntime.Agent, error) {
	key := floretEffectRequestKey(request.ThreadID, request.RequestKey)
	adapter.mu.Lock()
	pending, ok := adapter.pending[key]
	if ok {
		delete(adapter.pending, key)
	}
	service := adapter.service
	adapter.mu.Unlock()
	if service == nil {
		return nil, errors.New("Flower thread effect request is unavailable")
	}
	if !ok {
		var err error
		pending, err = service.restoreFloretEffectRequest(ctx, request)
		if err != nil {
			return nil, err
		}
	}
	if pending.agent != nil {
		return pending.agent, nil
	}
	effect := pending.effect
	var err error
	if effect == nil {
		effect, err = service.prepareThreadEffect(&pending.meta, request.RequestKey, RunStartRequest{
			ThreadID: request.ThreadID.String(), Model: pending.req.Model, Input: pending.req.Input,
			Options: pending.req.Options, StagingScopeID: pending.req.StagingScopeID,
			StagingCapability: pending.req.StagingCapability,
		})
	}
	if err != nil {
		return nil, err
	}
	if effect != nil && effect.builder != nil {
		effect.builder.threadID = request.ThreadID.String()
		effect.builder.turnID = request.TurnID.String()
		effect.builder.messageID = request.TurnID.String()
	}
	return service.buildThreadEffectAgent(ctx, effect)
}

func (s *Service) restoreFloretEffectRequest(ctx context.Context, request flruntime.AgentRequest) (floretEffectRequest, error) {
	if s == nil || s.threadsDB == nil {
		return floretEffectRequest{}, errors.New("Flower thread catalog is unavailable")
	}
	settings, err := s.threadsDB.GetThreadSettingsByCanonicalThreadID(ctxOrBackground(ctx), request.ThreadID.String())
	if err != nil {
		return floretEffectRequest{}, err
	}
	if settings == nil {
		return floretEffectRequest{}, errors.New("Flower thread is not present in the product catalog")
	}
	permission, err := threadPermissionType(settings)
	if err != nil {
		return floretEffectRequest{}, err
	}
	meta := session.Meta{
		ChannelID: "runtime:" + strings.TrimSpace(settings.EndpointID), EndpointID: strings.TrimSpace(settings.EndpointID),
		NamespacePublicID: strings.TrimSpace(settings.NamespacePublicID), UserPublicID: strings.TrimSpace(settings.CreatedByUserPublicID),
		UserEmail: strings.TrimSpace(settings.CreatedByUserEmail), CanRead: true,
		CanWrite: permission != FlowerPermissionReadonly, CanExecute: permission != FlowerPermissionReadonly,
	}
	return floretEffectRequest{meta: meta, req: SendUserTurnRequest{
		ClientRequestID: request.RequestKey, ThreadID: request.ThreadID.String(), Model: settings.ModelID,
		Input: RunInput{Text: request.Input.Text},
	}}, nil
}

func configureFloretRuntime(host *flruntime.Host) (*floretBootstrapResult, error) {
	if host == nil {
		return nil, errors.New("Floret runtime Host is required")
	}
	effects := newFloretEffectAdapter()
	threadRuntime, err := host.ThreadService(effects)
	if err != nil {
		return nil, err
	}
	return &floretBootstrapResult{
		close:         func() error { return host.Shutdown(context.Background()) },
		threadRuntime: threadRuntime,
		effects:       effects,
	}, nil
}

func newFloretBootstrapResult(host *flruntime.Host) (*floretBootstrapResult, error) {
	return configureFloretRuntime(host)
}

func openFloretRuntime(ctx context.Context, storePath string, progress func(FloretStoreStartupPhase)) (*floretBootstrapResult, error) {
	return openFloretRuntimeWith(ctx, storePath, progress, flruntime.Open)
}

func openFloretRuntimeWith(ctx context.Context, storePath string, progress func(FloretStoreStartupPhase), open floretRuntimeOpener) (*floretBootstrapResult, error) {
	host, err := openFloretHost(ctx, storePath, progress, open)
	if err != nil {
		return nil, err
	}
	result, err := configureFloretRuntime(host)
	if err != nil {
		_ = host.Shutdown(context.Background())
		return nil, err
	}
	return result, nil
}
