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
		"██  Redeven Runtime",
		"Local foundation",
		"Access surfaces",
		"Warning",
		"Redeven Runtime is ready",
		"Could not start the Local UI",
		"Fix",
		"LOCAL_UI_BIND_UNAVAILABLE",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("expected rich output to contain %q\n%s", want, text)
		}
	}
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

func assertContains(t *testing.T, text string, want string) {
	t.Helper()
	if !strings.Contains(text, want) {
		t.Fatalf("expected %q to contain %q", text, want)
	}
}
