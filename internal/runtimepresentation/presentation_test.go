package runtimepresentation

import (
	"bytes"
	"errors"
	"strings"
	"testing"
)

func TestParseMode(t *testing.T) {
	for _, value := range []string{"", "auto", "rich", "plain", "machine"} {
		if _, err := ParseMode(value); err != nil {
			t.Fatalf("ParseMode(%q) error = %v", value, err)
		}
	}
	if _, err := ParseMode("bad"); err == nil {
		t.Fatalf("ParseMode(bad) expected error")
	}
}

func TestResolveConfig(t *testing.T) {
	tests := []struct {
		name string
		req  Mode
		in   ResolveInput
		want Mode
	}{
		{
			name: "desktop managed auto uses machine",
			req:  ModeAuto,
			in: ResolveInput{
				DesktopManaged: true,
			},
			want: ModeMachine,
		},
		{
			name: "startup report auto uses machine",
			req:  ModeAuto,
			in: ResolveInput{
				StartupReportFile: "/tmp/report.json",
			},
			want: ModeMachine,
		},
		{
			name: "non terminal auto uses plain",
			req:  ModeAuto,
			in: ResolveInput{
				Stderr: &bytes.Buffer{},
				Env:    map[string]string{},
			},
			want: ModePlain,
		},
		{
			name: "explicit rich stays rich",
			req:  ModeRich,
			in: ResolveInput{
				Stderr: &bytes.Buffer{},
				Env:    map[string]string{"NO_COLOR": "1"},
			},
			want: ModeRich,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ResolveConfig(tt.req, tt.in)
			if got.Effective != tt.want {
				t.Fatalf("Effective = %q, want %q", got.Effective, tt.want)
			}
		})
	}
}

func TestReporterRecordsEventsAndClosesOnce(t *testing.T) {
	rec := &Recorder{}
	reporter := NewReporter(Snapshot{Version: "dev"}, rec)
	if err := reporter.Start(); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	if err := reporter.Emit(Event{Kind: EventPhaseDone, Phase: PhaseResolveState, Title: "state ready"}); err != nil {
		t.Fatalf("Emit() error = %v", err)
	}
	if err := reporter.Close(Result{Success: false, Error: errors.New("boom")}); err != nil {
		t.Fatalf("Close() error = %v", err)
	}
	if err := reporter.Close(Result{Success: false, Error: errors.New("again")}); err != nil {
		t.Fatalf("second Close() error = %v", err)
	}
	if len(rec.Started) != 1 || len(rec.Events) != 1 || len(rec.Results) != 1 {
		t.Fatalf("recorder counts = started %d events %d results %d", len(rec.Started), len(rec.Events), len(rec.Results))
	}
}

func TestRichRendererShowsBrandReadyWarningAndError(t *testing.T) {
	snapshot := Snapshot{
		Version:                "v1.2.3",
		EffectiveRunMode:       "hybrid",
		ControlplaneProviderID: "example_provider",
		ControlChannelEnabled:  true,
		LocalUIEnabled:         true,
		ControlplaneBaseURL:    "https://dev.redeven.test",
		EnvPublicID:            "env_123",
		StateDir:               "/tmp/redeven/local-environment",
		LocalUIURLs:            []string{"http://127.0.0.1:23998"},
		EnvironmentURL:         "https://dev.redeven.test/env/env_123",
	}
	var out bytes.Buffer
	renderer := NewRenderer(&out, Config{Effective: ModeRich})
	if err := renderer.Start(snapshot); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	if err := renderer.Emit(Event{
		Kind:        EventWarning,
		Phase:       PhaseConnectControl,
		Title:       "Control plane is temporarily unreachable.",
		Detail:      "Redeven will keep retrying; Local UI remains available.",
		Remediation: "Next retry in 8s.",
		Snapshot:    snapshot,
	}); err != nil {
		t.Fatalf("Emit(warn) error = %v", err)
	}
	if err := renderer.Emit(Event{Kind: EventReady, Snapshot: snapshot}); err != nil {
		t.Fatalf("Emit(ready) error = %v", err)
	}
	if err := renderer.Emit(Event{
		Kind:        EventFailure,
		Title:       "Could not start the Local UI",
		ErrorDetail: "Port 23998 is already in use by another process.",
		ErrorCode:   "LOCAL_UI_BIND_UNAVAILABLE",
		Remediation: "redeven run --mode hybrid --local-ui-bind 127.0.0.1:24000",
		Snapshot:    snapshot,
	}); err != nil {
		t.Fatalf("Emit(error) error = %v", err)
	}
	text := out.String()
	for _, want := range []string{
		"╭",
		"▝▌  ▐▘  Redeven Runtime",
		"RUNTIME",
		"ACTIVITY",
		"ACCESS",
		"LATEST LOGS",
		"DEGRADED",
		"READY",
		"Could not start the Local UI",
		"ADVISORY",
		"FIX",
		"LOCAL_UI_BIND_UNAVAILABLE",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("expected rich output to contain %q\n%s", want, text)
		}
	}
}

func TestCompactBrandMarkAnimationSwapsInteriorBars(t *testing.T) {
	first := CompactBrandMarkFrame(0)
	second := CompactBrandMarkFrame(1)
	if len(first.Lines) != 5 || len(second.Lines) != 5 {
		t.Fatalf("brand mark heights = %d and %d, want 5", len(first.Lines), len(second.Lines))
	}
	if first.Lines[2] != "▌▝▀  ▐" || first.Lines[3] != "▌▝▀▀▘▐" {
		t.Fatalf("frame 0 interior bars = %q / %q", first.Lines[2], first.Lines[3])
	}
	if second.Lines[2] != "▌▝▀▀▘▐" || second.Lines[3] != "▌▝▀  ▐" {
		t.Fatalf("frame 1 interior bars = %q / %q", second.Lines[2], second.Lines[3])
	}
}

func TestDynamicRichRendererAdvancesBrandFrames(t *testing.T) {
	snapshot := Snapshot{
		Version:                "v1.2.3",
		EffectiveRunMode:       "hybrid",
		ControlplaneProviderID: "example_provider",
		StateDir:               "/tmp/redeven/local-environment",
	}
	var out bytes.Buffer
	renderer := NewRenderer(&out, Config{Effective: ModeRich, Dynamic: true})
	if err := renderer.Start(snapshot); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	if err := renderer.Emit(Event{Kind: EventPhaseStarted, Phase: PhaseAcquireLock, Title: "Acquiring runtime lock", Snapshot: snapshot}); err != nil {
		t.Fatalf("Emit() error = %v", err)
	}
	text := out.String()
	assertContains(t, text, "│ ▌▝▀  ▐  Uptime")
	assertContains(t, text, "│ ▌▝▀▀▘▐  Surface")
	assertContains(t, text, "│ ▌▝▀▀▘▐  Uptime")
	assertContains(t, text, "│ ▌▝▀  ▐  Surface")
}

func TestRichRendererFitsNarrowTerminal(t *testing.T) {
	snapshot := Snapshot{
		Version:                "v1.2.3",
		EffectiveRunMode:       "hybrid",
		ControlplaneProviderID: "example_provider_with_a_long_name",
		ControlChannelEnabled:  true,
		LocalUIEnabled:         true,
		ControlplaneBaseURL:    "https://very-long-control-plane.example.redeven.test",
		EnvPublicID:            "env_1234567890",
		StateDir:               "/tmp/redeven/local-environment/with/a/very/long/path",
		LocalUIURLs:            []string{"http://127.0.0.1:23998/some/long/path"},
		EnvironmentURL:         "https://very-long-control-plane.example.redeven.test/env/env_1234567890",
	}
	var out bytes.Buffer
	renderer := NewRendererWithOptions(&out, Config{Effective: ModeRich}, RendererOptions{
		TerminalWidth:  42,
		TerminalHeight: 20,
	})
	if err := renderer.Start(snapshot); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	text := out.String()
	assertRichLinesFit(t, text, 41)
	if lines := richVisibleLineCount(text); lines > 20 {
		t.Fatalf("rich output line count = %d, want <= 20\n%s", lines, text)
	}
	assertContains(t, text, "Redeven Runtime")
	assertContains(t, text, "LATEST LOGS")
}

func TestRichRendererFitsWideTwoColumnTerminal(t *testing.T) {
	snapshot := Snapshot{
		Version:                "v1.2.3",
		EffectiveRunMode:       "hybrid",
		ControlplaneProviderID: "example_provider_with_a_long_name",
		ControlChannelEnabled:  true,
		LocalUIEnabled:         true,
		ControlplaneBaseURL:    "https://very-long-control-plane.example.redeven.test",
		EnvPublicID:            "env_1234567890",
		StateDir:               "/tmp/redeven/local-environment/with/a/very/long/path",
		LocalUIURLs:            []string{"http://127.0.0.1:23998/some/long/path"},
		EnvironmentURL:         "https://very-long-control-plane.example.redeven.test/env/env_1234567890",
	}
	var out bytes.Buffer
	renderer := NewRendererWithOptions(&out, Config{Effective: ModeRich}, RendererOptions{
		TerminalWidth:  160,
		TerminalHeight: 40,
	})
	if err := renderer.Start(snapshot); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	assertRichLinesFit(t, out.String(), 132)
}

func TestPlainAndMachineRenderer(t *testing.T) {
	var plain bytes.Buffer
	plainRenderer := NewRenderer(&plain, Config{Effective: ModePlain})
	if err := plainRenderer.Emit(Event{
		Kind:        EventFailure,
		Title:       "could not start local ui",
		ErrorCode:   "LOCAL_UI_BIND_UNAVAILABLE",
		Remediation: "redeven run --mode hybrid --local-ui-bind 127.0.0.1:24000",
	}); err != nil {
		t.Fatalf("plain Emit() error = %v", err)
	}
	assertContains(t, plain.String(), "[error] LOCAL_UI_BIND_UNAVAILABLE: could not start local ui")
	assertContains(t, plain.String(), "fix: redeven run --mode hybrid")

	var machine bytes.Buffer
	machineRenderer := NewRenderer(&machine, Config{Effective: ModeMachine})
	if err := machineRenderer.Emit(Event{Kind: EventInfo, Title: "ignored"}); err != nil {
		t.Fatalf("machine info Emit() error = %v", err)
	}
	if machine.String() != "" {
		t.Fatalf("machine info output = %q, want empty", machine.String())
	}
	if err := machineRenderer.Emit(Event{Kind: EventFailure, Title: "startup failed"}); err != nil {
		t.Fatalf("machine failure Emit() error = %v", err)
	}
	if strings.TrimSpace(machine.String()) != "startup failed" {
		t.Fatalf("machine failure output = %q, want title without decoration", machine.String())
	}
}

func assertRichLinesFit(t *testing.T, text string, width int) {
	t.Helper()
	for _, line := range strings.Split(text, "\n") {
		if got := richVisibleLen(line); got > width {
			t.Fatalf("line width = %d, want <= %d\nline: %q\nfull:\n%s", got, width, richStripANSI(line), text)
		}
	}
}

func assertContains(t *testing.T, text string, want string) {
	t.Helper()
	if !strings.Contains(text, want) {
		t.Fatalf("expected %q to contain %q", text, want)
	}
}
