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

const (
	permissionSnapshotVersionLegacy  = 1
	permissionSnapshotVersionCurrent = 2
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
	Visibility       ToolVisibilityClass   `json:"visibility"`
	Capabilities     []ToolCapabilityClass `json:"capabilities,omitempty"`
	ResourceKinds    []string              `json:"resource_kinds,omitempty"`
	ApprovalDecision ApprovalDecisionKind  `json:"approval_decision"`
}

type PermissionSnapshot struct {
	Version               int                             `json:"version"`
	SnapshotID            string                          `json:"snapshot_id,omitempty"`
	PermissionType        FlowerPermissionType            `json:"permission_type"`
	VisibleToolNames      []string                        `json:"visible_tool_names"`
	PromptCapabilityNames []string                        `json:"prompt_capability_names"`
	FloretToolNames       []string                        `json:"floret_tool_names"`
	ToolPolicies          map[string]ToolPermissionPolicy `json:"tool_policies"`
	SnapshotHash          string                          `json:"snapshot_hash,omitempty"`
	RegistryHash          string                          `json:"registry_hash,omitempty"`
	SchemaHash            string                          `json:"schema_hash,omitempty"`
	PresentationHash      string                          `json:"presentation_hash,omitempty"`
	legacyConcurrency     map[string]bool                 `json:"-"`
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

func validateChildPermissionSnapshotSubset(parent PermissionSnapshot, child PermissionSnapshot) error {
	if parent.PermissionType == "" || child.PermissionType == "" {
		return fmt.Errorf("permission snapshot subset has missing permission type")
	}
	if parent.PermissionType != child.PermissionType {
		return fmt.Errorf("child permission snapshot permission type %q differs from parent %q", child.PermissionType, parent.PermissionType)
	}
	if err := ensureStringListSubset("visible tools", child.VisibleToolNames, parent.VisibleToolNames); err != nil {
		return err
	}
	if err := ensureStringListSubset("prompt capabilities", child.PromptCapabilityNames, parent.PromptCapabilityNames); err != nil {
		return err
	}
	if err := ensureStringListSubset("floret tools", child.FloretToolNames, parent.FloretToolNames); err != nil {
		return err
	}
	for name, childPolicy := range child.ToolPolicies {
		name = strings.TrimSpace(name)
		if name == "" {
			return fmt.Errorf("child permission snapshot has empty policy name")
		}
		parentPolicy, ok := parent.ToolPolicies[name]
		if !ok {
			return fmt.Errorf("child permission snapshot policy %q is not present in parent", name)
		}
		if err := validateChildToolPolicySubset(name, parentPolicy, childPolicy); err != nil {
			return err
		}
	}
	return nil
}

func ensureStringListSubset(label string, child []string, parent []string) error {
	parentSet := make(map[string]struct{}, len(parent))
	for _, item := range parent {
		item = strings.TrimSpace(item)
		if item != "" {
			parentSet[item] = struct{}{}
		}
	}
	for _, item := range child {
		item = strings.TrimSpace(item)
		if item == "" {
			return fmt.Errorf("child permission snapshot has empty %s entry", label)
		}
		if _, ok := parentSet[item]; !ok {
			return fmt.Errorf("child permission snapshot %s entry %q is not present in parent", label, item)
		}
	}
	return nil
}

func validateChildToolPolicySubset(name string, parent ToolPermissionPolicy, child ToolPermissionPolicy) error {
	if parent.Visibility != child.Visibility {
		return fmt.Errorf("child permission snapshot policy %q visibility %q differs from parent %q", name, child.Visibility, parent.Visibility)
	}
	if err := ensureCapabilitySubset(name, child.Capabilities, parent.Capabilities); err != nil {
		return err
	}
	if err := ensureStringListSubset("resource kinds for policy "+name, child.ResourceKinds, parent.ResourceKinds); err != nil {
		return err
	}
	parentDecisionRank := approvalDecisionRank(parent.ApprovalDecision)
	childDecisionRank := approvalDecisionRank(child.ApprovalDecision)
	if parentDecisionRank < 0 || childDecisionRank < 0 {
		return fmt.Errorf("child permission snapshot policy %q has invalid approval decision", name)
	}
	if childDecisionRank < parentDecisionRank {
		return fmt.Errorf("child permission snapshot policy %q weakens approval decision from %q to %q", name, parent.ApprovalDecision, child.ApprovalDecision)
	}
	return nil
}

func ensureCapabilitySubset(name string, child []ToolCapabilityClass, parent []ToolCapabilityClass) error {
	parentSet := make(map[ToolCapabilityClass]struct{}, len(parent))
	for _, item := range parent {
		if item != "" {
			parentSet[item] = struct{}{}
		}
	}
	for _, item := range child {
		if item == "" {
			return fmt.Errorf("child permission snapshot policy %q has empty capability", name)
		}
		if _, ok := parentSet[item]; !ok {
			return fmt.Errorf("child permission snapshot policy %q capability %q is not present in parent", name, item)
		}
	}
	return nil
}

func approvalDecisionRank(decision ApprovalDecisionKind) int {
	switch decision {
	case ApprovalDecisionAllow:
		return 0
	case ApprovalDecisionAsk:
		return 1
	case ApprovalDecisionDeny:
		return 2
	default:
		return -1
	}
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
	if snapshot.Version == 0 {
		snapshot.Version = permissionSnapshotVersionCurrent
	}
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
	if snapshot.Version == permissionSnapshotVersionLegacy {
		return permissionSnapshotHashV1(snapshot)
	}
	version := snapshot.Version
	if version == 0 {
		version = permissionSnapshotVersionCurrent
	}
	type hashView struct {
		Version               int                             `json:"version"`
		PermissionType        FlowerPermissionType            `json:"permission_type"`
		VisibleToolNames      []string                        `json:"visible_tool_names"`
		PromptCapabilityNames []string                        `json:"prompt_capability_names"`
		FloretToolNames       []string                        `json:"floret_tool_names"`
		ToolPolicies          map[string]ToolPermissionPolicy `json:"tool_policies"`
		RegistryHash          string                          `json:"registry_hash,omitempty"`
		SchemaHash            string                          `json:"schema_hash,omitempty"`
		PresentationHash      string                          `json:"presentation_hash,omitempty"`
	}
	view := hashView{
		Version:               version,
		PermissionType:        snapshot.PermissionType,
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
	payload, _ := json.Marshal(view)
	sum := sha256.Sum256(payload)
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

type permissionSnapshotPolicyV1 struct {
	Visibility        ToolVisibilityClass
	Capabilities      []ToolCapabilityClass
	ResourceKinds     []string
	ApprovalDecision  ApprovalDecisionKind
	LegacyConcurrency bool `json:"-"`
}

func (p permissionSnapshotPolicyV1) MarshalJSON() ([]byte, error) {
	type stablePrefix struct {
		Visibility       ToolVisibilityClass
		Capabilities     []ToolCapabilityClass
		ResourceKinds    []string
		ApprovalDecision ApprovalDecisionKind
	}
	prefix, err := json.Marshal(stablePrefix{
		Visibility:       p.Visibility,
		Capabilities:     p.Capabilities,
		ResourceKinds:    p.ResourceKinds,
		ApprovalDecision: p.ApprovalDecision,
	})
	if err != nil {
		return nil, err
	}
	key, _ := json.Marshal("Parallel" + "Safe")
	value, _ := json.Marshal(p.LegacyConcurrency)
	return append(append(append(prefix[:len(prefix)-1], ','), append(key, ':')...), append(value, '}')...), nil
}

func (p *permissionSnapshotPolicyV1) UnmarshalJSON(data []byte) error {
	if p == nil {
		return nil
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	decode := func(key string, target any) error {
		value, ok := raw[key]
		if !ok {
			return nil
		}
		return json.Unmarshal(value, target)
	}
	if err := decode("Visibility", &p.Visibility); err != nil {
		return err
	}
	if err := decode("Capabilities", &p.Capabilities); err != nil {
		return err
	}
	if err := decode("ResourceKinds", &p.ResourceKinds); err != nil {
		return err
	}
	if err := decode("ApprovalDecision", &p.ApprovalDecision); err != nil {
		return err
	}
	return decode("Parallel"+"Safe", &p.LegacyConcurrency)
}

type permissionSnapshotV1 struct {
	SnapshotID            string
	PermissionType        FlowerPermissionType
	VisibleToolNames      []string
	PromptCapabilityNames []string
	FloretToolNames       []string
	ToolPolicies          map[string]permissionSnapshotPolicyV1
	SnapshotHash          string
	RegistryHash          string
	SchemaHash            string
	PresentationHash      string
}

func permissionSnapshotHashV1(snapshot PermissionSnapshot) string {
	type hashView struct {
		PermissionType        FlowerPermissionType                  `json:"permission_type"`
		VisibleToolNames      []string                              `json:"visible_tool_names"`
		PromptCapabilityNames []string                              `json:"prompt_capability_names"`
		FloretToolNames       []string                              `json:"floret_tool_names"`
		ToolPolicies          map[string]permissionSnapshotPolicyV1 `json:"tool_policies"`
		RegistryHash          string                                `json:"registry_hash,omitempty"`
		SchemaHash            string                                `json:"schema_hash,omitempty"`
		PresentationHash      string                                `json:"presentation_hash,omitempty"`
	}
	policies := make(map[string]permissionSnapshotPolicyV1, len(snapshot.ToolPolicies))
	for name, policy := range snapshot.ToolPolicies {
		policies[name] = permissionSnapshotPolicyV1{
			Visibility:        policy.Visibility,
			Capabilities:      append([]ToolCapabilityClass(nil), policy.Capabilities...),
			ResourceKinds:     append([]string(nil), policy.ResourceKinds...),
			ApprovalDecision:  policy.ApprovalDecision,
			LegacyConcurrency: snapshot.legacyConcurrency[name],
		}
	}
	view := hashView{
		PermissionType:        snapshot.PermissionType,
		VisibleToolNames:      append([]string(nil), snapshot.VisibleToolNames...),
		PromptCapabilityNames: append([]string(nil), snapshot.PromptCapabilityNames...),
		FloretToolNames:       append([]string(nil), snapshot.FloretToolNames...),
		ToolPolicies:          policies,
		RegistryHash:          strings.TrimSpace(snapshot.RegistryHash),
		SchemaHash:            strings.TrimSpace(snapshot.SchemaHash),
		PresentationHash:      strings.TrimSpace(snapshot.PresentationHash),
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

type permissionRegistryEntryV1 struct {
	Name              string
	Description       string
	LegacyConcurrency bool
	Mutating          bool
	RequiresApproval  bool
	Visibility        ToolVisibilityClass
	Capabilities      []ToolCapabilityClass
	Source            string
	Namespace         string
}

func (entry permissionRegistryEntryV1) MarshalJSON() ([]byte, error) {
	var payload strings.Builder
	payload.WriteByte('{')
	writeField := func(name string, value any, omit bool) error {
		if omit {
			return nil
		}
		encoded, err := json.Marshal(value)
		if err != nil {
			return err
		}
		if payload.Len() > 1 {
			payload.WriteByte(',')
		}
		key, _ := json.Marshal(name)
		payload.Write(key)
		payload.WriteByte(':')
		payload.Write(encoded)
		return nil
	}
	fields := []struct {
		name  string
		value any
		omit  bool
	}{
		{name: "name", value: entry.Name},
		{name: "description", value: entry.Description, omit: entry.Description == ""},
		{name: "parallel" + "_" + "safe", value: entry.LegacyConcurrency, omit: !entry.LegacyConcurrency},
		{name: "mutating", value: entry.Mutating, omit: !entry.Mutating},
		{name: "requires_approval", value: entry.RequiresApproval, omit: !entry.RequiresApproval},
		{name: "visibility", value: entry.Visibility, omit: entry.Visibility == ""},
		{name: "capabilities", value: entry.Capabilities, omit: len(entry.Capabilities) == 0},
		{name: "source", value: entry.Source, omit: entry.Source == ""},
		{name: "namespace", value: entry.Namespace, omit: entry.Namespace == ""},
	}
	for _, field := range fields {
		if err := writeField(field.name, field.value, field.omit); err != nil {
			return nil, err
		}
	}
	payload.WriteByte('}')
	return []byte(payload.String()), nil
}

func stableToolRegistryHashV1(tools []ToolDef, legacyConcurrency map[string]bool) string {
	entries := make([]permissionRegistryEntryV1, 0, len(tools))
	for _, tool := range tools {
		tool = normalizeToolPermissionMetadata(tool)
		name := strings.TrimSpace(tool.Name)
		if name == "" {
			continue
		}
		capabilities := append([]ToolCapabilityClass(nil), tool.Capabilities...)
		sort.Slice(capabilities, func(i, j int) bool { return capabilities[i] < capabilities[j] })
		entries = append(entries, permissionRegistryEntryV1{
			Name:              name,
			Description:       strings.TrimSpace(tool.Description),
			LegacyConcurrency: legacyConcurrency[name],
			Mutating:          tool.Mutating,
			RequiresApproval:  tool.RequiresApproval,
			Visibility:        tool.Visibility,
			Capabilities:      capabilities,
			Source:            strings.TrimSpace(tool.Source),
			Namespace:         strings.TrimSpace(tool.Namespace),
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
