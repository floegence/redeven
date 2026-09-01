package ai

import (
	"context"
	"errors"
	"fmt"
	"strings"

	fltools "github.com/floegence/floret/v7/tools"
)

type runToolSurface struct {
	PermissionType     FlowerPermissionType
	PermissionSnapshot PermissionSnapshot
	CapabilityContract runCapabilityContract
	FloretToolItems    []fltools.Tool
	SystemPrompt       string
	HostContext        map[string]string
}

type runToolSurfaceConfig struct {
	State                           *floretToolRuntimeState
	HostLabels                      map[string]string
	SupportsAskUserQuestionBatches  bool
	IncludeControlSignalsInSnapshot bool
}

func (r *run) buildRunToolSurfaceConfig(capabilitySupportsAskUserBatches bool, state *floretToolRuntimeState, hostLabels map[string]string) runToolSurfaceConfig {
	return runToolSurfaceConfig{
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
