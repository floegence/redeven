package agent

import (
	"reflect"
	"testing"
)

func TestSessionProxyAllowedOrigins(t *testing.T) {
	t.Parallel()

	const launcher = "https://cs-abcd1234.us-east-1.redeven.test-sandbox.example"
	const app = "https://app-9f1c2a77.us-east-1.redeven-online.test"

	tests := []struct {
		name     string
		external string
		app      string
		want     []string
	}{
		{
			name:     "direct deployment admits only its own origin",
			external: launcher,
			app:      "",
			want:     []string{launcher},
		},
		{
			name:     "identical app origin is not duplicated",
			external: launcher,
			app:      launcher,
			want:     []string{launcher},
		},
		{
			name:     "isolated runtime admits the minted app origin too",
			external: launcher,
			app:      app,
			want:     []string{launcher, app},
		},
		{
			name:     "surrounding whitespace is trimmed",
			external: "  " + launcher + "\n",
			app:      "\t" + app + " ",
			want:     []string{launcher, app},
		},
		{
			name:     "whitespace-only app origin never widens the allowlist",
			external: launcher,
			app:      "   ",
			want:     []string{launcher},
		},
		{
			name:     "missing external origin disables proxying entirely",
			external: "   ",
			app:      app,
			want:     nil,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			got := sessionProxyAllowedOrigins(tc.external, tc.app)
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("sessionProxyAllowedOrigins(%q, %q) = %#v, want %#v", tc.external, tc.app, got, tc.want)
			}
		})
	}
}
