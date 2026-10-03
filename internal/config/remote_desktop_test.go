package config

import (
	"encoding/json"
	"testing"
)

func TestRemoteDesktopApprovalPolicyMigration(t *testing.T) {
	for _, tt := range []struct {
		data    string
		enabled bool
	}{
		{`{}`, true}, {`{"remote_desktop":{}}`, true},
		{`{"remote_desktop":{"unattended":false}}`, true},
		{`{"remote_desktop":{"unattended":true}}`, true},
		{`{"remote_desktop":{"unattended":false,"approval_preference_set":true,"last_display_id":"keep"}}`, false},
		{`{"remote_desktop":{"unattended":true,"approval_preference_set":true}}`, true},
	} {
		var cfg Config
		if err := json.Unmarshal([]byte(tt.data), &cfg); err != nil {
			t.Fatal(err)
		}
		if cfg.RemoteDesktop.RememberApproval() != tt.enabled {
			t.Fatal(tt.data)
		}
		encoded, err := json.Marshal(cfg)
		if err != nil {
			t.Fatal(err)
		}
		var reloaded Config
		if err = json.Unmarshal(encoded, &reloaded); err != nil {
			t.Fatal(err)
		}
		if reloaded.RemoteDesktop.RememberApproval() != tt.enabled {
			t.Fatal("reload changed policy", tt.data)
		}
	}
}
