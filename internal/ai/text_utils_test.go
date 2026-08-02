package ai

import "testing"

func TestReadIntFieldClampsValuesOutsideNativeIntRange(t *testing.T) {
	tests := []struct {
		name  string
		value int64
		want  int
	}{
		{name: "positive", value: 42, want: 42},
		{name: "negative", value: -42, want: -42},
		{name: "max", value: int64(^uint(0) >> 1), want: int(^uint(0) >> 1)},
		{name: "min", value: -int64(^uint(0)>>1) - 1, want: -int(^uint(0)>>1) - 1},
	}
	if int64(^uint(0)>>1) < int64(^uint64(0)>>1) {
		tests = append(tests,
			struct {
				name  string
				value int64
				want  int
			}{name: "positive overflow", value: int64(^uint64(0) >> 1), want: int(^uint(0) >> 1)},
			struct {
				name  string
				value int64
				want  int
			}{name: "negative overflow", value: -int64(^uint64(0)>>1) - 1, want: -int(^uint(0)>>1) - 1},
		)
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := readIntField(map[string]any{"value": tc.value}, "value"); got != tc.want {
				t.Fatalf("readIntField() = %d, want %d", got, tc.want)
			}
		})
	}
}
