package ai

import "testing"

func TestActiveThreadEffectiveRunState(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		status     string
		runErr     string
		wantStatus string
		wantErr    string
	}{
		{name: "keep running", status: "running", wantStatus: "running"},
		{name: "keep finalizing", status: "finalizing", wantStatus: "finalizing"},
		{name: "downgrade failed to running", status: "failed", runErr: "boom", wantStatus: "running"},
		{name: "downgrade idle to running", status: "idle", wantStatus: "running"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			gotStatus, _, gotErr := activeThreadEffectiveRunState(tc.status, "", tc.runErr)
			if gotStatus != tc.wantStatus || gotErr != tc.wantErr {
				t.Fatalf("activeThreadEffectiveRunState(%q, %q) = (%q, %q), want (%q, %q)", tc.status, tc.runErr, gotStatus, gotErr, tc.wantStatus, tc.wantErr)
			}
		})
	}
}

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
