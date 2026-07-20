package ai

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	flruntime "github.com/floegence/floret/runtime"
	fltools "github.com/floegence/floret/tools"
)

type floretEffectAuthorizationKey struct {
	ThreadID     string
	TurnID       string
	RunID        string
	ToolCallID   string
	ArgumentHash string
}

type floretEffectAuthorizationRegistry struct {
	mu     sync.Mutex
	active map[floretEffectAuthorizationKey]*floretEffectAuthorizationEntry
}

type floretEffectAuthorizationEntry struct {
	snapshot        PermissionSnapshot
	effectAttemptID string
	consumed        bool
}

func newFloretEffectAuthorizationRegistry() *floretEffectAuthorizationRegistry {
	return &floretEffectAuthorizationRegistry{active: make(map[floretEffectAuthorizationKey]*floretEffectAuthorizationEntry)}
}

func (r *floretEffectAuthorizationRegistry) authorize(req flruntime.EffectAuthorizationRequest, snapshot PermissionSnapshot) (func(), error) {
	if r == nil {
		return nil, errors.New("Floret effect authorization registry is unavailable")
	}
	key := floretEffectAuthorizationKey{
		ThreadID: strings.TrimSpace(string(req.ThreadID)), TurnID: strings.TrimSpace(string(req.TurnID)),
		RunID: strings.TrimSpace(string(req.RunID)), ToolCallID: strings.TrimSpace(req.ToolCallID),
		ArgumentHash: strings.TrimSpace(req.ArgumentHash),
	}
	effectAttemptID := strings.TrimSpace(req.EffectAttemptID)
	if key.ThreadID == "" || key.TurnID == "" || key.RunID == "" || key.ToolCallID == "" || key.ArgumentHash == "" || effectAttemptID == "" || !permissionSnapshotActive(snapshot) {
		return nil, errors.New("Floret effect authorization identity is incomplete")
	}
	entry := &floretEffectAuthorizationEntry{snapshot: snapshot, effectAttemptID: effectAttemptID}
	r.mu.Lock()
	if _, exists := r.active[key]; exists {
		r.mu.Unlock()
		return nil, errors.New("Floret effect authorization is already active")
	}
	r.active[key] = entry
	r.mu.Unlock()
	return func() {
		r.mu.Lock()
		delete(r.active, key)
		r.mu.Unlock()
	}, nil
}

func (r *floretEffectAuthorizationRegistry) snapshotForInvocation(inv fltools.Invocation[map[string]any]) (PermissionSnapshot, string, error) {
	if r == nil {
		return PermissionSnapshot{}, "", errors.New("Floret effect authorization registry is unavailable")
	}
	key := floretEffectAuthorizationKey{
		ThreadID: strings.TrimSpace(inv.ThreadID), TurnID: strings.TrimSpace(inv.TurnID), RunID: strings.TrimSpace(inv.RunID),
		ToolCallID: strings.TrimSpace(inv.CallID), ArgumentHash: floretEffectArgumentHash(inv.RawArgs),
	}
	r.mu.Lock()
	entry, ok := r.active[key]
	if ok && !entry.consumed {
		entry.consumed = true
	} else {
		ok = false
	}
	r.mu.Unlock()
	if !ok || entry == nil || !permissionSnapshotActive(entry.snapshot) || strings.TrimSpace(entry.effectAttemptID) == "" {
		return PermissionSnapshot{}, "", errors.New("Floret effect authorization proof is unavailable")
	}
	return entry.snapshot, entry.effectAttemptID, nil
}

func floretEffectArgumentHash(raw string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(raw)))
	return hex.EncodeToString(sum[:])
}

func floretEffectAuthorizationGateForRun(r *run) flruntime.EffectAuthorizationGate {
	if r == nil {
		return nil
	}
	return flruntime.EffectAuthorizationGateFunc(r.dispatchFloretEffect)
}

func (r *run) dispatchFloretEffect(ctx context.Context, req flruntime.EffectAuthorizationRequest, effect flruntime.AuthorizedEffect) (flruntime.EffectDispatchResult, error) {
	if r == nil || effect == nil {
		return flruntime.EffectDispatchResult{}, errors.New("Floret effect authorization is unavailable")
	}
	var result flruntime.EffectDispatchResult
	err := r.withAuthorizedFloretEffect(ctx, req, func(proof flruntime.EffectAuthorizationProof) error {
		var dispatchErr error
		result, dispatchErr = effect(proof)
		return dispatchErr
	})
	return result, err
}

func (r *run) withAuthorizedFloretEffect(ctx context.Context, req flruntime.EffectAuthorizationRequest, dispatch func(flruntime.EffectAuthorizationProof) error) error {
	if r == nil || dispatch == nil {
		return errors.New("Floret effect authorization is unavailable")
	}
	if err := validateFloretEffectAuthorizationRequest(req); err != nil {
		return err
	}
	policyRun, auditSnapshot, err := floretEffectAuthorizationContext(ctx, r, req)
	if err != nil {
		return err
	}
	if err := validateFloretEffectRequestAgainstSnapshot(req, auditSnapshot); err != nil {
		return err
	}
	authorityThreadID := strings.TrimSpace(req.HostContext[floretToolHostContextAuthorityThreadIDKey])
	if authorityThreadID == "" {
		return errors.New("Floret effect permission authority is missing")
	}
	approvedRevision := ""
	approvalID := ""
	for {
		unlock, err := r.lockFloretEffectAuthority(authorityThreadID, req)
		if err != nil {
			return err
		}
		currentSnapshot, err := policyRun.refreshFloretEffectPermissionSnapshot(ctx, authorityThreadID, req)
		if err != nil {
			unlock()
			return err
		}
		currentPolicy, ok := currentSnapshot.ToolPolicies[strings.TrimSpace(req.ToolName)]
		if !ok || floretPermissionMode(currentPolicy.ApprovalDecision) != req.Permission.Mode {
			unlock()
			return errors.New("Floret effect authorization snapshot is stale")
		}
		decision, err := floretEffectPolicyDecision(policyRun, currentSnapshot, req.ToolName)
		if err != nil {
			unlock()
			return err
		}
		policyRevision := floretEffectPolicyRevision(authorityThreadID, currentSnapshot)
		if decision == ApprovalDecisionDeny {
			unlock()
			return errors.New("permission denied: tool unavailable for current permission policy")
		}
		if decision == ApprovalDecisionAsk && approvedRevision != policyRevision {
			unlock()
			approved, requestedApprovalID, approvalErr := r.waitForCurrentFloretEffectApproval(ctx, policyRun, req)
			if approvalErr != nil {
				return approvalErr
			}
			if !approved {
				return errors.New("permission denied: rejected by user")
			}
			approvedRevision = policyRevision
			approvalID = requestedApprovalID
			continue
		}
		releaseAuthorization, err := r.effectAuthorizations.authorize(req, currentSnapshot)
		if err != nil {
			unlock()
			return err
		}
		proof := flruntime.EffectAuthorizationProof{
			EffectAttemptID: req.EffectAttemptID, RequestFingerprint: req.RequestFingerprint,
			ThreadID: req.ThreadID, TurnID: req.TurnID, RunID: req.RunID, ToolCallID: req.ToolCallID,
			LeaseOwnerID: req.LeaseOwnerID, LeaseGeneration: req.LeaseGeneration,
			PolicyRevision: policyRevision, ApprovalID: approvalID,
			AuditReference: "permission_snapshot:" + strings.TrimSpace(currentSnapshot.SnapshotID) + "/effect:" + strings.TrimSpace(req.EffectAttemptID),
			AuditHash:      floretEffectAuditHash(req, currentSnapshot, policyRevision, approvalID), AuthorizedAt: time.Now(),
		}
		// Passive SubAgent coordination has no product or canonical mutation and
		// may wait for child progress. Release the lifecycle gate before that
		// wait so permission changes and deletes are not needlessly delayed.
		if passiveSubagentEffectRequest(req) {
			unlock()
			dispatchErr := dispatch(proof)
			releaseAuthorization()
			return dispatchErr
		}
		dispatchErr := dispatch(proof)
		releaseAuthorization()
		unlock()
		return dispatchErr
	}
}

func passiveSubagentEffectRequest(req flruntime.EffectAuthorizationRequest) bool {
	if strings.TrimSpace(req.ToolName) != "subagents" {
		return false
	}
	for _, resource := range req.Resources {
		if strings.TrimSpace(resource.Kind) != "subagent" {
			continue
		}
		switch strings.TrimSpace(resource.Value) {
		case subagentActionWait, subagentActionList, subagentActionInspect:
			return true
		default:
			return false
		}
	}
	return false
}

func validateFloretEffectAuthorizationRequest(req flruntime.EffectAuthorizationRequest) error {
	if strings.TrimSpace(req.EffectAttemptID) == "" || strings.TrimSpace(req.RequestFingerprint) == "" ||
		strings.TrimSpace(string(req.ThreadID)) == "" || strings.TrimSpace(string(req.TurnID)) == "" ||
		strings.TrimSpace(string(req.RunID)) == "" || strings.TrimSpace(req.ToolCallID) == "" ||
		strings.TrimSpace(req.ToolName) == "" || strings.TrimSpace(req.ArgumentHash) == "" ||
		strings.TrimSpace(req.LeaseOwnerID) == "" || req.LeaseGeneration <= 0 {
		return errors.New("Floret effect authorization request identity is incomplete")
	}
	if req.Permission.Mode != fltools.PermissionAllow && req.Permission.Mode != fltools.PermissionAsk && req.Permission.Mode != fltools.PermissionDeny {
		return errors.New("Floret effect authorization request has invalid permission mode")
	}
	return nil
}

func floretEffectAuthorizationContext(ctx context.Context, base *run, req flruntime.EffectAuthorizationRequest) (*run, PermissionSnapshot, error) {
	ownerThreadID := strings.TrimSpace(string(req.ThreadID))
	ownerRunID := strings.TrimSpace(string(req.RunID))
	if childThreadID := strings.TrimSpace(req.HostContext[subagentToolHostContextChildThreadIDKey]); childThreadID != "" {
		if ownerThreadID != childThreadID {
			return nil, PermissionSnapshot{}, errors.New("Floret child effect thread identity mismatch")
		}
		ownerRunID = strings.TrimSpace(req.HostContext[subagentToolHostContextChildRunIDKey])
	}
	snapshot, err := base.loadFloretPermissionSnapshot(ctx, req.HostContext, ownerThreadID, ownerRunID)
	if err != nil {
		return nil, PermissionSnapshot{}, err
	}
	policyRun, err := floretEffectAuthorizationRunContext(ctx, base, req, snapshot)
	if err != nil {
		return nil, PermissionSnapshot{}, err
	}
	return policyRun, snapshot, nil
}

func validateFloretEffectRequestAgainstSnapshot(req flruntime.EffectAuthorizationRequest, snapshot PermissionSnapshot) error {
	policy, ok := snapshot.ToolPolicies[strings.TrimSpace(req.ToolName)]
	if !ok || !stringSliceContains(snapshot.FloretToolNames, req.ToolName) {
		return errors.New("Floret effect tool is absent from its admitted permission snapshot")
	}
	if req.Permission.Mode != floretPermissionMode(policy.ApprovalDecision) {
		return errors.New("Floret effect permission mode differs from its admitted permission snapshot")
	}
	return nil
}

func (r *run) lockFloretEffectAuthority(authorityThreadID string, req flruntime.EffectAuthorizationRequest) (func(), error) {
	if r == nil || r.host.lockEffectAuthority == nil {
		return nil, errors.New("Floret effect lifecycle gate is unavailable")
	}
	authorityThreadID = strings.TrimSpace(authorityThreadID)
	if authorityThreadID == "" {
		return nil, errors.New("Floret effect lifecycle identity is incomplete")
	}
	if authorityThreadID != strings.TrimSpace(r.host.authorityThreadID) {
		return nil, errors.New("Floret effect lifecycle authority mismatch")
	}
	join, err := floretEffectJoin(req)
	if err != nil {
		return nil, err
	}
	return r.host.lockEffectAuthority(join)
}

func floretEffectJoin(req flruntime.EffectAuthorizationRequest) (threadEffectJoin, error) {
	if strings.TrimSpace(req.ToolName) != "subagents" {
		return threadEffectJoin{}, nil
	}
	action := ""
	target := ""
	for _, resource := range req.Resources {
		switch strings.TrimSpace(resource.Kind) {
		case "subagent":
			action = strings.TrimSpace(resource.Value)
		case "subagent_thread":
			target = strings.TrimSpace(resource.Value)
		}
	}
	switch action {
	case subagentActionClose:
		if target == "" {
			return threadEffectJoin{}, errors.New("SubAgent close effect is missing its child authority scope")
		}
		return threadEffectJoin{childThreadID: target}, nil
	case subagentActionCloseAll:
		return threadEffectJoin{allChildren: true}, nil
	default:
		return threadEffectJoin{}, nil
	}
}

func (r *run) refreshFloretEffectPermissionSnapshot(ctx context.Context, authorityThreadID string, req flruntime.EffectAuthorizationRequest) (PermissionSnapshot, error) {
	if r == nil || r.product.requireAuthorityWritable == nil {
		return PermissionSnapshot{}, errors.New("current permission store is unavailable")
	}
	if strings.TrimSpace(authorityThreadID) != strings.TrimSpace(r.host.authorityThreadID) {
		return PermissionSnapshot{}, errors.New("current permission authority mismatch")
	}
	if err := r.product.requireThreadAuthorityWritable(ctx); err != nil {
		return PermissionSnapshot{}, err
	}
	if r.subagentDepth <= 0 {
		cfg := r.dynamicSurfaceConfig
		cfg.IncludeControlSignalsInSnapshot = true
		surface, err := r.buildRunToolSurface(ctx, cfg)
		if err != nil {
			return PermissionSnapshot{}, fmt.Errorf("refresh current permission snapshot: %w", err)
		}
		return surface.PermissionSnapshot, nil
	}
	forkMode := flruntime.SubAgentForkMode(strings.TrimSpace(req.HostContext[subagentToolHostContextForkModeKey]))
	snapshot, err := r.refreshCurrentSubagentPermissionSnapshot(ctx, authorityThreadID, forkMode)
	if err != nil {
		return PermissionSnapshot{}, fmt.Errorf("refresh current child permission snapshot: %w", err)
	}
	return snapshot, nil
}

func floretEffectPolicyDecision(policyRun *run, snapshot PermissionSnapshot, toolName string) (ApprovalDecisionKind, error) {
	if !permissionSnapshotActive(snapshot) {
		return "", errors.New("current permission snapshot is unavailable")
	}
	policy, ok := snapshot.ToolPolicies[strings.TrimSpace(toolName)]
	if !ok || !stringSliceContains(snapshot.FloretToolNames, toolName) {
		return ApprovalDecisionDeny, nil
	}
	if policy.ApprovalDecision == ApprovalDecisionAsk && policyRun != nil && policyRun.subagentDepth > 0 && !policyRun.allowDelegatedApproval {
		return ApprovalDecisionDeny, nil
	}
	return policy.ApprovalDecision, nil
}

func floretEffectPolicyRevision(authorityThreadID string, snapshot PermissionSnapshot) string {
	sum := sha256.Sum256([]byte(strings.Join([]string{
		strings.TrimSpace(authorityThreadID), permissionTypeString(snapshot.PermissionType), strings.TrimSpace(snapshot.SnapshotHash),
	}, "\x00")))
	return "permission-v2:" + hex.EncodeToString(sum[:])
}

func floretEffectAuditHash(req flruntime.EffectAuthorizationRequest, snapshot PermissionSnapshot, policyRevision string, approvalID string) string {
	sum := sha256.Sum256([]byte(strings.Join([]string{
		strings.TrimSpace(req.EffectAttemptID), strings.TrimSpace(req.RequestFingerprint), strings.TrimSpace(req.ArgumentHash),
		strings.TrimSpace(snapshot.SnapshotID), strings.TrimSpace(snapshot.SnapshotHash), strings.TrimSpace(policyRevision), strings.TrimSpace(approvalID),
	}, "\x00")))
	return hex.EncodeToString(sum[:])
}
