package agent

import (
	"encoding/json"
	"testing"
)

func TestRegisterReqJSON_IncludesRuntimeMetaFields(t *testing.T) {
	payload, err := json.Marshal(registerReq{
		EnvPublicID:      "env_test",
		AgentInstanceID:  "agent_test",
		Version:          "v1.2.3",
		OS:               "darwin",
		Arch:             "arm64",
		Hostname:         "desktop-host",
		EffectiveRunMode: "hybrid",
		RemoteEnabled:    true,
	})
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}

	var out map[string]any
	if err := json.Unmarshal(payload, &out); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}

	if _, ok := out["desktop_managed"]; ok {
		t.Fatalf("desktop_managed must not be serialized: %#v", out["desktop_managed"])
	}
	if out["effective_run_mode"] != "hybrid" {
		t.Fatalf("effective_run_mode = %#v", out["effective_run_mode"])
	}
	if out["remote_enabled"] != true {
		t.Fatalf("remote_enabled = %#v", out["remote_enabled"])
	}
}
