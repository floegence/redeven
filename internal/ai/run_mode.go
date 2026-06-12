package ai

import (
	"strings"

	"github.com/floegence/redeven/internal/config"
)

func normalizeRunMode(raw string, fallback string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case config.AIModePlan:
		return config.AIModePlan
	case config.AIModeAct:
		return config.AIModeAct
	}
	switch strings.ToLower(strings.TrimSpace(fallback)) {
	case config.AIModePlan:
		return config.AIModePlan
	default:
		return config.AIModeAct
	}
}
