//go:build !linux

package agent

import "github.com/floegence/redeven/internal/ai"

func registerVirtualDesktop(_ string, _ *ai.TargetRegistry, _ map[string]ai.TargetToolExecutor) {}
