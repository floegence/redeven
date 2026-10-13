package runtimemanagement

import "runtime"

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
