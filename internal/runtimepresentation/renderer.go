package runtimepresentation

import (
	"fmt"
	"io"
	"strings"
)

const (
	ansiReset     = "\033[0m"
	ansiDim       = "\033[2m"
	ansiBold      = "\033[1m"
	ansiCyan      = "\033[96m"
	ansiGreen     = "\033[32m"
	ansiYellow    = "\033[33m"
	ansiRed       = "\033[31m"
	ansiUnderline = "\033[4m"
)

type Renderer struct {
	w      io.Writer
	cfg    Config
	events []Event
	latest Event
}

func NewRenderer(w io.Writer, cfg Config) *Renderer {
	if w == nil {
		w = io.Discard
	}
	return &Renderer{w: w, cfg: cfg}
}

func (r *Renderer) Start(snapshot Snapshot) error {
	if r.cfg.Effective == ModeMachine {
		return nil
	}
	return r.render(Event{Kind: EventInfo, Snapshot: snapshot, Title: "Redeven runtime starting"})
}

func (r *Renderer) Emit(event Event) error {
	if r.cfg.Effective == ModeMachine {
		if event.Kind == EventFailure {
			return r.renderMachineFailure(event)
		}
		return nil
	}
	r.events = append(r.events, event)
	r.latest = event
	return r.render(event)
}

func (r *Renderer) Close(result Result) error {
	if r.cfg.Effective == ModeMachine {
		return nil
	}
	if result.Success {
		return nil
	}
	if result.Error != nil {
		return r.render(Event{
			Kind:        EventFailure,
			Severity:    SeverityError,
			Title:       "Runtime stopped with an error",
			ErrorDetail: result.Error.Error(),
			Snapshot:    result.Snapshot,
		})
	}
	return nil
}

func (r *Renderer) render(event Event) error {
	switch r.cfg.Effective {
	case ModeRich:
		return r.renderRich(event)
	case ModePlain:
		return r.renderPlain(event)
	default:
		return nil
	}
}

func (r *Renderer) renderRich(event Event) error {
	if r.cfg.Dynamic {
		_, _ = io.WriteString(r.w, "\033[2J\033[H")
	}
	switch event.Kind {
	case EventFailure:
		return r.renderRichFailure(event)
	case EventReady:
		return r.renderRichReady(event.Snapshot)
	default:
		return r.renderRichStatus(event)
	}
}

func (r *Renderer) renderRichStatus(event Event) error {
	s := event.Snapshot
	headerRight := valueOr(s.Version, "starting")
	if event.Kind == EventWarning {
		headerRight = "warning"
	}
	lines := []string{
		fmt.Sprintf("┌─ %s  Redeven Runtime %s %s ─────┐", r.brandLine(0), strings.Repeat("─", 30), headerRight),
		fmt.Sprintf("│  %s  %s  provider: %s", r.brandLine(1), valueOr(s.EffectiveRunMode, s.RequestedRunMode), valueOr(s.ControlplaneProviderID, "local")),
		"│",
		"│  Local foundation",
		fmt.Sprintf("│    %s State root      %s", r.statusSymbol(PhaseResolveState, event), valueOr(s.StateDir, "resolving")),
		fmt.Sprintf("│    %s Runtime lock    %s", r.statusSymbol(PhaseAcquireLock, event), phaseText(PhaseAcquireLock, event, "waiting")),
		"│",
		"│  Access surfaces",
		fmt.Sprintf("│    %s Local UI        %s", r.statusSymbol(PhaseStartLocalUI, event), firstNonEmpty(s.LocalUIURLs, s.LocalUIBind, "not started")),
		fmt.Sprintf("│    %s Control plane   %s", r.statusSymbol(PhaseConnectControl, event), controlPlaneText(s, event)),
		fmt.Sprintf("│    %s Environment     %s", r.statusSymbol(PhaseReady, event), valueOr(s.EnvironmentURL, "waiting for runtime registration")),
	}
	if event.Kind == EventWarning {
		lines = append(lines,
			"│",
			colorize("│  Warning", ansiYellow, r.cfg.Color),
			"│    "+valueOr(event.Title, "Runtime is degraded"),
		)
		if event.Detail != "" {
			lines = append(lines, "│    "+event.Detail)
		}
		if event.Remediation != "" {
			lines = append(lines, "│    "+event.Remediation)
		}
	} else if event.Title != "" {
		lines = append(lines,
			"│",
			"│  Activity",
			"│    "+event.Title,
		)
		if event.Detail != "" {
			lines = append(lines, "│    "+event.Detail)
		}
	}
	lines = append(lines, "└──────────────────────────────────────────────────────────────┘")
	_, err := fmt.Fprintln(r.w, strings.Join(lines, "\n"))
	return err
}

func (r *Renderer) renderRichReady(s Snapshot) error {
	envURL := s.EnvironmentURL
	if envURL == "" {
		envURL = buildEnvironmentURL(s.ControlplaneBaseURL, s.EnvPublicID)
	}
	lines := []string{
		colorize(fmt.Sprintf("%s  Redeven Runtime is ready", r.brandLine(0)), ansiGreen+ansiBold, r.cfg.Color),
		r.brandLine(1),
		"",
		"  Environment  " + styleURL(valueOr(envURL, "not connected"), r.cfg.Color),
		"  Local UI     " + styleURL(firstNonEmpty(s.LocalUIURLs, s.LocalUIBind, "not started"), r.cfg.Color),
		"  Mode         " + valueOr(s.EffectiveRunMode, s.RequestedRunMode),
		"  State        " + valueOr(s.StateDir, "unknown"),
		"",
		"Press Ctrl+C to stop the runtime.",
	}
	_, err := fmt.Fprintln(r.w, strings.Join(lines, "\n"))
	return err
}

func (r *Renderer) renderRichFailure(event Event) error {
	title := valueOr(event.Title, "Runtime startup failed")
	detail := valueOr(event.ErrorDetail, event.Detail)
	lines := []string{
		fmt.Sprintf("┌─ %s  Redeven Runtime ───────────────────────── startup failed ┐", r.brandLine(0)),
		fmt.Sprintf("│  %s", r.brandLine(1)),
		"│",
		"│  " + colorize(title, ansiRed+ansiBold, r.cfg.Color),
	}
	if detail != "" {
		lines = append(lines, "│", "│  "+detail)
	}
	if event.Remediation != "" {
		lines = append(lines, "│", "│  Fix", "│    "+event.Remediation)
	}
	if event.ErrorCode != "" {
		lines = append(lines, "│", "│  Details", "│    code: "+event.ErrorCode)
	}
	lines = append(lines, "└──────────────────────────────────────────────────────────────┘")
	_, err := fmt.Fprintln(r.w, strings.Join(lines, "\n"))
	return err
}

func (r *Renderer) renderPlain(event Event) error {
	switch event.Kind {
	case EventPhaseStarted:
		_, err := fmt.Fprintf(r.w, "[wait] %s\n", valueOr(event.Title, string(event.Phase)))
		return err
	case EventPhaseDone:
		_, err := fmt.Fprintf(r.w, "[ok] %s\n", valueOr(event.Title, string(event.Phase)))
		return err
	case EventWarning:
		line := "[warn] " + valueOr(event.Title, "runtime degraded")
		if event.Detail != "" {
			line += "; " + event.Detail
		}
		if event.Remediation != "" {
			line += "; " + event.Remediation
		}
		_, err := fmt.Fprintln(r.w, line)
		return err
	case EventFailure:
		line := "[error] "
		if event.ErrorCode != "" {
			line += event.ErrorCode + ": "
		}
		line += valueOr(event.Title, "runtime startup failed")
		if event.Remediation != "" {
			line += "\n        fix: " + event.Remediation
		}
		_, err := fmt.Fprintln(r.w, line)
		return err
	case EventReady:
		s := event.Snapshot
		_, err := fmt.Fprintf(r.w, "[ready] environment: %s\n[ready] local ui: %s\n",
			valueOr(s.EnvironmentURL, buildEnvironmentURL(s.ControlplaneBaseURL, s.EnvPublicID), "not connected"),
			firstNonEmpty(s.LocalUIURLs, s.LocalUIBind, "not started"),
		)
		return err
	default:
		if event.Title == "" {
			return nil
		}
		_, err := fmt.Fprintf(r.w, "[info] %s\n", event.Title)
		return err
	}
}

func (r *Renderer) renderMachineFailure(event Event) error {
	if event.Title == "" && event.ErrorDetail == "" {
		return nil
	}
	parts := make([]string, 0, 2)
	if strings.TrimSpace(event.Title) != "" {
		parts = append(parts, strings.TrimSpace(event.Title))
	}
	if strings.TrimSpace(event.ErrorDetail) != "" {
		parts = append(parts, strings.TrimSpace(event.ErrorDetail))
	}
	_, err := fmt.Fprintln(r.w, strings.Join(parts, ": "))
	return err
}

func (r *Renderer) brandLine(index int) string {
	mark := CompactBrandMark()
	if index >= 0 && index < len(mark.Lines) {
		return colorize(mark.Lines[index], ansiCyan+ansiBold, r.cfg.Color)
	}
	return ""
}

func (r *Renderer) statusSymbol(phase Phase, event Event) string {
	if event.Kind == EventWarning && phase == event.Phase {
		return colorize("!", ansiYellow, r.cfg.Color)
	}
	if event.Kind == EventPhaseStarted && phase == event.Phase {
		return colorize("◐", ansiCyan, r.cfg.Color)
	}
	if phaseDone(phase, r.events, event) {
		return colorize("●", ansiGreen, r.cfg.Color)
	}
	return "○"
}

func phaseDone(phase Phase, events []Event, latest Event) bool {
	if latest.Kind == EventPhaseDone && latest.Phase == phase {
		return true
	}
	for _, event := range events {
		if event.Kind == EventPhaseDone && event.Phase == phase {
			return true
		}
	}
	return false
}

func phaseText(phase Phase, event Event, fallback string) string {
	if event.Phase == phase && event.Detail != "" {
		return event.Detail
	}
	if event.Phase == phase && event.Title != "" {
		return event.Title
	}
	return fallback
}

func controlPlaneText(s Snapshot, event Event) string {
	if !s.ControlChannelEnabled {
		return "disabled"
	}
	if event.Phase == PhaseConnectControl && event.Detail != "" {
		return event.Detail
	}
	if s.ControlplaneBaseURL != "" {
		return "connecting to " + s.ControlplaneBaseURL
	}
	return "connecting"
}

func firstNonEmpty(values []string, fallback ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	for _, value := range fallback {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func valueOr(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func colorize(text string, color string, enabled bool) string {
	if !enabled || strings.TrimSpace(text) == "" {
		return text
	}
	return color + text + ansiReset
}

func styleURL(url string, enabled bool) string {
	if !enabled || strings.TrimSpace(url) == "" {
		return url
	}
	return colorize(url, ansiCyan+ansiUnderline, true)
}
