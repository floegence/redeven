package runtimemanagement

import (
	"runtime"
	"strings"
	"sync"

	"github.com/acobaugh/osrelease"
)

// RuntimePlatform reports the OS of this Runtime process, independently of its client.
func RuntimePlatform() string {
	switch runtime.GOOS {
	case "darwin":
		return "macos"
	case "linux", "windows":
		return runtime.GOOS
	default:
		return ""
	}
}

// RuntimeLinuxDistribution reports this process's os-release ID, never ID_LIKE.
// A container therefore reports its own userspace rather than the host distro.
var RuntimeLinuxDistribution = sync.OnceValue(func() string {
	return runtimeLinuxDistribution(runtime.GOOS, osrelease.Read)
})

func runtimeLinuxDistribution(goos string, read func() (map[string]string, error)) string {
	if goos != "linux" {
		return ""
	}
	release, err := read()
	if err != nil {
		return ""
	}
	id := strings.TrimSpace(release["ID"])
	// osrelease v0.1.0 retains single quotes around values.
	if len(id) >= 2 && id[0] == '\'' && id[len(id)-1] == '\'' {
		id = id[1 : len(id)-1]
	}
	id = strings.ToLower(id)
	if len(id) == 0 || len(id) > 64 {
		return ""
	}
	for _, c := range id {
		if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '.' || c == '_' || c == '-') {
			return ""
		}
	}
	return id
}
