package ai

import (
	"context"
	"errors"
	"testing"

	"github.com/floegence/redeven/internal/config"
)

func testAIConfigForUpdate(t *testing.T, currentModelID string, models ...string) *config.AIConfig {
	t.Helper()
	if len(models) == 0 {
		models = []string{"gpt-5-mini"}
	}
	providerModels := make([]config.AIProviderModel, 0, len(models))
	for _, name := range models {
		providerModels = append(providerModels, config.AIProviderModel{ModelName: name})
	}
	cfg := &config.AIConfig{
		CurrentModelID: currentModelID,
		Providers: []config.AIProvider{{
			ID:      "openai",
			Type:    "openai",
			BaseURL: "https://api.openai.com/v1",
			Models:  providerModels,
		}},
	}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("Validate: %v", err)
	}
	return cfg
}

func TestServiceUpdateConfigAllowsActiveRuns(t *testing.T) {
	t.Parallel()

	oldCfg := testAIConfigForUpdate(t, "openai/gpt-5-mini", "gpt-5-mini")
	newCfg := testAIConfigForUpdate(t, "openai/gpt-5", "gpt-5-mini", "gpt-5")

	svc := &Service{
		cfg: oldCfg,
		activeRunByTh: map[string]string{
			"env_a:thread_1": "run_1",
			"env_a:thread_2": "run_2",
			"env_b:thread_9": "run_9",
		},
	}

	persistCalls := 0
	err := svc.UpdateConfig(newCfg, func() error {
		persistCalls++
		return nil
	})
	if err != nil {
		t.Fatalf("UpdateConfig: %v", err)
	}
	if persistCalls != 1 {
		t.Fatalf("persist calls=%d, want=1", persistCalls)
	}
	if svc.cfg != newCfg {
		t.Fatalf("service cfg pointer not updated")
	}
	if oldCfg.CurrentModelID != "openai/gpt-5-mini" {
		t.Fatalf("old cfg snapshot mutated: %q", oldCfg.CurrentModelID)
	}

	if got := svc.ActiveRunCount("env_a"); got != 2 {
		t.Fatalf("ActiveRunCount(env_a)=%d, want=2", got)
	}
	if got := svc.ActiveRunCount("env_b"); got != 1 {
		t.Fatalf("ActiveRunCount(env_b)=%d, want=1", got)
	}
	if got := svc.ActiveRunCount(""); got != 3 {
		t.Fatalf("ActiveRunCount(all)=%d, want=3", got)
	}
}

func TestServiceUpdateConfigPersistError(t *testing.T) {
	t.Parallel()

	oldCfg := testAIConfigForUpdate(t, "openai/gpt-5-mini", "gpt-5-mini")
	newCfg := testAIConfigForUpdate(t, "openai/gpt-5", "gpt-5-mini", "gpt-5")

	svc := &Service{cfg: oldCfg, activeRunByTh: map[string]string{"env:th": "run_1"}}
	persistErr := errors.New("persist failed")
	err := svc.UpdateConfig(newCfg, func() error { return persistErr })
	if !errors.Is(err, persistErr) {
		t.Fatalf("UpdateConfig err=%v, want=%v", err, persistErr)
	}
	if svc.cfg != oldCfg {
		t.Fatalf("cfg pointer changed on persist error")
	}
}

func TestServiceUpdateConfigValidationError(t *testing.T) {
	t.Parallel()

	svc := &Service{cfg: testAIConfigForUpdate(t, "openai/gpt-5-mini", "gpt-5-mini")}
	persistCalls := 0
	err := svc.UpdateConfig(&config.AIConfig{CurrentModelID: "openai/gpt-5-mini"}, func() error {
		persistCalls++
		return nil
	})
	if err == nil {
		t.Fatalf("UpdateConfig should fail for invalid config")
	}
	if persistCalls != 0 {
		t.Fatalf("persist should not be called on validation error")
	}
}

func TestServiceEnabledPermissionOnlyIsFalse(t *testing.T) {
	t.Parallel()

	svc := &Service{cfg: &config.AIConfig{PermissionType: config.AIPermissionReadonly}}
	if svc.Enabled() {
		t.Fatalf("Enabled=true for permission-only config")
	}
	if status := svc.RuntimeStatus(context.Background()); status.RemoteConfigured {
		t.Fatalf("RemoteConfigured=true for permission-only config")
	}
}

func TestServiceSetDefaultPermissionTypePreservesModelProfileAndRecovery(t *testing.T) {
	t.Parallel()

	recoveryEnabled := false
	oldCfg := testAIConfigForUpdate(t, "openai/gpt-5-mini", "gpt-5-mini")
	oldCfg.ToolRecoveryEnabled = &recoveryEnabled
	svc := &Service{cfg: oldCfg}
	var persisted *config.AIConfig
	if err := svc.SetDefaultPermissionType(config.AIPermissionFullAccess, func(next *config.AIConfig) error {
		persisted = next
		return nil
	}); err != nil {
		t.Fatalf("SetDefaultPermissionType: %v", err)
	}
	if persisted == nil || persisted.PermissionType != config.AIPermissionFullAccess {
		t.Fatalf("persisted permission=%#v", persisted)
	}
	if persisted.CurrentModelID != oldCfg.CurrentModelID || len(persisted.Providers) != len(oldCfg.Providers) {
		t.Fatalf("model profile changed: %#v", persisted)
	}
	if persisted.ToolRecoveryEnabled == nil || *persisted.ToolRecoveryEnabled {
		t.Fatalf("recovery setting changed: %#v", persisted.ToolRecoveryEnabled)
	}
}

func TestServiceSetModelProfilePreservesDefaultPermissionAndRecovery(t *testing.T) {
	t.Parallel()

	recoveryEnabled := false
	oldCfg := testAIConfigForUpdate(t, "openai/gpt-5-mini", "gpt-5-mini")
	oldCfg.PermissionType = config.AIPermissionReadonly
	oldCfg.ToolRecoveryEnabled = &recoveryEnabled
	svc := &Service{cfg: oldCfg}
	profile := testAIConfigForUpdate(t, "openai/gpt-5", "gpt-5").ModelProfile()
	var persisted *config.AIConfig
	if err := svc.SetModelProfile(&profile, func(next *config.AIConfig) error {
		persisted = next
		return nil
	}); err != nil {
		t.Fatalf("SetModelProfile: %v", err)
	}
	if persisted == nil || persisted.CurrentModelID != "openai/gpt-5" {
		t.Fatalf("persisted model profile=%#v", persisted)
	}
	if persisted.PermissionType != config.AIPermissionReadonly {
		t.Fatalf("permission changed: %q", persisted.PermissionType)
	}
	if persisted.ToolRecoveryEnabled == nil || *persisted.ToolRecoveryEnabled {
		t.Fatalf("recovery setting changed: %#v", persisted.ToolRecoveryEnabled)
	}
}
