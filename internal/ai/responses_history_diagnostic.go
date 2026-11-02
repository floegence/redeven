package ai

import (
	"errors"
	"sort"

	flprovider "github.com/floegence/floret/v7/provider"
)

// Structural evidence only. Values, native output and private causes never
// cross this boundary, including when diagnostics return through Desktop RPC.
type responsesHistoryDiagnostic struct {
	Reason         string   `json:"reason"`
	RecordIndex    *int     `json:"record_index,omitempty"`
	CanonicalIndex *int     `json:"canonical_index,omitempty"`
	ExpectedItems  *int     `json:"expected_items,omitempty"`
	AvailableItems *int     `json:"available_items,omitempty"`
	Fields         []string `json:"fields,omitempty"`
}

func responsesHistoryFailureDetail(err error) *responsesHistoryDiagnostic {
	var cause *flprovider.ResponsesHistoryError
	if !errors.As(err, &cause) || cause == nil {
		return nil
	}
	return (&responsesHistoryDiagnostic{Reason: cause.Code, RecordIndex: cause.RecordIndex, CanonicalIndex: cause.CanonicalIndex, ExpectedItems: cause.ExpectedItems, AvailableItems: cause.AvailableItems, Fields: cause.Fields}).sanitized()
}

func (d *responsesHistoryDiagnostic) sanitized() *responsesHistoryDiagnostic {
	if d == nil {
		return nil
	}
	switch d.Reason {
	case "missing_identity", "incompatible_identity", "unsupported_policy", "unsupported_attribute", "state_limit", "invalid_records", "trailing_data", "invalid_response_id", "invalid_record", "invalid_boundary", "visible_mismatch", "missing_output", "invalid_item", "invalid_output", "unexpected_namespace", "unsupported_output":
	default:
		return nil
	}
	out := &responsesHistoryDiagnostic{Reason: d.Reason}
	if d.Reason != "visible_mismatch" {
		return out
	}
	index := func(value *int) *int {
		if value == nil || *value < 0 || *value > 1<<30 {
			return nil
		}
		x := *value
		return &x
	}
	out.RecordIndex, out.CanonicalIndex = index(d.RecordIndex), index(d.CanonicalIndex)
	out.ExpectedItems, out.AvailableItems = index(d.ExpectedItems), index(d.AvailableItems)
	seen := map[string]bool{}
	for _, field := range d.Fields {
		switch field {
		case "items", "role", "type", "content", "call_id", "name", "namespace", "arguments", "other":
			if !seen[field] {
				out.Fields = append(out.Fields, field)
				seen[field] = true
			}
		}
	}
	sort.Strings(out.Fields)
	return out
}
