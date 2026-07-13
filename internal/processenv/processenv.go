package processenv

import (
	"os"
	"strings"
)

var blockedNames = map[string]struct{}{
	"REDEVEN_LOCAL_UI_PASSWORD":        {},
	"REDEVEN_BOOTSTRAP_TICKET":         {},
	"REDEVEN_DESKTOP_BOOTSTRAP_TICKET": {},
}

func Current() []string {
	return Filter(os.Environ())
}

func Filter(environment []string) []string {
	filtered := make([]string, 0, len(environment))
	for _, item := range environment {
		name, _, ok := strings.Cut(item, "=")
		if !ok || blocked(name) {
			continue
		}
		filtered = append(filtered, item)
	}
	return filtered
}

func blocked(name string) bool {
	for blockedName := range blockedNames {
		if strings.EqualFold(strings.TrimSpace(name), blockedName) {
			return true
		}
	}
	return false
}
