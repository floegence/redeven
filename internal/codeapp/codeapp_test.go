package codeapp

import "testing"

func TestNormalizePortRange(t *testing.T) {
	t.Parallel()

	const defMin = 20000
	const defMax = 21000

	tests := []struct {
		name   string
		inMin  int
		inMax  int
		outMin int
		outMax int
	}{
		{"default_when_missing", 0, 0, defMin, defMax},
		{"default_when_invalid_order", 30000, 20000, defMin, defMax},
		{"default_when_too_high", 20000, 70000, defMin, defMax},
		{"clamp_min_to_1024", 1, 2000, 1024, 2000},
		{"default_when_clamp_makes_invalid", 1, 1000, defMin, defMax},
		{"ok_custom_range", 25000, 25010, 25000, 25010},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			min, max := normalizePortRange(tt.inMin, tt.inMax)
			if min != tt.outMin || max != tt.outMax {
				t.Fatalf("normalizePortRange(%d,%d) = (%d,%d), want (%d,%d)", tt.inMin, tt.inMax, min, max, tt.outMin, tt.outMax)
			}
		})
	}
}
