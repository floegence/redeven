package session

import "testing"

func TestAllowsProcessLaunchRequiresWriteAndExecute(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		meta *Meta
		want bool
	}{
		{name: "missing metadata", meta: nil, want: false},
		{name: "execute only", meta: &Meta{CanExecute: true}, want: false},
		{name: "write only", meta: &Meta{CanWrite: true}, want: false},
		{name: "write and execute", meta: &Meta{CanWrite: true, CanExecute: true}, want: true},
		{name: "full access", meta: &Meta{CanRead: true, CanWrite: true, CanExecute: true}, want: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := AllowsProcessLaunch(tt.meta); got != tt.want {
				t.Fatalf("AllowsProcessLaunch() = %v, want %v", got, tt.want)
			}
		})
	}
}
