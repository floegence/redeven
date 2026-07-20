package permissionsnapshot

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"
)

const VersionCurrent = 2

type PermissionType string

const (
	PermissionReadonly         PermissionType = "readonly"
	PermissionApprovalRequired PermissionType = "approval_required"
	PermissionFullAccess       PermissionType = "full_access"
)

type VisibilityClass string

const (
	VisibilityReadonlyExclusive VisibilityClass = "readonly_exclusive"
	VisibilityStandard          VisibilityClass = "standard"
	VisibilitySharedReadonly    VisibilityClass = "shared_readonly"
	VisibilityInteraction       VisibilityClass = "interaction"
	VisibilityControl           VisibilityClass = "control"
	VisibilityDelegationControl VisibilityClass = "delegation_control"
)

type CapabilityClass string

const (
	CapabilityReadonlyLocal   CapabilityClass = "readonly_local"
	CapabilityReadonlyNetwork CapabilityClass = "readonly_network"
	CapabilityInteraction     CapabilityClass = "interaction"
	CapabilityMutation        CapabilityClass = "mutation"
	CapabilityShell           CapabilityClass = "shell"
	CapabilityDelegation      CapabilityClass = "delegation"
	CapabilityOpenWorld       CapabilityClass = "open_world"
)

type ApprovalDecision string

const (
	ApprovalAllow ApprovalDecision = "allow"
	ApprovalAsk   ApprovalDecision = "ask"
	ApprovalDeny  ApprovalDecision = "deny"
)

type ToolPolicy struct {
	Visibility       VisibilityClass   `json:"visibility"`
	Capabilities     []CapabilityClass `json:"capabilities,omitempty"`
	ResourceKinds    []string          `json:"resource_kinds,omitempty"`
	ApprovalDecision ApprovalDecision  `json:"approval_decision"`
}

type Snapshot struct {
	Version               int                   `json:"version"`
	SnapshotID            string                `json:"snapshot_id,omitempty"`
	PermissionType        PermissionType        `json:"permission_type"`
	VisibleToolNames      []string              `json:"visible_tool_names"`
	PromptCapabilityNames []string              `json:"prompt_capability_names"`
	FloretToolNames       []string              `json:"floret_tool_names"`
	ToolPolicies          map[string]ToolPolicy `json:"tool_policies"`
	SnapshotHash          string                `json:"snapshot_hash,omitempty"`
	RegistryHash          string                `json:"registry_hash,omitempty"`
	SchemaHash            string                `json:"schema_hash,omitempty"`
	PresentationHash      string                `json:"presentation_hash,omitempty"`
}

type StoredMetadata struct {
	SnapshotID       string
	PermissionType   string
	SnapshotHash     string
	RegistryHash     string
	SchemaHash       string
	PresentationHash string
}

func Validate(snapshot Snapshot) error {
	if snapshot.Version != VersionCurrent {
		return fmt.Errorf("permission snapshot has unsupported version %d", snapshot.Version)
	}
	if !validPermissionType(snapshot.PermissionType) {
		return fmt.Errorf("permission snapshot has invalid permission type %q", snapshot.PermissionType)
	}
	visible, err := uniqueStrings("visible tools", snapshot.VisibleToolNames)
	if err != nil {
		return err
	}
	prompt, err := uniqueStrings("prompt capabilities", snapshot.PromptCapabilityNames)
	if err != nil {
		return err
	}
	if !sameStringSet(visible, prompt) {
		return errors.New("permission snapshot prompt capabilities differ from visible tools")
	}
	floret, err := uniqueStrings("floret tools", snapshot.FloretToolNames)
	if err != nil {
		return err
	}
	for name := range floret {
		if _, ok := visible[name]; !ok {
			return fmt.Errorf("permission snapshot floret tool %q is not visible", name)
		}
		if _, ok := snapshot.ToolPolicies[name]; !ok {
			return fmt.Errorf("permission snapshot floret tool %q is missing policy", name)
		}
	}
	for rawName, policy := range snapshot.ToolPolicies {
		name := strings.TrimSpace(rawName)
		if name == "" || name != rawName {
			return errors.New("permission snapshot has invalid policy name")
		}
		if _, ok := visible[name]; !ok {
			return fmt.Errorf("permission snapshot policy %q is not visible", name)
		}
		if !validVisibility(policy.Visibility) {
			return fmt.Errorf("permission snapshot policy %q has invalid visibility %q", name, policy.Visibility)
		}
		if !validApprovalDecision(policy.ApprovalDecision) {
			return fmt.Errorf("permission snapshot policy %q has invalid approval decision %q", name, policy.ApprovalDecision)
		}
		if err := validateCapabilities(name, policy.Capabilities); err != nil {
			return err
		}
		if _, err := uniqueStrings("resource kinds for "+name, policy.ResourceKinds); err != nil {
			return err
		}
		switch snapshot.PermissionType {
		case PermissionReadonly:
			if policy.Visibility == VisibilityStandard {
				return fmt.Errorf("readonly permission snapshot exposes standard tool %q", name)
			}
		case PermissionApprovalRequired, PermissionFullAccess:
			if policy.Visibility == VisibilityReadonlyExclusive {
				return fmt.Errorf("%s permission snapshot exposes readonly-exclusive tool %q", snapshot.PermissionType, name)
			}
		}
	}
	return nil
}

func Hash(snapshot Snapshot) string {
	if snapshot.Version != VersionCurrent {
		return ""
	}
	type hashView struct {
		Version               int                   `json:"version"`
		PermissionType        PermissionType        `json:"permission_type"`
		VisibleToolNames      []string              `json:"visible_tool_names"`
		PromptCapabilityNames []string              `json:"prompt_capability_names"`
		FloretToolNames       []string              `json:"floret_tool_names"`
		ToolPolicies          map[string]ToolPolicy `json:"tool_policies"`
		RegistryHash          string                `json:"registry_hash,omitempty"`
		SchemaHash            string                `json:"schema_hash,omitempty"`
		PresentationHash      string                `json:"presentation_hash,omitempty"`
	}
	view := hashView{
		Version: snapshot.Version, PermissionType: snapshot.PermissionType,
		VisibleToolNames:      append([]string(nil), snapshot.VisibleToolNames...),
		PromptCapabilityNames: append([]string(nil), snapshot.PromptCapabilityNames...),
		FloretToolNames:       append([]string(nil), snapshot.FloretToolNames...),
		ToolPolicies:          snapshot.ToolPolicies,
		RegistryHash:          strings.TrimSpace(snapshot.RegistryHash),
		SchemaHash:            strings.TrimSpace(snapshot.SchemaHash),
		PresentationHash:      strings.TrimSpace(snapshot.PresentationHash),
	}
	sort.Strings(view.VisibleToolNames)
	sort.Strings(view.PromptCapabilityNames)
	sort.Strings(view.FloretToolNames)
	payload, err := json.Marshal(view)
	if err != nil {
		return ""
	}
	sum := sha256.Sum256(payload)
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func Decode(raw string) (Snapshot, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return Snapshot{}, errors.New("empty permission snapshot")
	}
	var snapshot Snapshot
	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&snapshot); err != nil {
		return Snapshot{}, fmt.Errorf("decode permission snapshot: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			err = errors.New("multiple JSON values")
		}
		return Snapshot{}, fmt.Errorf("decode permission snapshot: %w", err)
	}
	if strings.TrimSpace(snapshot.SnapshotID) == "" || strings.TrimSpace(snapshot.SnapshotHash) == "" {
		return Snapshot{}, errors.New("permission snapshot identity is incomplete")
	}
	if strings.TrimSpace(snapshot.RegistryHash) == "" || strings.TrimSpace(snapshot.SchemaHash) == "" || strings.TrimSpace(snapshot.PresentationHash) == "" {
		return Snapshot{}, errors.New("permission snapshot contract hashes are incomplete")
	}
	if err := Validate(snapshot); err != nil {
		return Snapshot{}, err
	}
	if got := Hash(snapshot); got == "" || got != strings.TrimSpace(snapshot.SnapshotHash) {
		return Snapshot{}, errors.New("permission snapshot hash mismatch")
	}
	return snapshot, nil
}

func Version(raw string) (int, error) {
	var envelope struct {
		Version *int `json:"version"`
	}
	if err := json.Unmarshal([]byte(strings.TrimSpace(raw)), &envelope); err != nil {
		return 0, fmt.Errorf("decode permission snapshot version: %w", err)
	}
	if envelope.Version == nil {
		return 0, errors.New("permission snapshot version is missing")
	}
	return *envelope.Version, nil
}

func ValidateStored(raw string, metadata StoredMetadata) error {
	snapshot, err := Decode(raw)
	if err != nil {
		return err
	}
	checks := []struct {
		label string
		got   string
		want  string
	}{
		{label: "id", got: snapshot.SnapshotID, want: metadata.SnapshotID},
		{label: "permission type", got: string(snapshot.PermissionType), want: metadata.PermissionType},
		{label: "hash", got: snapshot.SnapshotHash, want: metadata.SnapshotHash},
		{label: "registry hash", got: snapshot.RegistryHash, want: metadata.RegistryHash},
		{label: "schema hash", got: snapshot.SchemaHash, want: metadata.SchemaHash},
		{label: "presentation hash", got: snapshot.PresentationHash, want: metadata.PresentationHash},
	}
	for _, check := range checks {
		if strings.TrimSpace(check.want) == "" {
			continue
		}
		if strings.TrimSpace(check.got) != strings.TrimSpace(check.want) {
			return fmt.Errorf("permission snapshot %s mismatch", check.label)
		}
	}
	return nil
}

func validPermissionType(value PermissionType) bool {
	switch value {
	case PermissionReadonly, PermissionApprovalRequired, PermissionFullAccess:
		return true
	default:
		return false
	}
}

func validVisibility(value VisibilityClass) bool {
	switch value {
	case VisibilityReadonlyExclusive, VisibilityStandard, VisibilitySharedReadonly, VisibilityInteraction, VisibilityControl, VisibilityDelegationControl:
		return true
	default:
		return false
	}
}

func validApprovalDecision(value ApprovalDecision) bool {
	switch value {
	case ApprovalAllow, ApprovalAsk, ApprovalDeny:
		return true
	default:
		return false
	}
}

func validateCapabilities(toolName string, values []CapabilityClass) error {
	seen := make(map[CapabilityClass]struct{}, len(values))
	for _, value := range values {
		switch value {
		case CapabilityReadonlyLocal, CapabilityReadonlyNetwork, CapabilityInteraction, CapabilityMutation, CapabilityShell, CapabilityDelegation, CapabilityOpenWorld:
		default:
			return fmt.Errorf("permission snapshot policy %q has invalid capability %q", toolName, value)
		}
		if _, ok := seen[value]; ok {
			return fmt.Errorf("permission snapshot policy %q has duplicate capability %q", toolName, value)
		}
		seen[value] = struct{}{}
	}
	return nil
}

func uniqueStrings(label string, values []string) (map[string]struct{}, error) {
	out := make(map[string]struct{}, len(values))
	for _, raw := range values {
		value := strings.TrimSpace(raw)
		if value == "" || value != raw {
			return nil, fmt.Errorf("permission snapshot has invalid %s entry", label)
		}
		if _, ok := out[value]; ok {
			return nil, fmt.Errorf("permission snapshot has duplicate %s entry %q", label, value)
		}
		out[value] = struct{}{}
	}
	return out, nil
}

func sameStringSet(left map[string]struct{}, right map[string]struct{}) bool {
	if len(left) != len(right) {
		return false
	}
	for value := range left {
		if _, ok := right[value]; !ok {
			return false
		}
	}
	return true
}
