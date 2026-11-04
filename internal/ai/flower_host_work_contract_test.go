package ai

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// The complete public current is produced by the real terminal completion test
// against the published Floret module, after restart. Only identities, timing
// and disposable byte-cost estimates are normalized. Product metadata includes
// the required catalog fields; optional model/context diagnostics are unrelated.
func assertFlowerHostWorkFixture(t *testing.T, detail *FlowerThreadDetail) {
	t.Helper()
	raw, err := json.Marshal(detail)
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatal(err)
	}
	current := value["current"].(map[string]any)
	turns := current["turns"].([]any)
	items := current["items"].([]any)
	replacements := map[string]string{current["thread_id"].(string): "host-work-thread"}
	for i, raw := range turns {
		turn := raw.(map[string]any)
		name := []string{"request", "completion"}[i]
		replacements[turn["turn_id"].(string)] = "turn-" + name
		replacements[turn["run_id"].(string)] = "run-" + name
	}
	for i, raw := range items {
		item := raw.(map[string]any)
		replacements[item["id"].(string)] = []string{"user-request", "tool-command", "answer-running", "answer-completed"}[i]
	}
	var normalize func(any) any
	normalize = func(v any) any {
		switch v := v.(type) {
		case map[string]any:
			if v["path"] == "/payload/duration_ms" {
				v["value"] = float64(10)
			}
			for key, child := range v {
				switch key {
				case "window_bytes":
					delete(v, key)
					continue
				case "started_at_unix_ms", "ended_at_unix_ms":
					v[key] = float64(2000)
					continue
				case "created_at", "output_started_at", "output_ended_at":
					v[key] = "2026-11-04T00:00:00Z"
					continue
				}
				v[key] = normalize(child)
			}
			return v
		case []any:
			for i := range v {
				v[i] = normalize(v[i])
			}
			return v
		case string:
			if replacement, ok := replacements[v]; ok {
				return replacement
			}
			if strings.HasPrefix(v, "terminal-") {
				return "terminal-completion"
			}
			if strings.HasPrefix(v, "host-work-final:") {
				return "host-work-final:completion"
			}
			if strings.HasPrefix(v, "canonical:") {
				return "canonical:fixture"
			}
			if strings.HasPrefix(v, "tp_") {
				return "tp_fixture"
			}
			return v
		}
		return v
	}
	normalize(value)
	for i, raw := range turns {
		turn := raw.(map[string]any)
		start := time.Date(2026, 11, 4, 0, 0, i*2, 0, time.UTC)
		turn["started_at"] = start.Format(time.RFC3339)
		turn["ended_at"] = start.Add(time.Second).Format(time.RFC3339)
		turn["elapsed_ms"], turn["waiting_ms"], turn["work_duration_ms"] = 1000, 0, 1000
	}
	source := value["thread"].(map[string]any)
	thread := map[string]any{}
	for _, key := range []string{"thread_id", "title", "title_status", "title_generation", "model_id", "permission_type", "run_status"} {
		thread[key] = source[key]
	}
	thread["working_dir"] = "/fixture"
	thread["settings_revision"], thread["created_at_unix_ms"], thread["updated_at_unix_ms"] = 1, 1, 4000
	thread["read_status"] = map[string]any{"is_unread": false, "snapshot": map[string]any{"activity_revision": 4000}, "read_state": map[string]any{"last_seen_activity_revision": 4000}}
	value["thread"] = thread
	raw, err = json.MarshalIndent(value, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	raw = append(raw, '\n')
	path := filepath.Join("..", "flower_ui", "src", "testdata", "hostWorkCompletedDetail.json")
	if os.Getenv("UPDATE_FLOWER_HOST_WORK_FIXTURE") == "1" {
		if err := os.WriteFile(path, raw, 0644); err != nil {
			t.Fatal(err)
		}
	}
	expected, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != string(expected) {
		t.Fatal("published host-work detail changed; review with UPDATE_FLOWER_HOST_WORK_FIXTURE=1")
	}
}
