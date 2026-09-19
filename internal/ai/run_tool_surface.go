package ai

import (
	"context"
	"fmt"
	"strings"

	flprovider "github.com/floegence/floret/v7/provider"
	flruntime "github.com/floegence/floret/v7/runtime"
	fltools "github.com/floegence/floret/v7/tools"
)

type runToolSurface struct {
	PermissionType     FlowerPermissionType
	PermissionSnapshot PermissionSnapshot
	CapabilityContract runCapabilityContract
	FloretToolItems    []fltools.Tool
	HostedTools        []flprovider.HostedToolDefinition
	SystemPrompt       string
	HostContext        map[string]string
}

type runToolSurfaceConfig struct {
	State                          *floretToolRuntimeState
	HostLabels                     map[string]string
	SupportsAskUserQuestionBatches bool
	InitialProviderSurface         *flruntime.ProviderToolSurface
}

func (r *run) buildRunToolSurfaceConfig(capabilitySupportsAskUserBatches bool, state *floretToolRuntimeState, hostLabels map[string]string) runToolSurfaceConfig {
	return runToolSurfaceConfig{
		State:                          state,
		HostLabels:                     cloneStringMap(hostLabels),
		SupportsAskUserQuestionBatches: capabilitySupportsAskUserBatches,
	}
}

// One surface is selected before each provider request or tool authorization batch.
// It remains stable until all invocations in that batch finish.
func (r *run) buildRunToolSurface(cfg runToolSurfaceConfig, permissionType FlowerPermissionType) (runToolSurface, error) {
	if r == nil {
		return runToolSurface{}, fmt.Errorf("nil run")
	}
	registry := NewInMemoryToolRegistry()
	if err := registerBuiltInTools(registry, r); err != nil {
		return runToolSurface{}, err
	}
	permissionFilter := newPermissionToolFilter(!r.noUserInteraction)
	permissionFilter = r.withToolAllowlistFilter(permissionFilter)
	activeTools := permissionFilter.FilterTools(permissionType, registry.Snapshot())
	activeSignals := permissionFilter.FilterTools(permissionType, builtInControlSignalDefinitions())
	permissionSnapshot := buildPermissionSnapshot(permissionType, activeTools, activeSignals)
	if err := validatePermissionSnapshotConsistency(permissionSnapshot); err != nil {
		return runToolSurface{}, err
	}
	permissionSnapshot, err := r.freezePermissionSnapshot(permissionSnapshot)
	if err != nil {
		return runToolSurface{}, err
	}
	activeTools = filterToolsByNames(activeTools, permissionSnapshot.FloretToolNames)
	activeSignals = filterToolsByNames(activeSignals, permissionSnapshot.PromptCapabilityNames)
	var hosted []flprovider.HostedToolDefinition
	_, searchAllowed := r.toolAllowlist["web_search"]
	if r.webSearch.HostedTool() && (len(r.toolAllowlist) == 0 || searchAllowed) {
		hosted = []flprovider.HostedToolDefinition{{Name: "web_search", Type: "web_search", Options: map[string]any{"wire_shape": r.webSearch.Mode}}}
	}
	if cfg.InitialProviderSurface != nil {
		// Search configuration retains its Turn boundary independently of live
		// permission policy, including when an interaction resumes after restart.
		hosted = cfg.InitialProviderSurface.HostedToolDefinitions
	}
	capabilityContract := resolveRunCapabilityContract(r, activeTools, activeSignals, cfg.SupportsAskUserQuestionBatches, hosted...)
	floretToolItems, err := buildFloretTools(r, activeTools, cfg.State)
	if err != nil {
		return runToolSurface{}, err
	}
	systemPrompt := r.buildLayeredSystemPrompt(
		permissionTypeString(permissionType),
		activeTools,
		capabilityContract,
	)
	hostContext := cloneStringMap(cfg.HostLabels)
	if hostContext == nil {
		hostContext = map[string]string{}
	}
	hostContext[floretToolHostContextPermissionSnapshotIDKey] = strings.TrimSpace(permissionSnapshot.SnapshotID)
	hostContext[floretToolHostContextPermissionEpochKey] = permissionSurfaceEpoch(permissionSnapshot)
	hostContext[floretToolHostContextAuthorityThreadIDKey] = strings.TrimSpace(r.threadID)
	return runToolSurface{
		PermissionType:     permissionType,
		PermissionSnapshot: permissionSnapshot,
		CapabilityContract: capabilityContract,
		FloretToolItems:    floretToolItems,
		HostedTools:        hosted,
		SystemPrompt:       systemPrompt,
		HostContext:        hostContext,
	}, nil
}

func permissionSurfaceEpoch(snapshot PermissionSnapshot) string {
	if snapshot.Version != permissionSnapshotVersionCurrent ||
		strings.TrimSpace(snapshot.SnapshotHash) == "" ||
		strings.TrimSpace(snapshot.RegistryHash) == "" ||
		strings.TrimSpace(snapshot.SchemaHash) == "" ||
		strings.TrimSpace(snapshot.PresentationHash) == "" {
		return ""
	}
	return strings.Join([]string{
		permissionTypeString(snapshot.PermissionType),
		strings.TrimSpace(snapshot.SnapshotHash),
		strings.TrimSpace(snapshot.RegistryHash),
		strings.TrimSpace(snapshot.SchemaHash),
		strings.TrimSpace(snapshot.PresentationHash),
	}, ":")
}

func (r *run) liveThreadPermissionType(ctx context.Context) (FlowerPermissionType, error) {
	settings, err := r.product.currentThreadSettings(ctx)
	if err != nil {
		return "", err
	}
	return threadPermissionType(settings)
}

func (r *run) liveFloretToolSurface(cfg runToolSurfaceConfig) flruntime.ToolSurfaceProvider {
	return func(ctx context.Context, request flruntime.ToolSurfaceRequest) (flruntime.ToolSurface, error) {
		permission, err := r.liveThreadPermissionType(ctx)
		if err != nil {
			return flruntime.ToolSurface{}, err
		}
		current := cfg
		current.InitialProviderSurface = request.InitialProviderSurface
		surface, err := r.buildRunToolSurface(current, permission)
		if err != nil {
			return flruntime.ToolSurface{}, err
		}
		registry := fltools.NewRegistry()
		for _, tool := range surface.FloretToolItems {
			if err := registry.Register(tool); err != nil {
				return flruntime.ToolSurface{}, err
			}
		}
		return flruntime.ToolSurface{
			RefreshProviderSurface: true,
			Tools:                  registry, HostedToolDefinitions: surface.HostedTools,
			SystemPrompt: surface.SystemPrompt, HostContext: surface.HostContext,
			Epoch: permissionSurfaceEpoch(surface.PermissionSnapshot), Reason: "thread_permission",
		}, nil
	}
}
