package runtimepresentation

import (
	"bytes"
	"context"
	"strings"
	"testing"
	"time"
)

func TestLogBufferParsesTextAndJSONLogs(t *testing.T) {
	buffer := NewLogBuffer(4)
	_, _ = buffer.Write([]byte("time=2026-05-20T12:00:01Z level=INFO msg=\"Local UI ready\"\n"))
	_, _ = buffer.Write([]byte("{\"time\":\"2026-05-20T12:00:02Z\",\"level\":\"WARN\",\"msg\":\"control retry\"}\n"))

	lines := buffer.Lines(10)
	if len(lines) != 2 {
		t.Fatalf("Lines() len = %d, want 2", len(lines))
	}
	if lines[0].Level != "INFO" || lines[0].Message != "Local UI ready" {
		t.Fatalf("text log = %#v", lines[0])
	}
	if lines[1].Level != "WARN" || lines[1].Message != "control retry" {
		t.Fatalf("json log = %#v", lines[1])
	}
	if lines[1].At.Format(time.RFC3339) != "2026-05-20T12:00:02Z" {
		t.Fatalf("json log time = %s", lines[1].At.Format(time.RFC3339))
	}
}

func TestLogBufferKeepsRingTail(t *testing.T) {
	buffer := NewLogBuffer(2)
	_, _ = buffer.Write([]byte("level=INFO msg=one\n"))
	_, _ = buffer.Write([]byte("level=INFO msg=two\n"))
	_, _ = buffer.Write([]byte("level=INFO msg=three\n"))

	lines := buffer.Lines(10)
	if got := []string{lines[0].Message, lines[1].Message}; strings.Join(got, ",") != "two,three" {
		t.Fatalf("ring tail = %v", got)
	}
}

func TestRichLogsUseRuntimeLogBufferOnly(t *testing.T) {
	buffer := NewLogBuffer(4)
	renderer := NewRendererWithOptions(nil, Config{Effective: ModeRich}, RendererOptions{
		Logs:          buffer,
		TerminalWidth: 80,
	})
	event := Event{Kind: EventInfo, Title: "Synthetic presentation event"}

	text := renderer.buildRichPanel(event)
	logSection := text
	if parts := strings.SplitN(text, "LATEST LOGS", 2); len(parts) == 2 {
		logSection = parts[1]
	}
	if strings.Contains(logSection, "Synthetic presentation event") {
		t.Fatalf("rich logs should not show presentation events when a runtime log buffer is present\n%s", text)
	}
	if !strings.Contains(text, "waiting for runtime log lines") {
		t.Fatalf("rich logs should show pending runtime log state\n%s", text)
	}

	_, _ = buffer.Write([]byte("level=INFO msg=\"real runtime log\"\n"))
	text = renderer.buildRichPanel(event)
	if !strings.Contains(text, "real runtime log") {
		t.Fatalf("rich logs did not show runtime log buffer content\n%s", text)
	}
}

func TestInteractiveKeysMoveFocusAndExpandLogs(t *testing.T) {
	renderer := NewRenderer(nil, Config{Effective: ModeRich})
	renderer.interactive = true
	renderer.focus = RichFocusControlPlane

	renderer.handleInteractiveBytes([]byte{27, '[', 'B', 27, '[', 'B', 13})
	if renderer.focus != RichFocusLogs {
		t.Fatalf("focus = %q, want logs", renderer.focus)
	}
	if renderer.expanded != RichPanelLogs {
		t.Fatalf("expanded = %q, want logs", renderer.expanded)
	}
	renderer.handleInteractiveBytes([]byte{27})
	if renderer.expanded != RichPanelNone {
		t.Fatalf("expanded = %q, want none", renderer.expanded)
	}
}

func TestInteractiveControlPlaneEnterRunsControllerAction(t *testing.T) {
	controller := &fakeRuntimeController{
		status: ControlPlaneStatus{Connectable: true, Label: "available", ActionLabel: "connect"},
		done:   make(chan struct{}, 1),
	}
	renderer := NewRenderer(nil, Config{Effective: ModeRich})
	renderer.interactive = true
	renderer.focus = RichFocusControlPlane
	renderer.controller = controller

	renderer.handleInteractiveBytes([]byte{13})
	select {
	case <-controller.done:
	case <-time.After(time.Second):
		t.Fatal("controller action did not run")
	}
	if controller.connects != 1 {
		t.Fatalf("connects = %d, want 1", controller.connects)
	}
}

func TestInteractiveControlPlaneSetupAcceptsInput(t *testing.T) {
	controller := &fakeRuntimeController{
		status: ControlPlaneStatus{Label: "disabled for local mode"},
		done:   make(chan struct{}, 1),
	}
	renderer := NewRenderer(nil, Config{Effective: ModeRich})
	renderer.interactive = true
	renderer.focus = RichFocusControlPlane
	renderer.controller = controller

	renderer.handleInteractiveBytes([]byte{13})
	deadline := time.After(time.Second)
	for renderer.expanded != RichPanelControlPlane {
		select {
		case <-deadline:
			t.Fatalf("expanded = %q, want control plane setup", renderer.expanded)
		default:
			time.Sleep(10 * time.Millisecond)
		}
	}
	renderer.handleInteractiveBytes([]byte("https://redeven.test"))
	renderer.handleInteractiveBytes([]byte{13})
	renderer.handleInteractiveBytes([]byte("https://dev.redeven.test"))
	renderer.handleInteractiveBytes([]byte{13})
	renderer.handleInteractiveBytes([]byte("env_123"))
	renderer.handleInteractiveBytes([]byte{13})
	renderer.handleInteractiveBytes([]byte("ticket_123"))
	renderer.handleInteractiveBytes([]byte{13})

	select {
	case <-controller.done:
	case <-time.After(time.Second):
		t.Fatal("controller setup did not run")
	}
}

func TestRichRuntimeOverviewAndSessionsPanel(t *testing.T) {
	controller := &fakeRuntimeController{
		status: ControlPlaneStatus{Connected: true, Label: "connected to https://dev.redeven.test", ActionLabel: "disconnect"},
		overview: RuntimeOverview{
			Version:          "v9.8.7",
			Commit:           "abcdef123456",
			ProtocolVersion:  "redeven-runtime-v1",
			Compatibility:    "compatible",
			ServiceOwner:     "external",
			EffectiveRunMode: "hybrid",
			Workload: RuntimeWorkload{
				ActiveSessions:      2,
				TerminalSessions:    1,
				ActiveTasks:         3,
				PortForwardSessions: 1,
			},
			ProviderLink: RuntimeProviderLink{
				State:          "linked",
				ProviderID:     "provider_demo",
				ProviderOrigin: "https://redeven.test",
			},
		},
		sessions: []RuntimeSession{
			{
				ChannelID:         "ch_code",
				UserEmail:         "alice@example.test",
				AppLabel:          "Code",
				CodeSpaceID:       "cs_demo",
				ConnectedAtUnixMs: time.Now().Add(-2 * time.Minute).UnixMilli(),
				CanRead:           true,
				CanWrite:          true,
				CanExecute:        true,
			},
			{
				ChannelID:         "ch_pf",
				UserEmail:         "bob@example.test",
				AppLabel:          "Port Forward",
				CodeSpaceID:       "pf_demo",
				ConnectedAtUnixMs: time.Now().Add(-3 * time.Minute).UnixMilli(),
				CanExecute:        true,
			},
		},
	}
	renderer := NewRendererWithOptions(nil, Config{Effective: ModeRich}, RendererOptions{
		Controller:    controller,
		TerminalWidth: 120,
	})
	text := renderer.buildRichPanel(Event{Kind: EventReady, Snapshot: Snapshot{LocalUIURLs: []string{"http://127.0.0.1:23998"}}})
	for _, want := range []string{"v9.8.7 (abcdef12)", "redeven-runtime-v1", "Sessions", "connected clients", "3", "linked"} {
		assertContains(t, text, want)
	}

	renderer.expanded = RichPanelSessions
	renderer.sessionFilter = "alice"
	sessions := renderer.renderRichSessionsPanel(Event{})
	assertContains(t, sessions, "SESSIONS")
	assertContains(t, sessions, "alice@example.test")
	if strings.Contains(sessions, "bob@example.test") {
		t.Fatalf("session filter leaked non-matching row:\n%s", sessions)
	}
}

func TestInteractiveFrameUsesIncrementalUpdates(t *testing.T) {
	var out bytes.Buffer
	renderer := NewRendererWithOptions(&out, Config{Effective: ModeRich}, RendererOptions{
		TerminalWidth:  80,
		TerminalHeight: 24,
	})
	renderer.interactive = true
	renderer.latest = Event{Kind: EventReady, Snapshot: Snapshot{LocalUIEnabled: true}}

	renderer.renderInteractiveFrame(false)
	first := out.String()
	if !strings.Contains(first, clearToEndScreen) {
		t.Fatalf("first frame should clear the interactive screen once: %q", first)
	}
	out.Reset()
	renderer.renderInteractiveFrame(true)
	second := out.String()
	if strings.Contains(second, clearScreen) || strings.Contains(second, clearToEndScreen) {
		t.Fatalf("incremental frame should not clear the full screen: %q", second)
	}
	if !strings.Contains(second, "\033[") {
		t.Fatalf("incremental frame should use cursor addressing: %q", second)
	}
}

type fakeRuntimeController struct {
	status      ControlPlaneStatus
	overview    RuntimeOverview
	sessions    []RuntimeSession
	connects    int
	disconnects int
	done        chan struct{}
}

func (c *fakeRuntimeController) ConnectControlPlane(context.Context) error {
	c.connects++
	c.done <- struct{}{}
	return nil
}

func (c *fakeRuntimeController) DisconnectControlPlane(context.Context) error {
	c.disconnects++
	c.done <- struct{}{}
	return nil
}

func (c *fakeRuntimeController) ConfigureControlPlane(context.Context, ControlPlaneSetup) (ControlPlaneStatus, error) {
	c.connects++
	c.done <- struct{}{}
	return c.status, nil
}

func (c *fakeRuntimeController) ControlPlaneStatus() ControlPlaneStatus {
	return c.status
}

func (c *fakeRuntimeController) RuntimeOverview() RuntimeOverview {
	return c.overview
}

func (c *fakeRuntimeController) RuntimeSessions() []RuntimeSession {
	return append([]RuntimeSession(nil), c.sessions...)
}
