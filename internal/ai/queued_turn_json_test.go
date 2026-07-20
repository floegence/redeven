package ai

import (
	"strings"
	"testing"
)

func TestQueuedTurnJSONRejectsUnsupportedShapes(t *testing.T) {
	tests := []struct {
		name string
		run  func(string) error
		raw  string
	}{
		{name: "session unknown field", raw: `{"channel_id":"channel","endpoint_id":"env","unknown":true}`, run: func(raw string) error { _, err := unmarshalQueuedTurnSessionMeta(raw); return err }},
		{name: "session multiple values", raw: `{"channel_id":"channel","endpoint_id":"env"} {}`, run: func(raw string) error { _, err := unmarshalQueuedTurnSessionMeta(raw); return err }},
		{name: "attachment unknown field", raw: `[{"url":"/_redeven_proxy/api/ai/uploads/upl_1","unknown":true}]`, run: func(raw string) error { _, err := unmarshalQueuedTurnAttachments(raw); return err }},
		{name: "attachment multiple values", raw: `[] []`, run: func(raw string) error { _, err := unmarshalQueuedTurnAttachments(raw); return err }},
		{name: "context action unknown field", raw: `{"unknown":true}`, run: func(raw string) error { _, err := unmarshalQueuedTurnContextAction(raw); return err }},
		{name: "context action multiple values", raw: `{} {}`, run: func(raw string) error { _, err := unmarshalQueuedTurnContextAction(raw); return err }},
		{name: "options unknown field", raw: `{"unknown":true}`, run: func(raw string) error { _, err := unmarshalQueuedTurnOptions(raw); return err }},
		{name: "options multiple values", raw: `{} {}`, run: func(raw string) error { _, err := unmarshalQueuedTurnOptions(raw); return err }},
	}
	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			if err := testCase.run(testCase.raw); err == nil || (!strings.Contains(err.Error(), "unknown field") && !strings.Contains(err.Error(), "multiple JSON values") && !strings.Contains(err.Error(), "trailing JSON")) {
				t.Fatalf("error=%v, want strict JSON rejection", err)
			}
		})
	}
}
