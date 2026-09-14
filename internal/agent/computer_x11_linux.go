package agent

import "github.com/floegence/redeven/internal/ai"

func registerVirtualDesktop(stateDir string, registry *ai.TargetRegistry, executors map[string]ai.TargetToolExecutor) {
	_ = registry.Register(ai.TargetDescriptor{ID: "xvfb-main", Kind: "xvfb.desktop", DisplayName: "Linux Virtual Desktop", Locality: "local", Capabilities: []string{"observe", "interaction"}, State: "stopped", PermissionState: "not_checked"})
	executors["xvfb-main"] = ai.NewXvfbTargetExecutor(stateDir)
}
