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
	if in.Error != nil {
		out.Error = &TurnError{
			Message:           strings.TrimSpace(in.Error.Message),
			AdditionalDetails: strings.TrimSpace(stringValue(in.Error.AdditionalDetails)),
			CodexErrorCode:    normalizeCodexErrorInfo(in.Error.CodexErrorInfo),
		}
	}
	if len(in.Items) > 0 {
		out.Items = make([]Item, 0, len(in.Items))
		for i := range in.Items {
			out.Items = append(out.Items, normalizeItem(in.Items[i]))
		}
	}
	return out
}

func normalizeItem(in wireThreadItem) Item {
	out := Item{
		ID:     strings.TrimSpace(in.ID),
		Type:   strings.TrimSpace(in.Type),
		Text:   strings.TrimSpace(in.Text),
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
	return out
}

func normalizeUserInput(in wireUserInput) UserInputEntry {
	return UserInputEntry{
		Type: strings.TrimSpace(in.Type),
		Text: strings.TrimSpace(in.Text),
		URL:  strings.TrimSpace(in.URL),
		Path: strings.TrimSpace(in.Path),
		Name: strings.TrimSpace(in.Name),
	}
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
		entry := strings.TrimSpace(inputs[i].Text)
		if entry != "" {
			parts = append(parts, entry)
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
