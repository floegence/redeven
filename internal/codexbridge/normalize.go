package codexbridge

import (
	"bytes"
	"encoding/json"
	"strconv"
	"strings"
)

func normalizeThread(in wireThread) Thread {
	out := Thread{
		ID:             strings.TrimSpace(in.ID),
		Preview:        strings.TrimSpace(in.Preview),
		Ephemeral:      in.Ephemeral,
		ModelProvider:  strings.TrimSpace(in.ModelProvider),
		CreatedAtUnixS: in.CreatedAt,
		UpdatedAtUnixS: in.UpdatedAt,
		Status:         strings.TrimSpace(in.Status.Type),
		ActiveFlags:    append([]string(nil), in.Status.ActiveFlags...),
		Path:           strings.TrimSpace(stringValue(in.Path)),
		CWD:            strings.TrimSpace(in.CWD),
		CLIVersion:     strings.TrimSpace(in.CLIVersion),
		Source:         strings.TrimSpace(in.Source),
		AgentNickname:  strings.TrimSpace(stringValue(in.AgentNickname)),
		AgentRole:      strings.TrimSpace(stringValue(in.AgentRole)),
		Name:           strings.TrimSpace(stringValue(in.Name)),
	}
	if len(in.Turns) > 0 {
		out.Turns = make([]Turn, 0, len(in.Turns))
		for i := range in.Turns {
			out.Turns = append(out.Turns, normalizeTurn(in.Turns[i]))
		}
	}
	return out
}

func normalizeTurn(in wireTurn) Turn {
	out := Turn{
		ID:     strings.TrimSpace(in.ID),
		Status: strings.TrimSpace(in.Status),
	}
	out.Error = normalizeTurnError(in.Error)
	if len(in.Items) > 0 {
		out.Items = make([]Item, 0, len(in.Items))
		for i := range in.Items {
			out.Items = append(out.Items, normalizeItem(in.Items[i]))
		}
	}
	return out
}

func normalizeTurnError(in *wireTurnError) *TurnError {
	if in == nil {
		return nil
	}
	return &TurnError{
		Message:           strings.TrimSpace(in.Message),
		AdditionalDetails: strings.TrimSpace(stringValue(in.AdditionalDetails)),
		CodexErrorCode:    normalizeCodexErrorInfo(in.CodexErrorInfo),
	}
}

func normalizeItem(in wireThreadItem) Item {
	itemType := strings.TrimSpace(in.Type)
	text := strings.TrimSpace(in.Text)
	if itemType == "userMessage" {
		text = in.Text
	}
	out := Item{
		ID:     strings.TrimSpace(in.ID),
		Type:   itemType,
		Text:   text,
		Phase:  strings.TrimSpace(stringValue(in.Phase)),
		Status: strings.TrimSpace(in.Status),
	}
	if len(in.Summary) > 0 {
		out.Summary = append([]string(nil), in.Summary...)
	}
	out.Content = normalizeItemContent(in)
	out.Command = strings.TrimSpace(in.Command)
	out.CWD = strings.TrimSpace(in.CWD)
	out.AggregatedOutput = strings.TrimSpace(stringValue(in.AggregatedOutput))
	if in.ExitCode != nil {
		code := *in.ExitCode
		out.ExitCode = &code
	}
	if in.DurationMs != nil {
		dur := *in.DurationMs
		out.DurationMs = &dur
	}
	if len(in.Changes) > 0 {
		out.Changes = make([]FileChange, 0, len(in.Changes))
		for i := range in.Changes {
			change := FileChange{
				Path: strings.TrimSpace(in.Changes[i].Path),
				Kind: strings.TrimSpace(in.Changes[i].Kind.Type),
				Diff: in.Changes[i].Diff,
			}
			change.MovePath = strings.TrimSpace(stringValue(in.Changes[i].Kind.MovePath))
			out.Changes = append(out.Changes, change)
		}
	}
	if len(in.Content) > 0 {
		out.Inputs = make([]UserInputEntry, 0, len(in.Content))
		for i := range in.Content {
			out.Inputs = append(out.Inputs, normalizeUserInput(in.Content[i]))
		}
		if out.Text == "" {
			out.Text = userInputsToText(in.Content)
		}
	}
	out.Query = strings.TrimSpace(in.Query)
	out.Action = normalizeWebSearchAction(in.Action)
	if out.Query == "" {
		out.Query = defaultWebSearchQuery(out.Action)
	}
	return out
}

func normalizeRawResponseItem(in wireResponseItem, fallbackID string) (Item, bool) {
	switch strings.TrimSpace(in.Type) {
	case "web_search_call":
		action := normalizeWebSearchAction(in.Action)
		item := Item{
			ID:     normalizeRawResponseItemID(in, fallbackID),
			Type:   "webSearch",
			Status: strings.TrimSpace(stringValue(in.Status)),
			Query:  defaultWebSearchQuery(action),
			Action: action,
		}
		return item, strings.TrimSpace(item.ID) != ""
	default:
		return Item{}, false
	}
}

func normalizeRawResponseItemID(in wireResponseItem, fallbackID string) string {
	if id := strings.TrimSpace(stringValue(in.ID)); id != "" {
		return id
	}
	return strings.TrimSpace(fallbackID)
}

func normalizeUserInput(in wireUserInput) UserInputEntry {
	out := UserInputEntry{
		Type: strings.TrimSpace(in.Type),
		Text: in.Text,
		URL:  strings.TrimSpace(in.URL),
		Path: strings.TrimSpace(in.Path),
		Name: strings.TrimSpace(in.Name),
	}
	if len(in.TextElements) > 0 {
		out.TextElements = normalizeTextElements(in.TextElements)
	}
	return out
}

func normalizeTextElements(in []wireTextElement) []TextElement {
	out := make([]TextElement, 0, len(in))
	for i := range in {
		element := TextElement{
			Start: in[i].Start,
			End:   in[i].End,
		}
		if placeholder := strings.TrimSpace(stringValue(in[i].Placeholder)); placeholder != "" {
			element.Placeholder = placeholder
		}
		out = append(out, element)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func normalizeWebSearchAction(in *wireWebSearchAction) *WebSearchAction {
	if in == nil {
		return nil
	}
	out := &WebSearchAction{
		Type: normalizeWebSearchActionType(in.Type),
	}
	if query := strings.TrimSpace(stringValue(in.Query)); query != "" {
		out.Query = query
	}
	if len(in.Queries) > 0 {
		out.Queries = make([]string, 0, len(in.Queries))
		for _, query := range in.Queries {
			if trimmed := strings.TrimSpace(query); trimmed != "" {
				out.Queries = append(out.Queries, trimmed)
			}
		}
	}
	if url := strings.TrimSpace(stringValue(in.URL)); url != "" {
		out.URL = url
	}
	if pattern := strings.TrimSpace(stringValue(in.Pattern)); pattern != "" {
		out.Pattern = pattern
	}
	if out.Type == "" && out.Query == "" && len(out.Queries) == 0 && out.URL == "" && out.Pattern == "" {
		return nil
	}
	return out
}

func normalizeWebSearchActionType(raw string) string {
	switch strings.TrimSpace(raw) {
	case "search":
		return "search"
	case "open_page", "openPage":
		return "openPage"
	case "find_in_page", "findInPage":
		return "findInPage"
	default:
		return strings.TrimSpace(raw)
	}
}

func defaultWebSearchQuery(action *WebSearchAction) string {
	if action == nil {
		return ""
	}
	if query := strings.TrimSpace(action.Query); query != "" {
		return query
	}
	for _, query := range action.Queries {
		if trimmed := strings.TrimSpace(query); trimmed != "" {
			return trimmed
		}
	}
	if url := strings.TrimSpace(action.URL); url != "" {
		return url
	}
	return strings.TrimSpace(action.Pattern)
}

func normalizeThreadRuntimeConfig(
	model string,
	modelProvider string,
	cwd string,
	approvalPolicy json.RawMessage,
	approvalsReviewer string,
	sandbox wireSandboxPolicy,
	reasoningEffort *string,
) ThreadRuntimeConfig {
	return ThreadRuntimeConfig{
		Model:             strings.TrimSpace(model),
		ModelProvider:     strings.TrimSpace(modelProvider),
		CWD:               strings.TrimSpace(cwd),
		ApprovalPolicy:    normalizeApprovalPolicyValue(approvalPolicy),
		ApprovalsReviewer: strings.TrimSpace(approvalsReviewer),
		SandboxMode:       normalizeSandboxModeValue(sandbox.Type),
		ReasoningEffort:   strings.TrimSpace(stringValue(reasoningEffort)),
	}
}

func normalizeThreadTokenUsage(in wireThreadTokenUsage) *ThreadTokenUsage {
	out := &ThreadTokenUsage{
		Total: normalizeTokenUsageBreakdown(in.Total),
		Last:  normalizeTokenUsageBreakdown(in.Last),
	}
	if in.ModelContextWindow != nil {
		window := *in.ModelContextWindow
		out.ModelContextWindow = &window
	}
	return out
}

func normalizeTokenUsageBreakdown(in wireTokenUsageBreakdown) TokenUsageBreakdown {
	return TokenUsageBreakdown(in)
}

func normalizeEffectiveConfig(in wireConfig, cwd string) ThreadRuntimeConfig {
	return ThreadRuntimeConfig{
		Model:             strings.TrimSpace(stringValue(in.Model)),
		ModelProvider:     strings.TrimSpace(stringValue(in.ModelProvider)),
		CWD:               strings.TrimSpace(cwd),
		ApprovalPolicy:    normalizeApprovalPolicyValue(in.ApprovalPolicy),
		ApprovalsReviewer: strings.TrimSpace(stringValue(in.ApprovalsReviewer)),
		SandboxMode:       normalizeSandboxModeValue(stringValue(in.SandboxMode)),
		ReasoningEffort:   strings.TrimSpace(stringValue(in.ModelReasoningEffort)),
	}
}

func normalizeModelOption(in wireModel) ModelOption {
	out := ModelOption{
		ID:                     strings.TrimSpace(in.ID),
		DisplayName:            strings.TrimSpace(in.DisplayName),
		Description:            strings.TrimSpace(in.Description),
		IsDefault:              in.IsDefault,
		DefaultReasoningEffort: strings.TrimSpace(in.DefaultReasoningEffort),
	}
	if len(in.SupportedReasoningEfforts) > 0 {
		seen := make(map[string]struct{}, len(in.SupportedReasoningEfforts))
		out.SupportedReasoningEfforts = make([]string, 0, len(in.SupportedReasoningEfforts))
		for i := range in.SupportedReasoningEfforts {
			value := strings.TrimSpace(in.SupportedReasoningEfforts[i].ReasoningEffort)
			if value == "" {
				continue
			}
			if _, ok := seen[value]; ok {
				continue
			}
			seen[value] = struct{}{}
			out.SupportedReasoningEfforts = append(out.SupportedReasoningEfforts, value)
		}
	}
	for i := range in.InputModalities {
		if strings.EqualFold(strings.TrimSpace(in.InputModalities[i]), "image") {
			out.SupportsImageInput = true
			break
		}
	}
	return out
}

func normalizeConfigRequirements(in *wireConfigRequirements) *ConfigRequirements {
	if in == nil {
		return nil
	}
	out := &ConfigRequirements{}
	if len(in.AllowedApprovalPolicies) > 0 {
		seen := map[string]struct{}{}
		for i := range in.AllowedApprovalPolicies {
			value := normalizeApprovalPolicyValue(in.AllowedApprovalPolicies[i])
			if value == "" {
				continue
			}
			if _, ok := seen[value]; ok {
				continue
			}
			seen[value] = struct{}{}
			out.AllowedApprovalPolicies = append(out.AllowedApprovalPolicies, value)
		}
	}
	if len(in.AllowedSandboxModes) > 0 {
		seen := map[string]struct{}{}
		for i := range in.AllowedSandboxModes {
			value := normalizeSandboxModeValue(in.AllowedSandboxModes[i])
			if value == "" {
				continue
			}
			if _, ok := seen[value]; ok {
				continue
			}
			seen[value] = struct{}{}
			out.AllowedSandboxModes = append(out.AllowedSandboxModes, value)
		}
	}
	if len(out.AllowedApprovalPolicies) == 0 && len(out.AllowedSandboxModes) == 0 {
		return nil
	}
	return out
}

func normalizePermissionProfile(in *wirePermissionProfile) *PermissionProfile {
	if in == nil {
		return nil
	}
	out := &PermissionProfile{}
	if in.FileSystem != nil {
		if len(in.FileSystem.Read) > 0 {
			out.FileSystemRead = append([]string(nil), in.FileSystem.Read...)
		}
		if len(in.FileSystem.Write) > 0 {
			out.FileSystemWrite = append([]string(nil), in.FileSystem.Write...)
		}
	}
	if in.Network != nil && in.Network.Enabled != nil {
		v := *in.Network.Enabled
		out.NetworkEnabled = &v
	}
	if len(out.FileSystemRead) == 0 && len(out.FileSystemWrite) == 0 && out.NetworkEnabled == nil {
		return nil
	}
	return out
}

func normalizeUserQuestions(in []wireUserInputQuestion) []UserInputQuestion {
	if len(in) == 0 {
		return nil
	}
	out := make([]UserInputQuestion, 0, len(in))
	for i := range in {
		q := UserInputQuestion{
			ID:       strings.TrimSpace(in[i].ID),
			Header:   strings.TrimSpace(in[i].Header),
			Question: strings.TrimSpace(in[i].Question),
			IsOther:  in[i].IsOther,
			IsSecret: in[i].IsSecret,
		}
		if len(in[i].Options) > 0 {
			q.Options = make([]UserInputOption, 0, len(in[i].Options))
			for j := range in[i].Options {
				q.Options = append(q.Options, UserInputOption{
					Label:       strings.TrimSpace(in[i].Options[j].Label),
					Description: strings.TrimSpace(in[i].Options[j].Description),
				})
			}
		}
		out = append(out, q)
	}
	return out
}

func normalizeAvailableDecisions(raw []json.RawMessage) []string {
	if len(raw) == 0 {
		return nil
	}
	seen := map[string]struct{}{}
	out := make([]string, 0, len(raw))
	for _, candidate := range raw {
		decision := ""
		var simple string
		if err := json.Unmarshal(candidate, &simple); err == nil {
			switch simple {
			case "accept":
				decision = "accept"
			case "acceptForSession":
				decision = "accept_for_session"
			case "decline":
				decision = "decline"
			case "cancel":
				decision = "cancel"
			}
		}
		if decision == "" {
			var complex map[string]json.RawMessage
			if err := json.Unmarshal(candidate, &complex); err == nil {
				switch {
				case complex["acceptWithExecpolicyAmendment"] != nil:
					decision = "accept"
				case complex["applyNetworkPolicyAmendment"] != nil:
					decision = "accept"
				}
			}
		}
		if decision == "" {
			continue
		}
		if _, ok := seen[decision]; ok {
			continue
		}
		seen[decision] = struct{}{}
		out = append(out, decision)
	}
	return out
}

func normalizeCodexErrorInfo(raw json.RawMessage) string {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || bytes.Equal(raw, []byte("null")) {
		return ""
	}
	var text string
	if err := json.Unmarshal(raw, &text); err == nil {
		return strings.TrimSpace(text)
	}
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(raw, &obj); err == nil {
		for k := range obj {
			return strings.TrimSpace(k)
		}
	}
	return strings.TrimSpace(string(raw))
}

func normalizeExternalRequestID(raw json.RawMessage) string {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 {
		return ""
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return strings.TrimSpace(s)
	}
	var n int64
	if err := json.Unmarshal(raw, &n); err == nil {
		return strconv.FormatInt(n, 10)
	}
	return strings.TrimSpace(string(raw))
}

func normalizeApprovalPolicyValue(raw json.RawMessage) string {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || bytes.Equal(raw, []byte("null")) {
		return ""
	}
	var text string
	if err := json.Unmarshal(raw, &text); err == nil {
		return strings.TrimSpace(text)
	}
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(raw, &obj); err == nil && len(obj) > 0 {
		return "granular"
	}
	return ""
}

func normalizeSandboxModeValue(raw string) string {
	switch strings.TrimSpace(raw) {
	case "readOnly":
		return "read-only"
	case "workspaceWrite":
		return "workspace-write"
	case "dangerFullAccess":
		return "danger-full-access"
	case "externalSandbox":
		return "external-sandbox"
	default:
		return strings.TrimSpace(raw)
	}
}

func pendingResponseKey(raw json.RawMessage) string {
	return strings.TrimSpace(string(bytes.TrimSpace(raw)))
}

func stringValue[T ~string](v *T) string {
	if v == nil {
		return ""
	}
	return string(*v)
}

func userInputsToText(inputs []wireUserInput) string {
	parts := make([]string, 0, len(inputs))
	for i := range inputs {
		entry := strings.ReplaceAll(inputs[i].Text, "\r\n", "\n")
		if strings.TrimSpace(entry) != "" {
			parts = append(parts, strings.TrimRight(entry, "\n"))
			continue
		}
		if path := strings.TrimSpace(inputs[i].Path); path != "" {
			parts = append(parts, path)
		}
	}
	return strings.Join(parts, "\n\n")
}

func normalizeItemContent(in wireThreadItem) []string {
	switch strings.TrimSpace(in.Type) {
	case "reasoning":
		return append([]string(nil), in.Summary...)
	default:
		return nil
	}
}
