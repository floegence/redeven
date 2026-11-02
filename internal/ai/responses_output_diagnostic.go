package ai

import (
	"sort"

	flprovider "github.com/floegence/floret/v7/provider"
)

// Product transport projection of upstream structural facts; no native values.
type responsesOutputDiagnostic struct {
	OutputIndex   int64    `json:"output_index"`
	ItemType      string   `json:"item_type"`
	PreviousEvent string   `json:"previous_event"`
	CurrentEvent  string   `json:"current_event"`
	Paths         []string `json:"paths"`
	Difference    string   `json:"difference"`
	SourcesBefore *int     `json:"sources_before,omitempty"`
	SourcesAfter  *int     `json:"sources_after,omitempty"`
	Selected      string   `json:"selected,omitempty"`
}

func projectResponsesOutputDiagnostic(d flprovider.ResponsesOutputDiagnostic) responsesOutputDiagnostic {
	return responsesOutputDiagnostic{OutputIndex: d.OutputIndex, ItemType: d.ItemType, PreviousEvent: d.PreviousEvent, CurrentEvent: d.CurrentEvent, Paths: append([]string(nil), d.Paths...), Difference: d.Difference, SourcesBefore: d.SourcesBefore, SourcesAfter: d.SourcesAfter, Selected: d.Selected}
}

func (d *responsesOutputDiagnostic) sanitized() *responsesOutputDiagnostic {
	if d == nil || d.OutputIndex < 0 {
		return nil
	}
	out := *d
	switch out.ItemType {
	case "reasoning", "message", "web_search_call", "function_call", "other":
	default:
		out.ItemType = "other"
	}
	if out.PreviousEvent != "response.output_item.done" {
		return nil
	}
	switch out.CurrentEvent {
	case "response.output_item.done", "terminal_snapshot":
	default:
		return nil
	}
	switch out.Difference {
	case "value_changed", "sources_changed", "sources_appended", "sources_invalid":
	default:
		out.Difference = "value_changed"
	}
	if out.Selected != "response.output_item.done" {
		out.Selected = ""
	}
	seen := map[string]bool{}
	for _, p := range d.Paths {
		switch p {
		case "id", "type", "status", "role", "content", "summary", "encrypted_content", "call_id", "name", "namespace", "arguments", "action", "phase", "other", "action.type", "action.query", "action.queries", "action.url", "action.pattern", "action.sources", "action.other":
			seen[p] = true
		}
	}
	out.Paths = nil
	for p := range seen {
		out.Paths = append(out.Paths, p)
	}
	sort.Strings(out.Paths)
	count := func(v *int) *int {
		if v == nil || *v < 0 || *v > 8<<20 {
			return nil
		}
		n := *v
		return &n
	}
	out.SourcesBefore = count(d.SourcesBefore)
	out.SourcesAfter = count(d.SourcesAfter)
	return &out
}
