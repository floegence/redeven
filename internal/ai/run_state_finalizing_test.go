package ai

import "testing"

func TestIsFinalizingLifecycleStreamEvent(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		ev   any
		want bool
	}{
		{name: "struct finalizing", ev: streamEventLifecyclePhase{Type: "lifecycle-phase", Phase: "finalizing"}, want: true},
		{name: "struct ended alias", ev: streamEventLifecyclePhase{Type: "lifecycle-phase", Phase: "ended"}, want: false},
		{name: "pointer finalizing", ev: &streamEventLifecyclePhase{Type: "lifecycle-phase", Phase: "finish"}, want: true},
		{name: "map finalizing", ev: map[string]any{"type": "lifecycle-phase", "phase": "finalizing"}, want: true},
		{name: "map non lifecycle", ev: map[string]any{"type": "block-start", "phase": "finalizing"}, want: false},
		{name: "invalid type", ev: "finalizing", want: false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := isFinalizingLifecycleStreamEvent(tc.ev)
			if got != tc.want {
				t.Fatalf("isFinalizingLifecycleStreamEvent(%T) = %v, want %v", tc.ev, got, tc.want)
			}
		})
	}
}
