package ai

import "testing"

func TestResolveTaskLoopConfigProfile_Default(t *testing.T) {
	t.Parallel()

	profile, cfg := resolveTaskLoopConfigProfile("")
	if profile != defaultTaskLoopProfileID {
		t.Fatalf("profile=%q, want %q", profile, defaultTaskLoopProfileID)
	}
	if cfg.MaxTurns <= 0 || cfg.MaxNoProgressTurns <= 0 || cfg.MaxRepeatedSignatures <= 0 {
		t.Fatalf("invalid cfg: %+v", cfg)
	}
}

func TestResolveTaskLoopConfigProfile_UnknownFallback(t *testing.T) {
	t.Parallel()

	profile, cfg := resolveTaskLoopConfigProfile("unknown_profile")
	if profile != defaultTaskLoopProfileID {
		t.Fatalf("profile=%q, want fallback %q", profile, defaultTaskLoopProfileID)
	}
	if cfg != defaultTaskLoopConfig() {
		t.Fatalf("cfg=%+v, want %+v", cfg, defaultTaskLoopConfig())
	}
}

func TestResolveTaskLoopConfigProfile_FastExit(t *testing.T) {
	t.Parallel()

	profile, cfg := resolveTaskLoopConfigProfile("FAST_EXIT_V1")
	if profile != "fast_exit_v1" {
		t.Fatalf("profile=%q, want fast_exit_v1", profile)
	}
	if cfg.MaxTurns != 14 || cfg.MaxNoProgressTurns != 2 || cfg.MaxRepeatedSignatures != 2 {
		t.Fatalf("cfg=%+v, want fast exit profile", cfg)
	}
}
