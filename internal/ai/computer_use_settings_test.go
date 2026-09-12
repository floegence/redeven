package ai

import (
	"testing"

	"github.com/floegence/redeven/internal/config"
)

func TestRegisterBuiltInToolsRespectsComputerUseSetting(t *testing.T) {
	t.Parallel()

	for _, test := range []struct {
		name    string
		config  *config.AIConfig
		present bool
	}{
		{name: "default enabled", config: &config.AIConfig{}, present: true},
		{name: "explicitly enabled", config: func() *config.AIConfig { value := true; return &config.AIConfig{ComputerUseEnabled: &value} }(), present: true},
		{name: "explicitly disabled", config: func() *config.AIConfig { value := false; return &config.AIConfig{ComputerUseEnabled: &value} }(), present: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			registry := NewInMemoryToolRegistry()
			r := &run{cfg: test.config}
			if err := registerBuiltInTools(registry, r); err != nil {
				t.Fatal(err)
			}
			for _, name := range []string{"computer.screenshot", "browser.navigate"} {
				found := false
				for _, def := range registry.Snapshot() {
					found = found || def.Name == name
				}
				if found != test.present {
					t.Fatalf("tool %q presence=%t, want %t", name, found, test.present)
				}
			}
		})
	}
}
