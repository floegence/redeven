package ai

import (
	"reflect"
	"testing"
	"time"
)

func TestCurrentPromptLocalTimeContext_UsesLocationNameWhenAvailable(t *testing.T) {
	t.Parallel()

	now := func() time.Time {
		return time.Date(2026, time.April, 4, 10, 30, 0, 0, time.FixedZone("Asia/Shanghai", 8*60*60))
	}

	ctx := currentPromptLocalTimeContext(now)
	if ctx.CurrentDate != "2026-04-04" {
		t.Fatalf("CurrentDate=%q, want 2026-04-04", ctx.CurrentDate)
	}
	if ctx.Timezone != "Asia/Shanghai" {
		t.Fatalf("Timezone=%q, want Asia/Shanghai", ctx.Timezone)
	}
}

func TestCurrentPromptLocalTimeContext_FallsBackToUTCOffsetForLocalLabel(t *testing.T) {
	t.Parallel()

	now := func() time.Time {
		return time.Date(2026, time.April, 4, 10, 30, 0, 0, time.FixedZone("Local", 8*60*60))
	}

	ctx := currentPromptLocalTimeContext(now)
	if ctx.Timezone != "UTC+08:00" {
		t.Fatalf("Timezone=%q, want UTC+08:00", ctx.Timezone)
	}
}

func TestBuildBasicPromptCurrentContextLines_IncludesLocalDateFacts(t *testing.T) {
	t.Parallel()

	lines := buildBasicPromptCurrentContextLines("/tmp/work", promptLocalTimeContext{
		CurrentDate: "2026-04-04",
		Timezone:    "Asia/Shanghai",
	})

	want := []string{
		"## Current Context",
		"- Working directory: /tmp/work",
		"- Current date: 2026-04-04",
		"- Timezone: Asia/Shanghai",
	}
	if !reflect.DeepEqual(lines, want) {
		t.Fatalf("lines=%v, want %v", lines, want)
	}
}
