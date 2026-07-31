package appserver

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/filesystemscope"
)

type AIReadinessState string

const (
	AIReadinessUnavailable AIReadinessState = "unavailable"
	AIReadinessInspecting  AIReadinessState = "inspecting"
	AIReadinessMigrating   AIReadinessState = "migrating"
	AIReadinessVerifying   AIReadinessState = "verifying"
	AIReadinessReady       AIReadinessState = "ready"
	AIReadinessDegraded    AIReadinessState = "degraded"
	AIReadinessBlocked     AIReadinessState = "blocked"
)

const (
	AIServiceUnavailableErrorCode         = "AI_SERVICE_UNAVAILABLE"
	AIReadinessContractErrorReasonCode    = "ai_readiness_contract_error"
	AIServiceStartupErrorReasonCode       = "ai_service_startup_error"
	AIHostThreadSettingsMissingReasonCode = "host_thread_settings_missing"
)

var (
	ErrAIServiceUnavailable = errors.New("AI service is unavailable")
	ErrAIRetryInProgress    = errors.New("AI readiness check is already in progress")
)

// AIReadinessSnapshot contains only Redeven-owned, sanitized availability
// facts. It must never contain Floret Store or Agent snapshots.
type AIReadinessSnapshot struct {
	State       AIReadinessState `json:"state"`
	ReasonCode  string           `json:"reason_code,omitempty"`
	Retryable   bool             `json:"retryable"`
	SafeToRetry bool             `json:"safe_to_retry"`
	Committed   bool             `json:"committed"`
	RolledBack  bool             `json:"rolled_back"`
	IssueCount  int              `json:"issue_count,omitempty"`
}

// AIServiceStartupOptions contains the Redeven-owned inputs that may change
// between service generations. It carries no Store or Agent lifecycle state.
type AIServiceStartupOptions struct {
	Config          *config.AIConfig
	AgentHomeDir    string
	Shell           string
	FilesystemScope *filesystemscope.Registry
}

type AIServiceProvider interface {
	AcquireAIService(context.Context) (*ai.Service, context.Context, uint64, func(), error)
	AIReadiness() AIReadinessSnapshot
	RetryAIReadiness() error
	UpdateAIServiceStartupOptions(AIServiceStartupOptions)
}

type AIOrphanRootMaintenanceProvider interface {
	ReviewOrphanCanonicalRoots(context.Context) (ai.OrphanCanonicalRootReview, error)
	AdoptOrphanCanonicalRoot(context.Context, ai.AdoptOrphanCanonicalRootRequest) (int, error)
	DeleteOrphanCanonicalRoot(context.Context, ai.DeleteOrphanCanonicalRootRequest) (int, error)
}

type aiServiceContextKey struct{}
type aiServiceAcquireHookKey struct{}

func withAIService(ctx context.Context, service *ai.Service) context.Context {
	return context.WithValue(ctx, aiServiceContextKey{}, service)
}

func aiServiceFromContext(ctx context.Context) *ai.Service {
	if ctx == nil {
		return nil
	}
	service, _ := ctx.Value(aiServiceContextKey{}).(*ai.Service)
	return service
}

func withAIServiceAcquireHook(ctx context.Context, acquire func()) context.Context {
	return context.WithValue(ctx, aiServiceAcquireHookKey{}, acquire)
}

func acquireAIServiceAfterPermission(ctx context.Context) {
	if ctx == nil {
		return
	}
	acquire, _ := ctx.Value(aiServiceAcquireHookKey{}).(func())
	if acquire != nil {
		acquire()
	}
}

func routeUsesAIService(r *http.Request) bool {
	if r == nil || r.URL == nil {
		return false
	}
	path := strings.TrimSpace(r.URL.Path)
	if !strings.HasPrefix(path, "/_redeven_proxy/api/ai/") {
		return false
	}
	switch path {
	case "/_redeven_proxy/api/ai/readiness",
		"/_redeven_proxy/api/ai/readiness/retry",
		"/_redeven_proxy/api/ai/maintenance/orphan_roots",
		"/_redeven_proxy/api/ai/maintenance/orphan_roots/adopt",
		"/_redeven_proxy/api/ai/maintenance/orphan_roots/delete",
		"/_redeven_proxy/api/ai/provider_keys/status",
		"/_redeven_proxy/api/ai/provider_keys",
		"/_redeven_proxy/api/ai/web_search_provider_keys/status",
		"/_redeven_proxy/api/ai/web_search_provider_keys":
		return false
	default:
		return true
	}
}

func routeRequiresAIService(r *http.Request) bool {
	return routeUsesAIService(r)
}

func writeAIServiceUnavailable(w http.ResponseWriter, snapshot AIReadinessSnapshot) {
	writeJSON(w, http.StatusServiceUnavailable, apiResp{
		OK:        false,
		Error:     ErrAIServiceUnavailable.Error(),
		ErrorCode: AIServiceUnavailableErrorCode,
		Data:      map[string]any{"readiness": snapshot},
	})
}

func (g *Server) aiReadinessSnapshot() AIReadinessSnapshot {
	if g == nil || g.aiProvider == nil {
		return AIReadinessSnapshot{State: AIReadinessUnavailable}
	}
	return sanitizeAIReadinessSnapshot(g.aiProvider.AIReadiness())
}

func sanitizeAIReadinessSnapshot(snapshot AIReadinessSnapshot) AIReadinessSnapshot {
	switch snapshot.State {
	case AIReadinessUnavailable, AIReadinessInspecting, AIReadinessMigrating, AIReadinessVerifying:
		return AIReadinessSnapshot{State: snapshot.State}
	case AIReadinessReady:
		return AIReadinessSnapshot{State: AIReadinessReady}
	case AIReadinessDegraded:
		if strings.TrimSpace(snapshot.ReasonCode) != AIHostThreadSettingsMissingReasonCode || snapshot.IssueCount <= 0 ||
			snapshot.Retryable || snapshot.SafeToRetry || snapshot.Committed || snapshot.RolledBack {
			return AIReadinessSnapshot{State: AIReadinessBlocked, ReasonCode: AIReadinessContractErrorReasonCode}
		}
		return AIReadinessSnapshot{State: AIReadinessDegraded, ReasonCode: AIHostThreadSettingsMissingReasonCode, IssueCount: snapshot.IssueCount}
	case AIReadinessBlocked:
		if !knownAIReadinessReasonCode(snapshot.ReasonCode) {
			return AIReadinessSnapshot{State: AIReadinessBlocked, ReasonCode: AIReadinessContractErrorReasonCode}
		}
		snapshot.ReasonCode = strings.TrimSpace(snapshot.ReasonCode)
		return snapshot
	default:
		return AIReadinessSnapshot{State: AIReadinessBlocked, ReasonCode: AIReadinessContractErrorReasonCode}
	}
}

func knownAIReadinessReasonCode(code string) bool {
	switch strings.TrimSpace(code) {
	case string(ai.FloretStoreStartupTemporarilyBlocked),
		string(ai.FloretStoreStartupUpdateRequired),
		string(ai.FloretStoreStartupUnsupportedStore),
		string(ai.FloretStoreStartupIntegrityError),
		string(ai.FloretStoreStartupEnvironmentPermissionError),
		string(ai.FloretStoreStartupIOError),
		string(ai.FloretStoreStartupCancelled),
		string(ai.FloretStoreStartupContractError),
		AIServiceStartupErrorReasonCode,
		AIReadinessContractErrorReasonCode:
		return true
	default:
		return false
	}
}

func (g *Server) requireAIService(w http.ResponseWriter, service *ai.Service) bool {
	if service != nil {
		return true
	}
	snapshot := g.aiReadinessSnapshot()
	if snapshot.State == AIReadinessReady || snapshot.State == AIReadinessDegraded {
		snapshot = AIReadinessSnapshot{State: AIReadinessBlocked, ReasonCode: AIReadinessContractErrorReasonCode}
	}
	writeAIServiceUnavailable(w, snapshot)
	return false
}
