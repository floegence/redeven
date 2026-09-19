package ai

import (
	"fmt"
	"strings"

	flprovider "github.com/floegence/floret/v7/provider"
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
}

func (r *run) buildRunToolSurfaceConfig(capabilitySupportsAskUserBatches bool, state *floretToolRuntimeState, hostLabels map[string]string) runToolSurfaceConfig {
	return runToolSurfaceConfig{
		State:                          state,
		HostLabels:                     cloneStringMap(hostLabels),
		SupportsAskUserQuestionBatches: capabilitySupportsAskUserBatches,
	}
}

// The admitted permission is independent of the thread's future-turn setting.
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
