package ai

import (
	"fmt"
	"strings"
	"time"
)

type promptLocalTimeContext struct {
	CurrentDate string
	Timezone    string
}

func currentPromptLocalTimeContext(now func() time.Time) promptLocalTimeContext {
	if now == nil {
		now = time.Now
	}
	current := now()
	return promptLocalTimeContext{
		CurrentDate: current.Format("2006-01-02"),
		Timezone:    promptTimezoneLabel(current),
	}
}

func promptTimezoneLabel(current time.Time) string {
	locationName := strings.TrimSpace(current.Location().String())
	if locationName != "" && !strings.EqualFold(locationName, "Local") {
		return locationName
	}
	_, offsetSeconds := current.Zone()
	if offsetSeconds == 0 {
		return "Etc/UTC"
	}
	sign := "+"
	if offsetSeconds < 0 {
		sign = "-"
		offsetSeconds = -offsetSeconds
	}
	hours := offsetSeconds / 3600
	minutes := (offsetSeconds % 3600) / 60
	return fmt.Sprintf("UTC%s%02d:%02d", sign, hours, minutes)
}

func renderPromptLocalTimeContextLines(ctx promptLocalTimeContext) []string {
	lines := []string{}
	if currentDate := strings.TrimSpace(ctx.CurrentDate); currentDate != "" {
		lines = append(lines, fmt.Sprintf("- Current date: %s", currentDate))
	}
	if timezone := strings.TrimSpace(ctx.Timezone); timezone != "" {
		lines = append(lines, fmt.Sprintf("- Timezone: %s", timezone))
	}
	return lines
}

func promptWorkingDirForRun(r *run) string {
	if r == nil {
		return ""
	}
	cwd := strings.TrimSpace(r.workingDir)
	if cwd == "" {
		cwd = strings.TrimSpace(r.agentHomeDir)
	}
	return cwd
}

func buildBasicPromptCurrentContextLines(workingDir string, localTime promptLocalTimeContext) []string {
	lines := []string{"## Current Context"}
	if workingDir = strings.TrimSpace(workingDir); workingDir != "" {
		lines = append(lines, fmt.Sprintf("- Working directory: %s", workingDir))
	}
	lines = append(lines, renderPromptLocalTimeContextLines(localTime)...)
	return lines
}
