package runtimemanagement

import (
	"errors"
	"testing"

	"github.com/acobaugh/osrelease"
)

func TestRuntimeLinuxDistributionUsesExactRuntimeID(t *testing.T) {
	for _, tc := range []struct{ name, release, want string }{
		{"ubuntu", "ID=ubuntu\nID_LIKE=debian\n", "ubuntu"},
		{"quoted fedora", "ID=\"fedora\"\n", "fedora"},
		{"quoted arch", "ID='arch'\n", "arch"},
		{"derivative", "ID=customlinux\nID_LIKE=ubuntu\n", "customlinux"},
		{"missing ID", "NAME=Ubuntu\nID_LIKE=ubuntu\n", ""},
		{"shell literal", "ID=$(echo ubuntu)\n", ""},
		{"invalid ID", "ID=Ubuntu Linux\n", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := runtimeLinuxDistribution("linux", func() (map[string]string, error) { return osrelease.ReadString(tc.release) })
			if got != tc.want {
				t.Fatalf("distribution = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestRuntimeLinuxDistributionUnavailable(t *testing.T) {
	if got := runtimeLinuxDistribution("linux", func() (map[string]string, error) { return nil, errors.New("missing os-release") }); got != "" {
		t.Fatalf("failed observation = %q", got)
	}
	for _, goos := range []string{"darwin", "windows", "freebsd"} {
		if got := runtimeLinuxDistribution(goos, func() (map[string]string, error) {
			t.Fatal("must not read Linux release on another OS")
			return nil, nil
		}); got != "" {
			t.Fatalf("%s distribution = %q", goos, got)
		}
	}
}
