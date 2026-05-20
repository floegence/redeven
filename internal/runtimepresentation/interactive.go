package runtimepresentation

import (
	"context"
	"fmt"
	"io"
	"os"
	"runtime"
	"strings"
	"syscall"
	"time"

	"golang.org/x/term"
)

const (
	hideCursor           = "\033[?25l"
	showCursor           = "\033[?25h"
	clearScreen          = "\033[2J\033[H"
	cursorHome           = "\033[H"
	clearToEndScreen     = "\033[J"
	clearLine            = "\033[K"
	enterAlternateScreen = "\033[?1049h"
	exitAlternateScreen  = "\033[?1049l"
	disableLineWrapping  = "\033[?7l"
	enableLineWrapping   = "\033[?7h"
)

type RichFocus string

const (
	RichFocusControlPlane RichFocus = "control_plane"
	RichFocusSessions     RichFocus = "sessions"
	RichFocusLogs         RichFocus = "logs"
)

type RichPanel string

const (
	RichPanelNone         RichPanel = ""
	RichPanelLogs         RichPanel = "logs"
	RichPanelSessions     RichPanel = "sessions"
	RichPanelControlPlane RichPanel = "control_plane"
)

type controlPlaneSetupState struct {
	Fields     [3]string
	Active     int
	Submitting bool
	Error      string
}

type HostInfo struct {
	Hostname string
	GOOS     string
	GOARCH   string
	PID      int
}

func DetectHostInfo() HostInfo {
	hostname, _ := os.Hostname()
	hostname = strings.TrimSpace(hostname)
	if hostname == "" {
		hostname = "unknown-host"
	}
	return HostInfo{
		Hostname: hostname,
		GOOS:     runtime.GOOS,
		GOARCH:   runtime.GOARCH,
		PID:      os.Getpid(),
	}
}

func (r *Renderer) startInteractive() error {
	if r == nil {
		return nil
	}
	inputFile, ok := r.input.(*os.File)
	if !ok {
		r.interactive = false
		return r.render(r.latest)
	}

	r.mu.Lock()
	if r.started {
		r.mu.Unlock()
		r.signalRedraw()
		return nil
	}
	r.started = true
	r.mu.Unlock()

	oldState, err := term.MakeRaw(int(inputFile.Fd()))
	if err != nil {
		r.mu.Lock()
		r.interactive = false
		r.started = false
		r.mu.Unlock()
		return r.render(r.latest)
	}
	_, _ = io.WriteString(r.w, enterAlternateScreen+hideCursor+disableLineWrapping+clearScreen)

	go r.readInteractiveKeys(inputFile)
	go r.runInteractiveLoop(inputFile, oldState)
	r.signalRedraw()
	return nil
}

func (r *Renderer) stopInteractive() {
	if r == nil {
		return
	}
	r.mu.Lock()
	if !r.started {
		r.mu.Unlock()
		return
	}
	r.mu.Unlock()
	select {
	case <-r.stop:
	default:
		close(r.stop)
	}
	<-r.done
}

func (r *Renderer) runInteractiveLoop(inputFile *os.File, oldState *term.State) {
	defer close(r.done)
	defer func() {
		_ = term.Restore(int(inputFile.Fd()), oldState)
		_, _ = io.WriteString(r.w, enableLineWrapping+showCursor+exitAlternateScreen)
	}()

	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()

	r.renderInteractiveFrame(false)
	for {
		select {
		case <-r.stop:
			return
		case <-ticker.C:
			r.renderInteractiveFrame(true)
		case <-r.redraw:
			r.renderInteractiveFrame(false)
		}
	}
}

func (r *Renderer) renderInteractiveFrame(advanceFrame bool) {
	if r == nil {
		return
	}
	r.mu.Lock()
	if advanceFrame {
		r.frame++
	}
	event := r.latest
	expanded := r.expanded
	if isZeroSnapshot(event.Snapshot) {
		event.Snapshot = r.snapshot
	}
	r.mu.Unlock()

	if expanded == RichPanelLogs {
		r.writeInteractiveFrame(r.renderRichLogsPanel(event))
		return
	}
	if expanded == RichPanelSessions {
		r.writeInteractiveFrame(r.renderRichSessionsPanel(event))
		return
	}
	r.writeInteractiveFrame(r.buildRichPanel(event))
}

func (r *Renderer) writeInteractiveFrame(text string) {
	if r == nil {
		return
	}
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.TrimSuffix(text, "\n")
	next := strings.Split(text, "\n")

	r.mu.Lock()
	prev := append([]string(nil), r.lastFrame...)
	r.lastFrame = append([]string(nil), next...)
	r.mu.Unlock()

	var b strings.Builder
	if len(prev) == 0 {
		b.WriteString(cursorHome)
		for row, line := range next {
			fmt.Fprintf(&b, "\033[%d;1H%s%s", row+1, line, clearLine)
		}
		b.WriteString(clearToEndScreen)
		_, _ = io.WriteString(r.w, b.String())
		return
	}

	maxRows := maxInt(len(prev), len(next))
	for row := 0; row < maxRows; row++ {
		oldLine := ""
		if row < len(prev) {
			oldLine = prev[row]
		}
		newLine := ""
		if row < len(next) {
			newLine = next[row]
		}
		if oldLine == newLine {
			continue
		}
		fmt.Fprintf(&b, "\033[%d;1H%s%s", row+1, newLine, clearLine)
	}
	if len(next) < len(prev) {
		fmt.Fprintf(&b, "\033[%d;1H%s", len(next)+1, clearToEndScreen)
	}
	_, _ = io.WriteString(r.w, b.String())
}

func (r *Renderer) signalRedraw() {
	if r == nil || !r.interactive {
		return
	}
	select {
	case r.redraw <- struct{}{}:
	default:
	}
}

func (r *Renderer) readInteractiveKeys(inputFile *os.File) {
	buf := make([]byte, 16)
	for {
		select {
		case <-r.stop:
			return
		default:
		}
		n, err := inputFile.Read(buf)
		if err != nil || n <= 0 {
			return
		}
		r.handleInteractiveBytes(buf[:n])
	}
}

func (r *Renderer) handleInteractiveBytes(raw []byte) {
	for len(raw) > 0 {
		r.mu.Lock()
		expanded := r.expanded
		r.mu.Unlock()
		if expanded == RichPanelControlPlane {
			raw = r.handleControlPlaneSetupBytes(raw)
			continue
		}
		if expanded == RichPanelSessions {
			raw = r.handleSessionsPanelBytes(raw)
			continue
		}
		switch {
		case raw[0] == 3:
			_ = syscall.Kill(os.Getpid(), syscall.SIGINT)
			raw = raw[1:]
		case raw[0] == 13 || raw[0] == 10:
			r.handleInteractiveEnter()
			raw = raw[1:]
		case raw[0] == 27 && len(raw) >= 3 && raw[1] == '[':
			switch raw[2] {
			case 'A', 'D':
				r.moveInteractiveFocus(-1)
			case 'B', 'C':
				r.moveInteractiveFocus(1)
			}
			raw = raw[3:]
		case raw[0] == 27:
			r.handleInteractiveEscape()
			raw = raw[1:]
		default:
			raw = raw[1:]
		}
	}
}

func (r *Renderer) handleInteractiveEscape() {
	r.mu.Lock()
	if r.expanded == RichPanelLogs || r.expanded == RichPanelSessions || r.expanded == RichPanelControlPlane {
		if r.expanded == RichPanelControlPlane {
			r.setup.Fields[2] = ""
			r.setup.Error = ""
		}
		r.expanded = RichPanelNone
	}
	r.mu.Unlock()
	r.signalRedraw()
}

func (r *Renderer) handleInteractiveEnter() {
	r.mu.Lock()
	focus := r.focus
	expanded := r.expanded
	r.mu.Unlock()
	if expanded == RichPanelLogs {
		return
	}
	switch focus {
	case RichFocusSessions:
		r.mu.Lock()
		r.expanded = RichPanelSessions
		r.mu.Unlock()
		r.signalRedraw()
	case RichFocusLogs:
		r.mu.Lock()
		r.expanded = RichPanelLogs
		r.mu.Unlock()
		r.signalRedraw()
	case RichFocusControlPlane:
		go r.runControlPlaneAction()
	}
}

func (r *Renderer) moveInteractiveFocus(delta int) {
	r.mu.Lock()
	if r.expanded == RichPanelControlPlane {
		fieldCount := len(r.setup.Fields)
		r.setup.Active = (r.setup.Active + delta + fieldCount) % fieldCount
		r.mu.Unlock()
		r.signalRedraw()
		return
	}
	if r.expanded == RichPanelLogs || r.expanded == RichPanelSessions {
		r.mu.Unlock()
		return
	}
	items := []RichFocus{RichFocusControlPlane, RichFocusSessions, RichFocusLogs}
	index := 0
	for i, item := range items {
		if item == r.focus {
			index = i
			break
		}
	}
	r.focus = items[(index+delta+len(items))%len(items)]
	r.mu.Unlock()
	r.signalRedraw()
}

func (r *Renderer) runControlPlaneAction() {
	r.mu.Lock()
	controller := r.controller
	r.mu.Unlock()
	if controller == nil {
		r.openControlPlaneSetup()
		return
	}
	status := controller.ControlPlaneStatus()
	if status.Connected || status.Enabled {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := controller.DisconnectControlPlane(ctx); err != nil {
			r.setNotice("Control plane disconnect failed: " + err.Error())
			return
		}
		r.setNotice("Control plane disconnected for this runtime session.")
		return
	}
	if !status.Connectable {
		r.openControlPlaneSetup()
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := controller.ConnectControlPlane(ctx); err != nil {
		r.setNotice("Control plane connect failed: " + err.Error())
		return
	}
	r.setNotice("Control plane reconnecting.")
}

func (r *Renderer) openControlPlaneSetup() {
	r.mu.Lock()
	if r.setup.Fields[0] == "" {
		r.setup.Fields[0] = strings.TrimSpace(r.snapshot.ControlplaneBaseURL)
	}
	if r.setup.Fields[1] == "" {
		r.setup.Fields[1] = strings.TrimSpace(r.snapshot.EnvPublicID)
	}
	r.setup.Active = 0
	r.setup.Error = ""
	r.expanded = RichPanelControlPlane
	r.mu.Unlock()
	r.signalRedraw()
}

func (r *Renderer) handleControlPlaneSetupBytes(raw []byte) []byte {
	if len(raw) == 0 {
		return raw
	}
	switch {
	case raw[0] == 3:
		_ = syscall.Kill(os.Getpid(), syscall.SIGINT)
		return raw[1:]
	case raw[0] == 27 && len(raw) >= 3 && raw[1] == '[':
		switch raw[2] {
		case 'A':
			r.moveControlPlaneSetupField(-1)
		case 'B':
			r.moveControlPlaneSetupField(1)
		}
		return raw[3:]
	case raw[0] == 27:
		r.handleInteractiveEscape()
		return raw[1:]
	case raw[0] == 9:
		r.moveControlPlaneSetupField(1)
		return raw[1:]
	case raw[0] == 13 || raw[0] == 10:
		r.handleControlPlaneSetupEnter()
		return raw[1:]
	case raw[0] == 127 || raw[0] == 8:
		r.backspaceControlPlaneSetupField()
		return raw[1:]
	case raw[0] >= 32 && raw[0] != 127:
		r.appendControlPlaneSetupByte(raw[0])
		return raw[1:]
	default:
		return raw[1:]
	}
}

func (r *Renderer) moveControlPlaneSetupField(delta int) {
	r.mu.Lock()
	fieldCount := len(r.setup.Fields)
	r.setup.Active = (r.setup.Active + delta + fieldCount) % fieldCount
	r.setup.Error = ""
	r.mu.Unlock()
	r.signalRedraw()
}

func (r *Renderer) handleControlPlaneSetupEnter() {
	r.mu.Lock()
	active := r.setup.Active
	r.mu.Unlock()
	if active < 2 {
		r.moveControlPlaneSetupField(1)
		return
	}
	go r.submitControlPlaneSetup()
}

func (r *Renderer) appendControlPlaneSetupByte(ch byte) {
	r.mu.Lock()
	if !r.setup.Submitting {
		r.setup.Fields[r.setup.Active] += string(ch)
		r.setup.Error = ""
	}
	r.mu.Unlock()
	r.signalRedraw()
}

func (r *Renderer) backspaceControlPlaneSetupField() {
	r.mu.Lock()
	if !r.setup.Submitting {
		value := []rune(r.setup.Fields[r.setup.Active])
		if len(value) > 0 {
			r.setup.Fields[r.setup.Active] = string(value[:len(value)-1])
		}
		r.setup.Error = ""
	}
	r.mu.Unlock()
	r.signalRedraw()
}

func (r *Renderer) submitControlPlaneSetup() {
	r.mu.Lock()
	controller := r.controller
	setup := ControlPlaneSetup{
		ControlplaneURL: strings.TrimSpace(r.setup.Fields[0]),
		EnvironmentID:   strings.TrimSpace(r.setup.Fields[1]),
		BootstrapTicket: strings.TrimSpace(r.setup.Fields[2]),
	}
	r.setup.Submitting = true
	r.setup.Error = ""
	r.mu.Unlock()
	r.signalRedraw()

	if controller == nil {
		r.finishControlPlaneSetup("Control plane setup is not ready yet.", false, setup)
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if _, err := controller.ConfigureControlPlane(ctx, setup); err != nil {
		r.finishControlPlaneSetup("Setup failed: "+err.Error(), false, setup)
		return
	}
	r.finishControlPlaneSetup("Control plane configured; connecting.", true, setup)
}

func (r *Renderer) finishControlPlaneSetup(message string, success bool, setup ControlPlaneSetup) {
	r.mu.Lock()
	r.setup.Submitting = false
	if success {
		r.expanded = RichPanelNone
		r.notice = message
		r.setup.Fields[2] = ""
		r.snapshot.ControlplaneBaseURL = setup.ControlplaneURL
		r.snapshot.EnvPublicID = setup.EnvironmentID
		r.snapshot.ControlChannelEnabled = true
		r.snapshot.EnvironmentURL = BuildEnvironmentURL(setup.ControlplaneURL, setup.EnvironmentID)
	} else {
		r.setup.Error = message
	}
	r.mu.Unlock()
	r.signalRedraw()
}

func (r *Renderer) setNotice(message string) {
	r.mu.Lock()
	r.notice = strings.TrimSpace(message)
	r.mu.Unlock()
	r.signalRedraw()
}

func (r *Renderer) handleSessionsPanelBytes(raw []byte) []byte {
	if len(raw) == 0 {
		return raw
	}
	switch {
	case raw[0] == 3:
		_ = syscall.Kill(os.Getpid(), syscall.SIGINT)
		return raw[1:]
	case raw[0] == 27 && len(raw) >= 3 && raw[1] == '[':
		return raw[3:]
	case raw[0] == 27:
		r.handleInteractiveEscape()
		return raw[1:]
	case raw[0] == 13 || raw[0] == 10:
		return raw[1:]
	case raw[0] == 127 || raw[0] == 8:
		r.backspaceSessionFilter()
		return raw[1:]
	case raw[0] >= 32 && raw[0] != 127:
		r.appendSessionFilterByte(raw[0])
		return raw[1:]
	default:
		return raw[1:]
	}
}

func (r *Renderer) appendSessionFilterByte(ch byte) {
	r.mu.Lock()
	r.sessionFilter += string(ch)
	r.mu.Unlock()
	r.signalRedraw()
}

func (r *Renderer) backspaceSessionFilter() {
	r.mu.Lock()
	value := []rune(r.sessionFilter)
	if len(value) > 0 {
		r.sessionFilter = string(value[:len(value)-1])
	}
	r.mu.Unlock()
	r.signalRedraw()
}
