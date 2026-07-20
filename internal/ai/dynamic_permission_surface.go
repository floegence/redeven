package ai

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"

	flruntime "github.com/floegence/floret/runtime"
	fltools "github.com/floegence/floret/tools"
)

type runToolSurface struct {
	PermissionType     FlowerPermissionType
	ActiveTools        []ToolDef
	ActiveSignals      []ToolDef
	ControlTools       []ToolDef
	PermissionSnapshot PermissionSnapshot
	CapabilityContract runCapabilityContract
	FloretTools        *fltools.Registry
	SystemPrompt       string
	HostContext        map[string]string
	Epoch              string
}

type runToolSurfaceConfig struct {
	TaskObjective                   string
	TaskComplexity                  string
	State                           *floretToolRuntimeState
	HostLabels                      map[string]string
	SupportsAskUserQuestionBatches  bool
	IncludeControlSignalsInSnapshot bool
}

func (r *run) buildDynamicToolSurfaceConfig(taskObjective string, taskComplexity string, capabilitySupportsAskUserBatches bool, state *floretToolRuntimeState, hostLabels map[string]string) runToolSurfaceConfig {
	return runToolSurfaceConfig{
		TaskObjective:                   strings.TrimSpace(taskObjective),
		TaskComplexity:                  normalizeTaskComplexity(taskComplexity),
		State:                           state,
		HostLabels:                      cloneStringMap(hostLabels),
		SupportsAskUserQuestionBatches:  capabilitySupportsAskUserBatches,
		IncludeControlSignalsInSnapshot: true,
	}
}

func (r *run) currentThreadPermissionType(ctx context.Context) (FlowerPermissionType, error) {
	if r == nil || r.product.currentSettings == nil {
		return "", errors.New("thread permission store is unavailable")
	}
	endpointID := strings.TrimSpace(r.endpointID)
	threadID := strings.TrimSpace(r.threadID)
	if endpointID == "" || threadID == "" {
		return "", errors.New("thread permission identity is incomplete")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	th, err := r.product.currentThreadSettings(ctx)
	if err != nil {
		return "", fmt.Errorf("read current thread permission: %w", err)
	}
	if th == nil {
		return "", errors.New("current thread permission settings are missing")
	}
	raw := strings.TrimSpace(th.PermissionType)
	if raw == "" {
		return "", errors.New("current thread permission setting is empty")
	}
	permissionType, err := parsePermissionType(raw)
	if err != nil {
		return "", fmt.Errorf("parse current thread permission: %w", err)
	}
	return permissionType, nil
}

func (r *run) buildRunToolSurface(ctx context.Context, cfg runToolSurfaceConfig) (runToolSurface, error) {
	return r.buildRunToolSurfaceWithSnapshotCommit(ctx, cfg, true)
}

func (r *run) prepareRunToolSurface(ctx context.Context, cfg runToolSurfaceConfig) (runToolSurface, error) {
	return r.buildRunToolSurfaceWithSnapshotCommit(ctx, cfg, false)
}

func (r *run) buildRunToolSurfaceWithSnapshotCommit(ctx context.Context, cfg runToolSurfaceConfig, commitSnapshot bool) (runToolSurface, error) {
	if r == nil {
		return runToolSurface{}, fmt.Errorf("nil run")
	}
	permissionType, err := r.currentThreadPermissionType(ctx)
	if err != nil {
		return runToolSurface{}, err
	}
	registry := NewInMemoryToolRegistry()
	if err := registerBuiltInTools(registry, r); err != nil {
		return runToolSurface{}, err
	}
	permissionFilter := newPermissionToolFilter(!r.noUserInteraction)
	permissionFilter = r.withToolAllowlistFilter(permissionFilter)
	activeTools := permissionFilter.FilterTools(permissionType, registry.Snapshot())
	activeSignals := permissionFilter.FilterTools(permissionType, builtInControlSignalDefinitions())
	snapshotSignals := activeSignals
	if !cfg.IncludeControlSignalsInSnapshot {
		snapshotSignals = nil
	}
	permissionSnapshot := buildPermissionSnapshot(permissionType, activeTools, snapshotSignals)
	if err := validatePermissionSnapshotConsistency(permissionSnapshot); err != nil {
		return runToolSurface{}, err
	}
	if commitSnapshot {
		permissionSnapshot, err = r.freezePermissionSnapshot(permissionSnapshot)
	} else {
		permissionSnapshot, err = r.preparePermissionSnapshot(permissionSnapshot)
	}
	if err != nil {
		return runToolSurface{}, err
	}
	activeTools = filterToolsByNames(activeTools, permissionSnapshot.FloretToolNames)
	if cfg.IncludeControlSignalsInSnapshot {
		activeSignals = filterToolsByNames(activeSignals, permissionSnapshot.PromptCapabilityNames)
	}
	capabilityContract := resolveRunCapabilityContract(r, activeTools, activeSignals, cfg.SupportsAskUserQuestionBatches)
	controlTools := floretControlToolsForContract(activeSignals, capabilityContract)
	flTools, err := buildFloretToolRegistry(r, activeTools, cfg.State)
	if err != nil {
		return runToolSurface{}, err
	}
	state := runtimeState{}
	if cfg.State != nil {
		state = cfg.State.snapshot()
	}
	systemPrompt := r.buildLayeredSystemPrompt(
		cfg.TaskObjective,
		permissionTypeString(permissionType),
		cfg.TaskComplexity,
		0,
		true,
		activeTools,
		state,
		"",
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
		ActiveTools:        activeTools,
		ActiveSignals:      activeSignals,
		ControlTools:       controlTools,
		PermissionSnapshot: permissionSnapshot,
		CapabilityContract: capabilityContract,
		FloretTools:        flTools,
		SystemPrompt:       systemPrompt,
		HostContext:        hostContext,
		Epoch:              permissionSurfaceEpoch(permissionSnapshot),
	}, nil
}

func (r *run) dynamicToolSurfaceProvider(cfg runToolSurfaceConfig, recordInitial bool) flruntime.ToolSurfaceProvider {
	var mu sync.Mutex
	lastEpoch := ""
	initialSnapshot := r.currentPermissionSnapshot()
	if recordInitial && permissionSnapshotActive(initialSnapshot) {
		lastEpoch = permissionSurfaceEpoch(initialSnapshot)
	}
	return func(ctx context.Context, req flruntime.ToolSurfaceRequest) (flruntime.ToolSurface, error) {
		surface, err := r.buildRunToolSurface(ctx, cfg)
		if err != nil {
			return flruntime.ToolSurface{}, err
		}
		mu.Lock()
		changed := surface.Epoch != "" && surface.Epoch != lastEpoch
		if changed {
			lastEpoch = surface.Epoch
		}
		mu.Unlock()
		if changed {
			r.recordRunDiagnostic("tool_surface.updated", RealtimeStreamKindLifecycle, map[string]any{
				"phase":             strings.TrimSpace(req.Phase),
				"step":              req.Step,
				"permission_type":   permissionTypeString(surface.PermissionType),
				"snapshot_id":       strings.TrimSpace(surface.PermissionSnapshot.SnapshotID),
				"snapshot_hash":     strings.TrimSpace(surface.PermissionSnapshot.SnapshotHash),
				"registry_hash":     strings.TrimSpace(surface.PermissionSnapshot.RegistryHash),
				"schema_hash":       strings.TrimSpace(surface.PermissionSnapshot.SchemaHash),
				"presentation_hash": strings.TrimSpace(surface.PermissionSnapshot.PresentationHash),
			})
			r.recordRunDiagnostic("capability.contract.resolved", RealtimeStreamKindLifecycle, surface.CapabilityContract.eventPayload())
		}
		return flruntime.ToolSurface{
			Tools:        surface.FloretTools,
			SystemPrompt: surface.SystemPrompt,
			HostContext:  surface.HostContext,
			Epoch:        surface.Epoch,
			Reason:       "thread_permission",
		}, nil
	}
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
