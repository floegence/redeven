package ai

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

type FlowerPermissionType string

const (
	FlowerPermissionReadonly         FlowerPermissionType = "readonly"
	FlowerPermissionApprovalRequired FlowerPermissionType = "approval_required"
	FlowerPermissionFullAccess       FlowerPermissionType = "full_access"
)

type ToolVisibilityClass string

const (
	ToolVisibilityReadonlyExclusive ToolVisibilityClass = "readonly_exclusive"
	ToolVisibilityStandard          ToolVisibilityClass = "standard"
	ToolVisibilitySharedReadonly    ToolVisibilityClass = "shared_readonly"
	ToolVisibilityInteraction       ToolVisibilityClass = "interaction"
	ToolVisibilityControl           ToolVisibilityClass = "control"
	ToolVisibilityDelegationControl ToolVisibilityClass = "delegation_control"
)

type ToolCapabilityClass string

const (
	ToolCapabilityReadonlyLocal   ToolCapabilityClass = "readonly_local"
	ToolCapabilityReadonlyNetwork ToolCapabilityClass = "readonly_network"
	ToolCapabilityInteraction     ToolCapabilityClass = "interaction"
	ToolCapabilityMutation        ToolCapabilityClass = "mutation"
	ToolCapabilityShell           ToolCapabilityClass = "shell"
	ToolCapabilityDelegation      ToolCapabilityClass = "delegation"
	ToolCapabilityOpenWorld       ToolCapabilityClass = "open_world"
)

type ApprovalDecisionKind string

const (
	ApprovalDecisionAllow ApprovalDecisionKind = "allow"
	ApprovalDecisionAsk   ApprovalDecisionKind = "ask"
	ApprovalDecisionDeny  ApprovalDecisionKind = "deny"
)

type ToolPermissionPolicy struct {
	Visibility       ToolVisibilityClass
	Capabilities     []ToolCapabilityClass
	ResourceKinds    []string
	ApprovalDecision ApprovalDecisionKind
	ParallelSafe     bool
}

type PermissionSnapshot struct {
	SnapshotID            string
	PermissionType        FlowerPermissionType
	VisibleToolNames      []string
	PromptCapabilityNames []string
	FloretToolNames       []string
	ToolPolicies          map[string]ToolPermissionPolicy
	SnapshotHash          string
	RegistryHash          string
	SchemaHash            string
	PresentationHash      string
}

func normalizePermissionType(raw string, fallback FlowerPermissionType) (FlowerPermissionType, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "":
		if fallback != "" {
			return fallback, nil
		}
		return FlowerPermissionApprovalRequired, nil
	case string(FlowerPermissionReadonly):
		return FlowerPermissionReadonly, nil
	case string(FlowerPermissionApprovalRequired):
		return FlowerPermissionApprovalRequired, nil
	case string(FlowerPermissionFullAccess):
		return FlowerPermissionFullAccess, nil
	default:
		return "", fmt.Errorf("invalid flower permission type %q", raw)
	}
}

func permissionTypeString(p FlowerPermissionType) string {
	return string(p)
}

func buildPermissionSnapshot(permissionType FlowerPermissionType, activeTools []ToolDef, activeSignals []ToolDef) PermissionSnapshot {
	names := toolNames(activeTools)
	signalNames := toolNames(activeSignals)
	policies := make(map[string]ToolPermissionPolicy, len(activeTools)+len(activeSignals))
	for _, def := range append(append([]ToolDef{}, activeTools...), activeSignals...) {
		name := strings.TrimSpace(def.Name)
		if name == "" {
			continue
		}
		policies[name] = ToolPermissionPolicy{
			Visibility:       def.Visibility,
			Capabilities:     append([]ToolCapabilityClass(nil), def.Capabilities...),
			ResourceKinds:    floretToolResourceKinds(name),
			ApprovalDecision: permissionDecisionForTool(permissionType, def),
			ParallelSafe:     def.ParallelSafe,
		}
	}
	floretNames := make([]string, 0, len(activeTools))
	for _, name := range names {
		if isFlowerControlTool(name) {
			continue
		}
		floretNames = append(floretNames, name)
	}
	snapshot := PermissionSnapshot{
		PermissionType:        permissionType,
		VisibleToolNames:      append(append([]string{}, names...), signalNames...),
		PromptCapabilityNames: append(append([]string{}, names...), signalNames...),
		FloretToolNames:       floretNames,
		ToolPolicies:          policies,
	}
	snapshot.SnapshotHash = permissionSnapshotHash(snapshot)
	snapshot.RegistryHash = stableStringListHash(snapshot.FloretToolNames)
	snapshot.SchemaHash = stableStringListHash(snapshot.FloretToolNames)
	snapshot.PresentationHash = stableStringListHash(snapshot.PromptCapabilityNames)
	return snapshot
}

func validatePermissionSnapshotConsistency(snapshot PermissionSnapshot) error {
	visible, err := uniqueStringSet("visible tools", snapshot.VisibleToolNames)
	if err != nil {
		return err
	}
	prompt, err := uniqueStringSet("prompt capabilities", snapshot.PromptCapabilityNames)
	if err != nil {
		return err
	}
	if !sameStringSet(visible, prompt) {
		return fmt.Errorf("permission snapshot prompt capabilities differ from visible tools")
	}
	for _, name := range snapshot.FloretToolNames {
		name = strings.TrimSpace(name)
		if name == "" {
			return fmt.Errorf("permission snapshot has empty floret tool")
		}
		if _, ok := visible[name]; !ok {
			return fmt.Errorf("permission snapshot floret tool %q is not visible", name)
		}
		if isFlowerControlTool(name) {
			return fmt.Errorf("permission snapshot floret tool %q is a Flower control signal", name)
		}
		if _, ok := snapshot.ToolPolicies[name]; !ok {
			return fmt.Errorf("permission snapshot floret tool %q is missing policy", name)
		}
	}
	for name, policy := range snapshot.ToolPolicies {
		name = strings.TrimSpace(name)
		if name == "" {
			return fmt.Errorf("permission snapshot has empty policy name")
		}
		if _, ok := visible[name]; !ok {
			return fmt.Errorf("permission snapshot policy %q is not visible", name)
		}
		switch snapshot.PermissionType {
		case FlowerPermissionReadonly:
			if policy.Visibility == ToolVisibilityStandard {
				return fmt.Errorf("readonly permission snapshot exposes standard tool %q", name)
			}
		case FlowerPermissionApprovalRequired, FlowerPermissionFullAccess:
			if policy.Visibility == ToolVisibilityReadonlyExclusive {
				return fmt.Errorf("%s permission snapshot exposes readonly-exclusive tool %q", snapshot.PermissionType, name)
			}
		default:
			return fmt.Errorf("permission snapshot has invalid permission type %q", snapshot.PermissionType)
		}
	}
	return nil
}

func uniqueStringSet(label string, values []string) (map[string]struct{}, error) {
	out := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			return nil, fmt.Errorf("permission snapshot has empty %s entry", label)
		}
		if _, ok := out[value]; ok {
			return nil, fmt.Errorf("permission snapshot has duplicate %s entry %q", label, value)
		}
		out[value] = struct{}{}
	}
	return out, nil
}

func sameStringSet(a map[string]struct{}, b map[string]struct{}) bool {
	if len(a) != len(b) {
		return false
	}
	for key := range a {
		if _, ok := b[key]; !ok {
			return false
		}
	}
	return true
}

func toolNames(tools []ToolDef) []string {
	out := make([]string, 0, len(tools))
	for _, tool := range tools {
		name := strings.TrimSpace(tool.Name)
		if name != "" {
			out = append(out, name)
		}
	}
	sort.Strings(out)
	return out
}

func filterToolsByNames(tools []ToolDef, allowedNames []string) []ToolDef {
	if len(tools) == 0 || len(allowedNames) == 0 {
		return nil
	}
	allowed := make(map[string]struct{}, len(allowedNames))
	for _, name := range allowedNames {
		if name = strings.TrimSpace(name); name != "" {
			allowed[name] = struct{}{}
		}
	}
	out := make([]ToolDef, 0, len(tools))
	for _, tool := range tools {
		if _, ok := allowed[strings.TrimSpace(tool.Name)]; ok {
			out = append(out, tool)
		}
	}
	return out
}

func permissionDecisionForTool(permissionType FlowerPermissionType, def ToolDef) ApprovalDecisionKind {
	switch permissionType {
	case FlowerPermissionReadonly:
		switch def.Visibility {
		case ToolVisibilityReadonlyExclusive, ToolVisibilitySharedReadonly, ToolVisibilityInteraction, ToolVisibilityControl, ToolVisibilityDelegationControl:
			return ApprovalDecisionAllow
		default:
			return ApprovalDecisionDeny
		}
	case FlowerPermissionApprovalRequired:
		if def.Visibility == ToolVisibilityReadonlyExclusive {
			return ApprovalDecisionDeny
		}
		if def.Visibility == ToolVisibilitySharedReadonly {
			return ApprovalDecisionAllow
		}
		if def.HasCapability(ToolCapabilityShell) || def.HasCapability(ToolCapabilityOpenWorld) || def.Mutating || def.RequiresApproval {
			return ApprovalDecisionAsk
		}
		return ApprovalDecisionAllow
	case FlowerPermissionFullAccess:
		if def.Visibility == ToolVisibilityReadonlyExclusive {
			return ApprovalDecisionDeny
		}
		return ApprovalDecisionAllow
	default:
		return ApprovalDecisionDeny
	}
}

func (d ToolDef) HasCapability(capability ToolCapabilityClass) bool {
	for _, item := range d.Capabilities {
		if item == capability {
			return true
		}
	}
	return false
}

func normalizeToolPermissionMetadata(def ToolDef) ToolDef {
	if def.Visibility == "" {
		def.Visibility = visibilityForToolName(def.Name)
	}
	if len(def.Capabilities) == 0 {
		def.Capabilities = capabilitiesForToolName(def.Name)
	}
	return def
}

func permissionSnapshotWithOwnerIdentity(snapshot PermissionSnapshot, endpointID string, threadID string, runID string) PermissionSnapshot {
	if snapshot.SnapshotHash == "" {
		snapshot.SnapshotHash = permissionSnapshotHash(snapshot)
	}
	seed := strings.Join([]string{
		strings.TrimSpace(endpointID),
		strings.TrimSpace(threadID),
		strings.TrimSpace(runID),
		strings.TrimSpace(snapshot.SnapshotHash),
	}, "\x00")
	sum := sha256.Sum256([]byte(seed))
	snapshot.SnapshotID = "psnap_" + base64.RawURLEncoding.EncodeToString(sum[:18])
	return snapshot
}

func permissionSnapshotHash(snapshot PermissionSnapshot) string {
	type hashView struct {
		PermissionType        FlowerPermissionType            `json:"permission_type"`
		VisibleToolNames      []string                        `json:"visible_tool_names"`
		PromptCapabilityNames []string                        `json:"prompt_capability_names"`
		FloretToolNames       []string                        `json:"floret_tool_names"`
		ToolPolicies          map[string]ToolPermissionPolicy `json:"tool_policies"`
	}
	view := hashView{
		PermissionType:        snapshot.PermissionType,
		VisibleToolNames:      append([]string(nil), snapshot.VisibleToolNames...),
		PromptCapabilityNames: append([]string(nil), snapshot.PromptCapabilityNames...),
		FloretToolNames:       append([]string(nil), snapshot.FloretToolNames...),
		ToolPolicies:          snapshot.ToolPolicies,
	}
	sort.Strings(view.VisibleToolNames)
	sort.Strings(view.PromptCapabilityNames)
	sort.Strings(view.FloretToolNames)
	payload, _ := json.Marshal(view)
	sum := sha256.Sum256(payload)
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func stableStringListHash(values []string) string {
	cleaned := make([]string, 0, len(values))
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			cleaned = append(cleaned, value)
		}
	}
	sort.Strings(cleaned)
	payload, _ := json.Marshal(cleaned)
	sum := sha256.Sum256(payload)
	return base64.RawURLEncoding.EncodeToString(sum[:])
}
