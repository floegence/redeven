package ai

import "testing"

func TestParseRunIDFromSidecarLog(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		line string
		want string
	}{
		{
			name: "missing run id",
			line: "[ai-sidecar] event=ai.sidecar.run.start model=openai/gpt-5-mini",
			want: "",
		},
		{
			name: "plain value",
			line: "[ai-sidecar] event=ai.sidecar.run.start run_id=run_123 model=openai/gpt-5-mini",
			want: "run_123",
		},
		{
			name: "comma terminated",
			line: "[ai-sidecar] event=ai.sidecar.run.end run_id=run_123, delta_count=2",
			want: "run_123",
		},
		{
			name: "right bracket terminated",
			line: "[ai-sidecar] event=ai.sidecar.tool.result.recv [run_id=run_abc]",
			want: "run_abc",
		},
		{
			name: "empty value",
			line: "[ai-sidecar] event=ai.sidecar.run.end run_id=",
			want: "",
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := parseRunIDFromSidecarLog(tt.line)
			if got != tt.want {
				t.Fatalf("parseRunIDFromSidecarLog(%q)=%q, want %q", tt.line, got, tt.want)
			}
		})
	}
}
