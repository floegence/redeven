package ai

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/floegence/redeven/internal/ai/permissionsnapshot"
)

type FlowerPermissionType = permissionsnapshot.PermissionType

const (
	FlowerPermissionReadonly         = permissionsnapshot.PermissionReadonly
	FlowerPermissionApprovalRequired = permissionsnapshot.PermissionApprovalRequired
	FlowerPermissionFullAccess       = permissionsnapshot.PermissionFullAccess
)

const (
	permissionSnapshotVersionCurrent = permissionsnapshot.VersionCurrent
)

type ToolVisibilityClass = permissionsnapshot.VisibilityClass

const (
	ToolVisibilityReadonlyExclusive = permissionsnapshot.VisibilityReadonlyExclusive
	ToolVisibilityStandard          = permissionsnapshot.VisibilityStandard
	ToolVisibilitySharedReadonly    = permissionsnapshot.VisibilitySharedReadonly
	ToolVisibilityInteraction       = permissionsnapshot.VisibilityInteraction
	ToolVisibilityControl           = permissionsnapshot.VisibilityControl
	ToolVisibilityDelegationControl = permissionsnapshot.VisibilityDelegationControl
)

type ToolCapabilityClass = permissionsnapshot.CapabilityClass

const (
	ToolCapabilityReadonlyLocal   = permissionsnapshot.CapabilityReadonlyLocal
	ToolCapabilityReadonlyNetwork = permissionsnapshot.CapabilityReadonlyNetwork
	ToolCapabilityInteraction     = permissionsnapshot.CapabilityInteraction
	ToolCapabilityMutation        = permissionsnapshot.CapabilityMutation
	ToolCapabilityShell           = permissionsnapshot.CapabilityShell
	ToolCapabilityDelegation      = permissionsnapshot.CapabilityDelegation
	ToolCapabilityOpenWorld       = permissionsnapshot.CapabilityOpenWorld
)

type ApprovalDecisionKind = permissionsnapshot.ApprovalDecision

const (
	ApprovalDecisionAllow = permissionsnapshot.ApprovalAllow
	ApprovalDecisionAsk   = permissionsnapshot.ApprovalAsk
	ApprovalDecisionDeny  = permissionsnapshot.ApprovalDeny
)

type ToolPermissionPolicy = permissionsnapshot.ToolPolicy

type PermissionSnapshot = permissionsnapshot.Snapshot

func parsePermissionType(raw string) (FlowerPermissionType, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "":
		return "", fmt.Errorf("flower permission type is empty")
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

func permissionTypeOrDefault(raw string, defaultType FlowerPermissionType) (FlowerPermissionType, error) {
	if strings.TrimSpace(raw) != "" {
		return parsePermissionType(raw)
	}
	if _, err := parsePermissionType(string(defaultType)); err != nil {
		return "", fmt.Errorf("invalid default flower permission type %q", defaultType)
	}
	return defaultType, nil
}

func permissionTypeString(p FlowerPermissionType) string {
	return string(p)
}

func buildPermissionSnapshot(permissionType FlowerPermissionType, activeTools []ToolDef, activeSignals []ToolDef) PermissionSnapshot {
	names := toolNames(activeTools)
	signalNames := toolNames(activeSignals)
	policies := make(map[string]ToolPermissionPolicy, len(activeTools)+len(activeSignals))
	for _, def := range append(append([]ToolDef{}, activeTools...), activeSignals...) {
		def = normalizeToolPermissionMetadata(def)
		name := strings.TrimSpace(def.Name)
		if name == "" {
			continue
		}
		policies[name] = ToolPermissionPolicy{
			Visibility:       def.Visibility,
			Capabilities:     append([]ToolCapabilityClass(nil), def.Capabilities...),
			ResourceKinds:    floretToolResourceKinds(name),
			ApprovalDecision: permissionDecisionForTool(permissionType, def),
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
		Version:               permissionSnapshotVersionCurrent,
		PermissionType:        permissionType,
		VisibleToolNames:      append(append([]string{}, names...), signalNames...),
		PromptCapabilityNames: append(append([]string{}, names...), signalNames...),
		FloretToolNames:       floretNames,
		ToolPolicies:          policies,
	}
	allVisibleDefs := append(append([]ToolDef{}, activeTools...), activeSignals...)
	snapshot.RegistryHash = stableToolRegistryHash(activeTools)
	snapshot.SchemaHash = stableToolSchemaHash(activeTools)
	snapshot.PresentationHash = stableToolPresentationHash(allVisibleDefs)
	snapshot.SnapshotHash = permissionSnapshotHash(snapshot)
	return snapshot
}

func validatePermissionSnapshotConsistency(snapshot PermissionSnapshot) error {
	if err := permissionsnapshot.Validate(snapshot); err != nil {
		return err
	}
	for _, name := range snapshot.FloretToolNames {
		if isFlowerControlTool(name) {
			return fmt.Errorf("permission snapshot floret tool %q is a Flower control signal", name)
		}
	}
	return nil
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
	return permissionsnapshot.Hash(snapshot)
}

func stableToolRegistryHash(tools []ToolDef) string {
	type registryEntry struct {
		Name             string                `json:"name"`
		Description      string                `json:"description,omitempty"`
		Mutating         bool                  `json:"mutating,omitempty"`
		RequiresApproval bool                  `json:"requires_approval,omitempty"`
		Visibility       ToolVisibilityClass   `json:"visibility,omitempty"`
		Capabilities     []ToolCapabilityClass `json:"capabilities,omitempty"`
		Source           string                `json:"source,omitempty"`
		Namespace        string                `json:"namespace,omitempty"`
	}
	entries := make([]registryEntry, 0, len(tools))
	for _, tool := range tools {
		tool = normalizeToolPermissionMetadata(tool)
		name := strings.TrimSpace(tool.Name)
		if name == "" {
			continue
		}
		capabilities := append([]ToolCapabilityClass(nil), tool.Capabilities...)
		sort.Slice(capabilities, func(i, j int) bool { return capabilities[i] < capabilities[j] })
		entries = append(entries, registryEntry{
			Name:             name,
			Description:      strings.TrimSpace(tool.Description),
			Mutating:         tool.Mutating,
			RequiresApproval: tool.RequiresApproval,
			Visibility:       tool.Visibility,
			Capabilities:     capabilities,
			Source:           strings.TrimSpace(tool.Source),
			Namespace:        strings.TrimSpace(tool.Namespace),
		})
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name < entries[j].Name })
	return stableJSONHash(entries)
}

func stableToolSchemaHash(tools []ToolDef) string {
	type schemaEntry struct {
		Name        string `json:"name"`
		InputSchema any    `json:"input_schema,omitempty"`
	}
	entries := make([]schemaEntry, 0, len(tools))
	for _, tool := range tools {
		name := strings.TrimSpace(tool.Name)
		if name == "" {
			continue
		}
		entries = append(entries, schemaEntry{
			Name:        name,
			InputSchema: canonicalJSONValue(tool.InputSchema),
		})
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name < entries[j].Name })
	return stableJSONHash(entries)
}

func stableToolPresentationHash(tools []ToolDef) string {
	type presentationEntry struct {
		Name         string `json:"name"`
		Presentation any    `json:"presentation,omitempty"`
	}
	entries := make([]presentationEntry, 0, len(tools))
	for _, tool := range tools {
		name := strings.TrimSpace(tool.Name)
		if name == "" {
			continue
		}
		entries = append(entries, presentationEntry{
			Name:         name,
			Presentation: canonicalStructValue(tool.Presentation),
		})
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name < entries[j].Name })
	return stableJSONHash(entries)
}

func canonicalJSONValue(raw json.RawMessage) any {
	if len(raw) == 0 {
		return nil
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return strings.TrimSpace(string(raw))
	}
	return value
}

func canonicalStructValue(value any) any {
	payload, err := json.Marshal(value)
	if err != nil {
		return fmt.Sprintf("%v", value)
	}
	var out any
	if err := json.Unmarshal(payload, &out); err != nil {
		return string(payload)
	}
	return out
}

func stableJSONHash(value any) string {
	payload, _ := json.Marshal(value)
	sum := sha256.Sum256(payload)
	return base64.RawURLEncoding.EncodeToString(sum[:])
}
