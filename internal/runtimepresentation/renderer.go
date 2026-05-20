package runtimepresentation

import (
	"fmt"
	"io"
	"strings"
	"sync"
	"time"
)

const (
	ansiReset     = "\033[0m"
	ansiBold      = "\033[1m"
	ansiCyan      = "\033[96m"
	ansiGreen     = "\033[32m"
	ansiYellow    = "\033[33m"
	ansiRed       = "\033[31m"
	ansiUnderline = "\033[4m"
)

type Renderer struct {
	w     io.Writer
	input io.Reader
	cfg   Config
	logs  *LogBuffer

	mu            sync.Mutex
	events        []Event
	latest        Event
	snapshot      Snapshot
	controller    Controller
	startedAt     time.Time
	host          HostInfo
	focus         RichFocus
	expanded      RichPanel
	notice        string
	sessionFilter string
	frame         int
	forcedWidth   int
	forcedHeight  int
	setup         controlPlaneSetupState
	lastFrame     []string

	redraw      chan struct{}
	stop        chan struct{}
	done        chan struct{}
	interactive bool
	started     bool
}

type RendererOptions struct {
	Input          io.Reader
	Logs           *LogBuffer
	Controller     Controller
	StartedAt      time.Time
	TerminalWidth  int
	TerminalHeight int
}

func NewRenderer(w io.Writer, cfg Config) *Renderer {
	return NewRendererWithOptions(w, cfg, RendererOptions{})
}

func NewRendererWithOptions(w io.Writer, cfg Config, opts RendererOptions) *Renderer {
	if w == nil {
		w = io.Discard
	}
	startedAt := opts.StartedAt
	if startedAt.IsZero() {
		startedAt = time.Now()
	}
	return &Renderer{
		w:            w,
		input:        opts.Input,
		cfg:          cfg,
		logs:         opts.Logs,
		controller:   opts.Controller,
		startedAt:    startedAt,
		host:         DetectHostInfo(),
		focus:        RichFocusSessions,
		forcedWidth:  opts.TerminalWidth,
		forcedHeight: opts.TerminalHeight,
		redraw:       make(chan struct{}, 1),
		stop:         make(chan struct{}),
		done:         make(chan struct{}),
		interactive:  cfg.Interactive,
	}
}

func (r *Renderer) SetController(controller Controller) {
	if r == nil {
		return
	}
	r.mu.Lock()
	r.controller = controller
	r.mu.Unlock()
	r.signalRedraw()
}

func (r *Renderer) Start(snapshot Snapshot) error {
	if r.cfg.Effective == ModeMachine {
		return nil
	}
	event := Event{Kind: EventInfo, Snapshot: snapshot, Title: "Redeven runtime starting"}.withTime()
	if r.interactive {
		r.mu.Lock()
		r.snapshot = snapshot
		r.latest = event
		r.events = append(r.events, event)
		r.mu.Unlock()
		return r.startInteractive()
	}
	return r.render(event)
}

func (r *Renderer) Emit(event Event) error {
	if r.cfg.Effective == ModeMachine {
		if event.Kind == EventFailure {
			return r.renderMachineFailure(event)
		}
		return nil
	}
	if r.interactive {
		r.mu.Lock()
		r.events = append(r.events, event)
		r.latest = event
		r.snapshot = event.Snapshot
		r.mu.Unlock()
		r.signalRedraw()
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
	if r.interactive {
		if result.Error != nil {
			r.mu.Lock()
			r.latest = Event{
				Kind:        EventFailure,
				Severity:    SeverityError,
				Title:       "Runtime stopped with an error",
				ErrorDetail: result.Error.Error(),
				Snapshot:    result.Snapshot,
			}.withTime()
			r.events = append(r.events, r.latest)
			r.snapshot = result.Snapshot
			r.mu.Unlock()
			r.signalRedraw()
		}
		r.stopInteractive()
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
	var err error
	switch event.Kind {
	case EventFailure:
		err = r.renderRichFailure(event)
	case EventReady:
		err = r.renderRichReady(event.Snapshot)
	default:
		err = r.renderRichStatus(event)
	}
	if r.cfg.Dynamic {
		r.frame++
	}
	return err
}

func (r *Renderer) renderRichStatus(event Event) error {
	return r.renderRichPanel(event)
}

func (r *Renderer) renderRichReady(s Snapshot) error {
	return r.renderRichPanel(Event{Kind: EventReady, Phase: PhaseReady, Title: "Redeven runtime is ready", Snapshot: s})
}

func (r *Renderer) renderRichFailure(event Event) error {
	return r.renderRichPanel(event)
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
