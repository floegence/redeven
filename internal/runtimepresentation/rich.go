package runtimepresentation

import (
	"fmt"
	"os"
	"strings"
	"time"

	"golang.org/x/term"
)

const (
	richText       = "\033[38;2;232;236;242m"
	richMuted      = "\033[38;2;142;153;168m"
	richBrandLight = "\033[38;2;220;255;247m"
	richAccent     = "\033[38;2;178;244;235m"
	richGreen      = "\033[38;2;169;245;210m"
	richYellow     = "\033[38;2;246;196;94m"
	richRed        = "\033[38;2;255;115;115m"
	richFocusBG    = "\033[48;2;20;58;54m"
)

type richScenario string

const (
	richScenarioStartup richScenario = "startup"
	richScenarioReady   richScenario = "ready"
	richScenarioWarning richScenario = "warning"
	richScenarioError   richScenario = "error"
)

type richLog struct {
	time    string
	level   string
	message string
}

func (r *Renderer) renderRichPanel(event Event) error {
	panel := r.buildRichPanel(event)
	if !r.interactive {
		panel = "\n" + panel
	}
	_, err := fmt.Fprint(r.w, panel)
	return err
}

func (r *Renderer) buildRichPanel(event Event) string {
	width, height := r.richTerminalSize()
	width = richPanelWidth(width)
	height = richPanelHeight(height)
	scenario := richScenarioForEvent(event)
	compact := height > 0 && height < 28

	var b strings.Builder
	b.WriteString(richLine(width, "╭", "╮", "─"))
	b.WriteString(r.richHeader(width, event, scenario))
	b.WriteString(richLine(width, "├", "┤", "─"))
	if compact {
		b.WriteString(r.richCompactOverviewRows(width, event, scenario))
	} else if width >= 104 {
		leftWidth := width*58/100 - 2
		rightWidth := width - leftWidth - 7
		b.WriteString(richTwoColumnRow(width, r.richRuntimeBlock(leftWidth, event, scenario), r.richActivityBlock(rightWidth, event, scenario)))
	} else {
		b.WriteString(richPlainRows(width, r.richRuntimeBlock(width-4, event, scenario)))
		b.WriteString(richLine(width, "├", "┤", "─"))
		b.WriteString(richPlainRows(width, r.richActivityBlock(width-4, event, scenario)))
	}
	if !compact {
		if callout := r.richCalloutRows(width, event, scenario); callout != "" {
			b.WriteString(richLine(width, "├", "┤", "─"))
			b.WriteString(callout)
		}
	}
	if r.expanded == RichPanelControlPlane {
		b.WriteString(richLine(width, "├", "┤", "─"))
		b.WriteString(r.richControlPlaneSetupRows(width))
	}
	if !compact {
		b.WriteString(richLine(width, "├", "┤", "─"))
		b.WriteString(r.richAccessRows(width, event, scenario))
	} else {
		b.WriteString(richLine(width, "├", "┤", "─"))
		b.WriteString(r.richCompactAccessRows(width, event, scenario))
	}
	b.WriteString(richLine(width, "├", "┤", "─"))
	logLimit := 3
	if compact {
		logLimit = maxInt(1, height-richVisibleLineCount(b.String())-3)
	}
	b.WriteString(r.richLogRows(width, event, logLimit))
	b.WriteString(richLine(width, "╰", "╯", "─"))
	if !compact {
		b.WriteString(r.richFooter(width, scenario))
	}
	b.WriteString("\n")
	return b.String()
}

func (r *Renderer) richHeader(width int, event Event, scenario richScenario) string {
	icon := CompactBrandMarkFrame(r.frame).Lines
	contentWidth := width - 2
	logoWidth := maxVisibleWidth(icon)
	rightWidth := maxInt(contentWidth-logoWidth-4, 1)
	rightLines := r.richHeaderRightLines(rightWidth, event, scenario)

	var b strings.Builder
	for i, logoLine := range icon {
		line := " " + r.richLogoStyle(scenario, i) + richPadPlain(logoLine, logoWidth) + richReset(r.cfg.Color)
		if i < len(rightLines) {
			line += "  " + rightLines[i]
		}
		b.WriteString("│")
		b.WriteString(richPadVisible(line, contentWidth))
		b.WriteString("│\n")
	}
	return b.String()
}

func (r *Renderer) richHeaderRightLines(width int, event Event, scenario richScenario) []string {
	status := map[richScenario]string{
		richScenarioStartup: "STARTING",
		richScenarioReady:   "READY",
		richScenarioWarning: "DEGRADED",
		richScenarioError:   "BLOCKED",
	}[scenario]
	tone := r.richTone(scenario)
	title := r.richColor(ansiBold, richText) + richTruncateVisible("Redeven Runtime", maxInt(width-12, 1)) + richReset(r.cfg.Color)
	statusText := r.richColor(tone) + status + richReset(r.cfg.Color)
	titleLine := title
	if richVisibleLen(titleLine)+richVisibleLen(statusText)+1 <= width {
		titleLine += strings.Repeat(" ", width-richVisibleLen(titleLine)-richVisibleLen(statusText)) + statusText
	}

	return []string{
		titleLine,
		r.richHeaderKV("Host", r.richHostLine(), richText, width),
		r.richHeaderKV("Uptime", r.richUptimeLine(), richBrandLight, width),
		r.richHeaderKV("Surface", r.richSurfaceLine(event, scenario), richAccent, width),
		r.richHeaderKV("Control", r.richControlLine(event, scenario), tone, width),
	}
}

func (r *Renderer) richHeaderKV(label string, value string, tone string, width int) string {
	labelWidth := 8
	if width < 38 {
		switch label {
		case "Uptime":
			label = "Up"
		case "Surface":
			label = "UI"
		case "Control":
			label = "Ctrl"
		}
		labelWidth = 4
	}
	prefix := r.richMuted(richPadVisible(label, labelWidth)) + " "
	valueWidth := maxInt(width-richVisibleLen(prefix), 1)
	return prefix + r.richColor(tone) + richTruncateVisible(value, valueWidth) + richReset(r.cfg.Color)
}

func (r *Renderer) richHostLine() string {
	host := r.host
	return fmt.Sprintf("%s · %s/%s · pid %d", host.Hostname, host.GOOS, host.GOARCH, host.PID)
}

func (r *Renderer) richUptimeLine() string {
	elapsed := time.Since(r.startedAt)
	if elapsed < 0 {
		elapsed = 0
	}
	total := int(elapsed.Round(time.Second).Seconds())
	hours := total / 3600
	minutes := (total % 3600) / 60
	seconds := total % 60
	return fmt.Sprintf("%02d:%02d:%02d", hours, minutes, seconds)
}

func (r *Renderer) richSurfaceLine(event Event, scenario richScenario) string {
	if scenario == richScenarioError && event.Phase == PhaseStartLocalUI {
		return "local UI blocked"
	}
	if url := firstNonEmpty(event.Snapshot.LocalUIURLs, ""); url != "" {
		return url
	}
	if event.Snapshot.LocalUIEnabled || strings.TrimSpace(event.Snapshot.LocalUIBind) != "" {
		return "local UI preparing " + strings.TrimSpace(event.Snapshot.LocalUIBind)
	}
	return "local UI disabled"
}

func (r *Renderer) richControlLine(event Event, scenario richScenario) string {
	if r.controller != nil {
		status := r.controller.ControlPlaneStatus()
		label := valueOr(status.Label, controlPlaneText(event.Snapshot, event))
		if status.ActionLabel != "" {
			return label + " · Enter " + status.ActionLabel
		}
		return label
	}
	if !event.Snapshot.ControlChannelEnabled {
		return "control plane disabled"
	}
	switch scenario {
	case richScenarioWarning:
		return "control plane retrying"
	case richScenarioError:
		return "control plane offline"
	case richScenarioReady:
		return "control plane connected"
	default:
		return "control plane connecting"
	}
}

func (r *Renderer) richRuntimeBlock(width int, event Event, scenario richScenario) []string {
	overview := r.runtimeOverview(event)
	version := r.richRuntimeVersionLine(overview, event)
	mode := valueOr(overview.EffectiveRunMode, event.Snapshot.EffectiveRunMode, event.Snapshot.RequestedRunMode, "local")
	owner := valueOr(overview.ServiceOwner, richBoolLabel(overview.DesktopManaged, "desktop", "external"))
	protocol := valueOr(overview.ProtocolVersion, "starting")
	compatibility := valueOr(overview.Compatibility, "checking")
	readiness := valueOr(overview.OpenReadinessState, r.runtimeReadinessFromScenario(scenario))
	readinessDetail := valueOr(overview.OpenReadinessMessage, overview.CompatibilityMessage, event.Title)

	rows := []string{
		r.richSectionTitle("Runtime"),
		"",
		r.richKVLine("Version", version, richText, width),
		r.richKVLine("Mode", mode+" · "+owner, richAccent, width),
		r.richKVLine("Protocol", protocol, richMuted, width),
		r.richKVLine("Health", readiness+" · "+compatibility, r.richTone(scenario), width),
	}
	if readinessDetail != "" && scenario != richScenarioReady {
		rows = append(rows, r.richKVLine("Detail", readinessDetail, richMuted, width))
	}
	if r.notice != "" {
		rows = append(rows, "", r.richColor(richBrandLight)+richTruncateVisible(r.notice, width)+richReset(r.cfg.Color))
	}
	return richFitLines(rows, width)
}

func (r *Renderer) richActivityBlock(width int, event Event, scenario richScenario) []string {
	overview := r.runtimeOverview(event)
	lines := []string{r.richSectionTitle("Activity"), ""}
	lines = append(lines,
		r.richMetricLine("Sessions", fmt.Sprint(overview.Workload.ActiveSessions), "connected clients", richAccent, RichFocusSessions, width),
		r.richMetricLine("Terminals", fmt.Sprint(overview.Workload.TerminalSessions), "visible terminal sessions", richGreen, "", width),
		r.richMetricLine("AI tasks", fmt.Sprint(overview.Workload.ActiveTasks), "active runs", richYellow, "", width),
		r.richMetricLine("Port forwards", fmt.Sprint(overview.Workload.PortForwardSessions), "open remote forwards", richAccent, "", width),
	)
	controlValue := "Enter"
	if status := r.controlPlaneStatus(event); status.ActionLabel != "" {
		controlValue = "Enter " + status.ActionLabel
	}
	lines = append(lines, r.richMetricLine("Control", controlValue, r.richControlLine(event, scenario), r.richTone(scenario), RichFocusControlPlane, width))
	provider := r.providerLinkSummary(overview)
	if provider != "" {
		lines = append(lines, r.richMetricLine("Provider", provider, "remote access binding", richMuted, "", width))
	}
	return richFitLines(lines, width)
}

func (r *Renderer) richCompactOverviewRows(width int, event Event, scenario richScenario) string {
	overview := r.runtimeOverview(event)
	version := r.richRuntimeVersionLine(overview, event)
	mode := valueOr(overview.EffectiveRunMode, event.Snapshot.EffectiveRunMode, event.Snapshot.RequestedRunMode, "local")
	rows := []string{
		r.richSectionTitle("Runtime") + "  " + r.richColor(richText) + richTruncateVisible(version+" · "+mode, maxInt(width-15, 1)) + richReset(r.cfg.Color),
		r.richMetricLine("Sessions", fmt.Sprint(overview.Workload.ActiveSessions), fmt.Sprintf("clients · tasks %d · terms %d · ports %d", overview.Workload.ActiveTasks, overview.Workload.TerminalSessions, overview.Workload.PortForwardSessions), richAccent, RichFocusSessions, width-4),
		r.richMetricLine("Control", "Enter", r.richControlLine(event, scenario), r.richTone(scenario), RichFocusControlPlane, width-4),
	}
	if r.notice != "" {
		rows = append(rows, r.richColor(richBrandLight)+r.notice+richReset(r.cfg.Color))
	}
	return richPlainRows(width, rows)
}

func (r *Renderer) runtimeOverview(event Event) RuntimeOverview {
	overview := RuntimeOverview{}
	if r.controller != nil {
		overview = r.controller.RuntimeOverview()
	}
	if overview.Version == "" {
		overview.Version = event.Snapshot.Version
	}
	if overview.Commit == "" {
		overview.Commit = event.Snapshot.Commit
	}
	if overview.EffectiveRunMode == "" {
		overview.EffectiveRunMode = event.Snapshot.EffectiveRunMode
	}
	if overview.EffectiveRunMode == "" {
		overview.EffectiveRunMode = event.Snapshot.RequestedRunMode
	}
	if overview.ServiceOwner == "" {
		if event.Snapshot.DesktopManaged {
			overview.ServiceOwner = "desktop"
		} else {
			overview.ServiceOwner = "external"
		}
	}
	overview.DesktopManaged = overview.DesktopManaged || event.Snapshot.DesktopManaged
	overview.RemoteEnabled = overview.RemoteEnabled || event.Snapshot.RemoteEnabled
	return overview
}

func (r *Renderer) richRuntimeVersionLine(overview RuntimeOverview, event Event) string {
	version := valueOr(overview.Version, event.Snapshot.Version, "dev")
	commit := shortCommit(valueOr(overview.Commit, event.Snapshot.Commit))
	if commit != "" {
		return version + " (" + commit + ")"
	}
	return version
}

func (r *Renderer) runtimeReadinessFromScenario(scenario richScenario) string {
	switch scenario {
	case richScenarioReady:
		return "openable"
	case richScenarioWarning:
		return "degraded"
	case richScenarioError:
		return "blocked"
	default:
		return "starting"
	}
}

func (r *Renderer) controlPlaneStatus(event Event) ControlPlaneStatus {
	if r.controller != nil {
		return r.controller.ControlPlaneStatus()
	}
	if !event.Snapshot.ControlChannelEnabled {
		return ControlPlaneStatus{Label: "control plane disabled"}
	}
	return ControlPlaneStatus{Enabled: true, Label: controlPlaneText(event.Snapshot, event)}
}

func (r *Renderer) providerLinkSummary(overview RuntimeOverview) string {
	state := strings.TrimSpace(overview.ProviderLink.State)
	if state == "" {
		if overview.RemoteEnabled {
			state = "enabled"
		} else {
			state = "unbound"
		}
	}
	if overview.ProviderLink.ProviderID != "" {
		return state + " · " + overview.ProviderLink.ProviderID
	}
	return state
}

func (r *Renderer) richKVLine(label string, value string, tone string, width int) string {
	labelWidth := 10
	if width < 44 {
		labelWidth = 7
	}
	prefix := r.richMuted(richPadVisible(label, labelWidth)) + " "
	valueWidth := maxInt(width-richVisibleLen(prefix), 1)
	return prefix + r.richColor(tone) + richTruncateVisible(value, valueWidth) + richReset(r.cfg.Color)
}

func (r *Renderer) richMetricLine(label string, value string, detail string, tone string, focus RichFocus, width int) string {
	width = maxInt(width, 1)
	selected := focus != "" && r.focus == focus && r.expanded == RichPanelNone
	prefix := "  "
	if selected {
		prefix = r.richColor(richBrandLight) + "› " + richReset(r.cfg.Color)
	}
	value = strings.TrimSpace(value)
	if value == "" {
		value = "0"
	}
	valueText := r.richColor(tone) + richTruncateVisible(value, minInt(maxInt(width/5, 4), 14)) + richReset(r.cfg.Color)
	labelText := label
	if detail != "" {
		labelText += "  " + detail
	}
	leftWidth := maxInt(width-richVisibleLen(prefix)-richVisibleLen(valueText)-1, 1)
	line := prefix + richTruncateVisible(labelText, leftWidth)
	line = richPadVisible(line, maxInt(width-richVisibleLen(valueText), 1)) + valueText
	if selected {
		return r.richFocusLine(line, width)
	}
	return richPadVisible(line, width)
}

func richBoolLabel(value bool, trueValue string, falseValue string) string {
	if value {
		return trueValue
	}
	return falseValue
}

func shortCommit(commit string) string {
	commit = strings.TrimSpace(commit)
	if len([]rune(commit)) <= 8 {
		return commit
	}
	return string([]rune(commit)[:8])
}

func (r *Renderer) richCalloutRows(width int, event Event, scenario richScenario) string {
	var title string
	var tone string
	var lines []string
	switch scenario {
	case richScenarioWarning:
		title = "Advisory"
		tone = richYellow
		lines = []string{
			valueOr(event.Detail, "Continue through the Local UI; remote access will reconnect automatically."),
			valueOr(event.Remediation, "Use the log stream below if the retry loop keeps failing."),
		}
	case richScenarioError:
		title = "Fix"
		tone = richRed
		lines = []string{
			valueOr(event.Remediation, "Fix the startup issue, then run the same command again."),
		}
		if event.ErrorCode != "" {
			lines = append(lines, event.ErrorCode)
		}
		if detail := valueOr(event.ErrorDetail, event.Detail); detail != "" {
			lines = append(lines, detail)
		}
	default:
		return ""
	}

	var b strings.Builder
	b.WriteString("│ ")
	b.WriteString(richPadVisible(r.richColor(tone)+strings.ToUpper(title)+richReset(r.cfg.Color), width-4))
	b.WriteString(" │\n")
	for _, line := range lines {
		for _, wrapped := range richWrapVisible(line, width-6) {
			b.WriteString("│   ")
			b.WriteString(richPadVisible(wrapped, width-6))
			b.WriteString(" │\n")
		}
	}
	return b.String()
}

func (r *Renderer) richAccessRows(width int, event Event, scenario richScenario) string {
	s := event.Snapshot
	envURL := s.EnvironmentURL
	if envURL == "" {
		envURL = buildEnvironmentURL(s.ControlplaneBaseURL, s.EnvPublicID)
	}
	if scenario == richScenarioStartup && envURL == "" {
		envURL = "waiting for runtime registration"
	}
	rows := []struct {
		key   string
		value string
		tone  string
	}{
		{"Local UI", firstNonEmpty(s.LocalUIURLs, s.LocalUIBind, "not started"), richAccent},
		{"Environment", valueOr(envURL, "not connected"), richAccent},
		{"Provider", valueOr(r.runtimeOverview(event).ProviderLink.ProviderOrigin, s.ProviderOrigin, "not linked"), richText},
		{"Access Point", valueOr(r.runtimeOverview(event).ProviderLink.AccessPointOrigin, s.ControlplaneBaseURL, "not linked"), richText},
	}

	var b strings.Builder
	b.WriteString("│ ")
	b.WriteString(richPadVisible(r.richSectionTitle("Access"), width-4))
	b.WriteString(" │\n")
	for _, row := range rows {
		key := r.richMuted(richPadVisible(row.key, 11))
		prefix := " " + key + "  "
		available := width - 2 - richVisibleLen(prefix)
		wrapped := richWrapTokenAware(row.value, available)
		for i, item := range wrapped {
			rowPrefix := prefix
			if i > 0 {
				rowPrefix = strings.Repeat(" ", richVisibleLen(prefix))
			}
			body := rowPrefix + r.richColor(row.tone) + item + richReset(r.cfg.Color)
			b.WriteString("│")
			b.WriteString(richPadVisible(body, width-2))
			b.WriteString("│\n")
		}
	}
	return b.String()
}

func (r *Renderer) richCompactAccessRows(width int, event Event, scenario richScenario) string {
	s := event.Snapshot
	envURL := s.EnvironmentURL
	if envURL == "" {
		envURL = buildEnvironmentURL(s.ControlplaneBaseURL, s.EnvPublicID)
	}
	if scenario == richScenarioStartup && envURL == "" {
		envURL = "waiting for registration"
	}
	rows := []string{
		r.richSectionTitle("Access"),
		r.richMuted("Local") + "  " + r.richColor(richAccent) + firstNonEmpty(s.LocalUIURLs, s.LocalUIBind, "not started") + richReset(r.cfg.Color),
		r.richMuted("Env") + "    " + r.richColor(richAccent) + valueOr(envURL, "not connected") + richReset(r.cfg.Color),
	}
	return richPlainRows(width, rows)
}

func (r *Renderer) richControlPlaneSetupRows(width int) string {
	labels := []string{"Provider", "Access Point", "Environment", "Ticket"}
	values := r.setup.Fields
	var b strings.Builder
	b.WriteString("│ ")
	title := r.richSectionTitle("Control Plane Setup")
	title = richPadVisible(title, maxInt(width-36, 1)) + r.richMuted("Enter next · Esc close")
	b.WriteString(richPadVisible(title, width-4))
	b.WriteString(" │\n")
	for i, label := range labels {
		value := values[i]
		if i == 3 && value != "" {
			value = strings.Repeat("•", minInt(richVisibleLen(value), 18))
		}
		if i == r.setup.Active && !r.setup.Submitting {
			value += "█"
		}
		if value == "" {
			value = r.richMuted(richControlPlaneSetupPlaceholder(i))
		} else {
			value = r.richColor(richText) + value + richReset(r.cfg.Color)
		}
		line := fmt.Sprintf("  %-12s %s", label, value)
		if i == r.setup.Active {
			line = r.richFocusLine(line, width-4)
		}
		b.WriteString("│ ")
		b.WriteString(richPadVisible(line, width-4))
		b.WriteString(" │\n")
	}
	if r.setup.Submitting {
		b.WriteString("│ ")
		b.WriteString(richPadVisible(r.richColor(richAccent)+"Configuring and connecting..."+richReset(r.cfg.Color), width-4))
		b.WriteString(" │\n")
	}
	if r.setup.Error != "" {
		for _, line := range richWrapVisible(r.setup.Error, width-4) {
			b.WriteString("│ ")
			b.WriteString(richPadVisible(r.richColor(richRed)+line+richReset(r.cfg.Color), width-4))
			b.WriteString(" │\n")
		}
	}
	return b.String()
}

func richControlPlaneSetupPlaceholder(index int) string {
	switch index {
	case 0:
		return "https://redeven.test"
	case 1:
		return "https://dev.redeven.test"
	case 2:
		return "env_..."
	default:
		return "paste bootstrap ticket"
	}
}

func (r *Renderer) richLogRows(width int, event Event, limit int) string {
	var b strings.Builder
	b.WriteString("│ ")
	title := r.richSectionTitle("Latest Logs")
	if r.focus == RichFocusLogs && r.expanded == RichPanelNone {
		title = r.richColor(richBrandLight) + "› " + richReset(r.cfg.Color) + title
	}
	title = richPadVisible(title, maxInt(width-18, 1)) + r.richMuted("Enter expand")
	if r.focus == RichFocusLogs && r.expanded == RichPanelNone {
		title = r.richFocusLine(title, width-4)
	}
	b.WriteString(richPadVisible(title, width-4))
	b.WriteString(" │\n")
	for _, entry := range r.richLatestLogs(event, limit) {
		levelTone := richMuted
		switch entry.level {
		case "INFO":
			levelTone = richAccent
		case "WARN":
			levelTone = richYellow
		case "ERROR":
			levelTone = richRed
		}
		prefix := r.richMuted(entry.time) + " " + r.richColor(levelTone) + richPadVisible(entry.level, 5) + richReset(r.cfg.Color) + " "
		available := maxInt(width-4-richVisibleLen(prefix), 1)
		line := prefix + richTruncateVisible(entry.message, available)
		b.WriteString("│ ")
		b.WriteString(richPadVisible(line, width-4))
		b.WriteString(" │\n")
	}
	return b.String()
}

func (r *Renderer) richLatestLogs(event Event, limit int) []richLog {
	if limit < 1 {
		limit = 1
	}
	if r.logs != nil {
		lines := r.logs.Lines(limit)
		if len(lines) > 0 {
			out := make([]richLog, 0, len(lines))
			for _, line := range lines {
				stamp := "--:--:--"
				if !line.At.IsZero() {
					stamp = line.At.Format("15:04:05")
				}
				out = append(out, richLog{
					time:    stamp,
					level:   valueOr(line.Level, "INFO"),
					message: valueOr(line.Message, line.Raw),
				})
			}
			return out
		}
		return []richLog{{time: "--:--:--", level: "INFO", message: "waiting for runtime log lines"}}
	}
	source := append([]Event(nil), r.events...)
	if len(source) == 0 {
		source = append(source, event)
	}
	logs := make([]richLog, 0, limit)
	for i := len(source) - 1; i >= 0 && len(logs) < limit; i-- {
		item := source[i]
		message := valueOr(item.Title, item.Detail, item.ErrorDetail)
		if message == "" {
			continue
		}
		level := "INFO"
		if item.Kind == EventWarning {
			level = "WARN"
		}
		if item.Kind == EventFailure {
			level = "ERROR"
			message = valueOr(item.ErrorDetail, item.Title)
		}
		stamp := "--:--:--"
		if !item.At.IsZero() {
			stamp = item.At.Format("15:04:05")
		}
		logs = append(logs, richLog{time: stamp, level: level, message: message})
	}
	for i, j := 0, len(logs)-1; i < j; i, j = i+1, j-1 {
		logs[i], logs[j] = logs[j], logs[i]
	}
	for len(logs) < limit {
		logs = append(logs, richLog{time: "--:--:--", level: "INFO", message: "waiting for runtime log lines"})
	}
	return logs
}

func (r *Renderer) renderRichSessionsPanel(event Event) string {
	terminalWidth, terminalHeight := r.richTerminalSize()
	width := richPanelWidth(terminalWidth)
	height := richPanelHeight(terminalHeight)
	if height <= 0 {
		height = 24
	}
	sessions := r.filteredRuntimeSessions()
	filter := strings.TrimSpace(r.sessionFilter)
	var b strings.Builder
	b.WriteString(richLine(width, "╭", "╮", "─"))
	title := r.richColor(richBrandLight) + "SESSIONS" + richReset(r.cfg.Color)
	countLabel := fmt.Sprintf("%d active", len(sessions))
	if filter != "" {
		countLabel += " · filter " + filter
	}
	title = richJoinTitle(title, r.richMuted(countLabel+" · Esc close"), width-4)
	b.WriteString("│ ")
	b.WriteString(richPadVisible(title, width-4))
	b.WriteString(" │\n")
	b.WriteString(richLine(width, "├", "┤", "─"))

	filterLine := r.richMuted("Filter") + "  " + r.richColor(richText) + valueOr(filter, "type to filter by user, app, channel, or target") + richReset(r.cfg.Color)
	b.WriteString("│ ")
	b.WriteString(richPadVisible(filterLine, width-4))
	b.WriteString(" │\n")
	b.WriteString(richLine(width, "├", "┤", "─"))

	if len(sessions) == 0 {
		empty := "No active sessions"
		if filter != "" {
			empty = "No active sessions match the current filter"
		}
		b.WriteString("│ ")
		b.WriteString(richPadVisible(r.richMuted(empty), width-4))
		b.WriteString(" │\n")
		b.WriteString(richLine(width, "╰", "╯", "─"))
		b.WriteString("  ")
		b.WriteString(r.richMuted("Type to filter. Backspace edits. Esc returns to the runtime overview."))
		b.WriteString("\n")
		return b.String()
	}

	bodyHeight := maxInt(height-8, 1)
	b.WriteString("│ ")
	b.WriteString(richPadVisible(r.richSessionHeader(width-4), width-4))
	b.WriteString(" │\n")
	for i, session := range sessions {
		if i >= bodyHeight {
			remaining := len(sessions) - i
			line := r.richMuted(fmt.Sprintf("%d more hidden by terminal height", remaining))
			b.WriteString("│ ")
			b.WriteString(richPadVisible(line, width-4))
			b.WriteString(" │\n")
			break
		}
		b.WriteString("│ ")
		b.WriteString(richPadVisible(r.richSessionRow(width-4, session), width-4))
		b.WriteString(" │\n")
	}
	b.WriteString(richLine(width, "╰", "╯", "─"))
	b.WriteString("  ")
	b.WriteString(r.richMuted("Type to filter. Backspace edits. Esc returns to the runtime overview."))
	b.WriteString("\n")
	return b.String()
}

func (r *Renderer) runtimeSessions() []RuntimeSession {
	if r.controller == nil {
		return nil
	}
	return r.controller.RuntimeSessions()
}

func (r *Renderer) filteredRuntimeSessions() []RuntimeSession {
	sessions := r.runtimeSessions()
	filter := strings.ToLower(strings.TrimSpace(r.sessionFilter))
	if filter == "" {
		return sessions
	}
	out := make([]RuntimeSession, 0, len(sessions))
	for _, session := range sessions {
		haystack := strings.ToLower(strings.Join([]string{
			session.ChannelID,
			session.UserPublicID,
			session.UserEmail,
			session.FloeApp,
			session.AppLabel,
			session.CodeSpaceID,
			session.SessionKind,
			session.TunnelURL,
		}, " "))
		if strings.Contains(haystack, filter) {
			out = append(out, session)
		}
	}
	return out
}

func (r *Renderer) richSessionHeader(width int) string {
	if width < 72 {
		return r.richMuted(richPadVisible("APP", 14) + richPadVisible("USER", 18) + richPadVisible("PERM", 5) + " AGE")
	}
	return r.richMuted(richPadVisible("APP", 16) + richPadVisible("USER", 24) + richPadVisible("TARGET", 18) + richPadVisible("PERM", 6) + " CHANNEL")
}

func (r *Renderer) richSessionRow(width int, session RuntimeSession) string {
	app := valueOr(session.AppLabel, runtimeSessionAppLabel(session.FloeApp))
	user := valueOr(session.UserEmail, session.UserPublicID, "local user")
	target := valueOr(session.CodeSpaceID, session.SessionKind, "env")
	perms := runtimeSessionPermissions(session)
	age := runtimeSessionAge(session.ConnectedAtUnixMs)
	if width < 72 {
		line := richPadVisible(app, 14) +
			richPadVisible(user, 18) +
			richPadVisible(perms, 5) +
			age
		return richTruncateVisible(line, width)
	}
	line := richPadVisible(app, 16) +
		richPadVisible(user, 24) +
		richPadVisible(target, 18) +
		richPadVisible(perms, 6) +
		valueOr(session.ChannelID, "-")
	return richTruncateVisible(line, width)
}

func runtimeSessionAppLabel(floeApp string) string {
	switch strings.TrimSpace(floeApp) {
	case "com.floegence.redeven.agent":
		return "Env App"
	case "com.floegence.redeven.code":
		return "Code"
	case "com.floegence.redeven.portforward":
		return "Port Forward"
	default:
		return "Session"
	}
}

func runtimeSessionPermissions(session RuntimeSession) string {
	var b strings.Builder
	if session.CanRead {
		b.WriteString("R")
	}
	if session.CanWrite {
		b.WriteString("W")
	}
	if session.CanExecute {
		b.WriteString("X")
	}
	if b.Len() == 0 {
		return "-"
	}
	return b.String()
}

func runtimeSessionAge(connectedAtUnixMs int64) string {
	if connectedAtUnixMs <= 0 {
		return "-"
	}
	elapsed := time.Since(time.UnixMilli(connectedAtUnixMs))
	if elapsed < 0 {
		elapsed = 0
	}
	if elapsed < time.Minute {
		return fmt.Sprintf("%ds", int(elapsed.Seconds()))
	}
	if elapsed < time.Hour {
		return fmt.Sprintf("%dm", int(elapsed.Minutes()))
	}
	return fmt.Sprintf("%dh", int(elapsed.Hours()))
}

func (r *Renderer) renderRichLogsPanel(event Event) string {
	terminalWidth, terminalHeight := r.richTerminalSize()
	width := richPanelWidth(terminalWidth)
	height := richPanelHeight(terminalHeight)
	if height <= 0 {
		height = 24
	}
	logs := r.richLatestLogs(event, height-4)
	var b strings.Builder
	b.WriteString(richLine(width, "╭", "╮", "─"))
	title := r.richColor(richBrandLight) + "LOGS" + richReset(r.cfg.Color)
	title = richJoinTitle(title, r.richMuted("Esc close"), width-4)
	b.WriteString("│ ")
	b.WriteString(richPadVisible(title, width-4))
	b.WriteString(" │\n")
	b.WriteString(richLine(width, "├", "┤", "─"))
	for _, entry := range logs {
		levelTone := richMuted
		switch entry.level {
		case "INFO":
			levelTone = richAccent
		case "WARN":
			levelTone = richYellow
		case "ERROR":
			levelTone = richRed
		}
		prefix := r.richMuted(entry.time) + " " + r.richColor(levelTone) + richPadVisible(entry.level, 5) + richReset(r.cfg.Color) + " "
		available := maxInt(width-4-richVisibleLen(prefix), 1)
		for i, msg := range richWrapVisible(entry.message, available) {
			line := prefix + msg
			if i > 0 {
				line = strings.Repeat(" ", richVisibleLen(prefix)) + msg
			}
			b.WriteString("│ ")
			b.WriteString(richPadVisible(line, width-4))
			b.WriteString(" │\n")
		}
	}
	b.WriteString(richLine(width, "╰", "╯", "─"))
	b.WriteString("  ")
	b.WriteString(r.richMuted("Esc returns to the runtime overview. Ctrl+C stops the runtime."))
	b.WriteString("\n")
	return b.String()
}

func (r *Renderer) richFooter(width int, scenario richScenario) string {
	text := "Use arrow keys to move. Enter opens the focused item. Ctrl+C stops the runtime."
	tone := richMuted
	if scenario == richScenarioWarning {
		text = "Redeven keeps serving the Local UI while reconnecting in the background."
		tone = richYellow
	}
	if scenario == richScenarioError {
		text = "Fix the startup issue, then run the same command again."
		tone = richRed
	}
	var b strings.Builder
	for _, line := range richWrapVisible(text, maxInt(width-4, 20)) {
		b.WriteString("  ")
		b.WriteString(r.richColor(tone))
		b.WriteString(line)
		b.WriteString(richReset(r.cfg.Color))
		b.WriteString("\n")
	}
	return b.String()
}

func (r *Renderer) richLogoStyle(_ richScenario, _ int) string {
	if !r.cfg.Color {
		return ""
	}
	return ansiBold + richBrandLight
}

func (r *Renderer) richTone(scenario richScenario) string {
	switch scenario {
	case richScenarioWarning:
		return richYellow
	case richScenarioError:
		return richRed
	case richScenarioReady:
		return richGreen
	default:
		return richAccent
	}
}

func (r *Renderer) richSectionTitle(title string) string {
	return r.richColor(richMuted) + strings.ToUpper(title) + richReset(r.cfg.Color)
}

func (r *Renderer) richFocusLine(text string, width int) string {
	text = richPadVisible(text, width)
	if !r.cfg.Color {
		return text
	}
	text = strings.ReplaceAll(text, ansiReset, ansiReset+richFocusBG)
	return richFocusBG + text + ansiReset
}

func (r *Renderer) richMuted(text string) string {
	return r.richColor(richMuted) + text + richReset(r.cfg.Color)
}

func (r *Renderer) richColor(parts ...string) string {
	if !r.cfg.Color {
		return ""
	}
	return strings.Join(parts, "")
}

func (r *Renderer) richTerminalSize() (int, int) {
	if r.forcedWidth > 0 || r.forcedHeight > 0 {
		width := r.forcedWidth
		if width > 0 {
			width--
		}
		return width, r.forcedHeight
	}
	if file, ok := r.w.(*os.File); ok {
		if width, height, err := term.GetSize(int(file.Fd())); err == nil && width > 0 {
			return width - 1, height
		}
	}
	return 100, 0
}

func richPanelWidth(terminalWidth int) int {
	if terminalWidth <= 0 {
		return 100
	}
	if terminalWidth < 24 {
		return maxInt(terminalWidth, 8)
	}
	return clampInt(terminalWidth, 24, 132)
}

func richPanelHeight(terminalHeight int) int {
	if terminalHeight <= 0 {
		return 0
	}
	if terminalHeight <= 11 {
		return maxInt(terminalHeight-1, 5)
	}
	return clampInt(terminalHeight-1, 10, 40)
}

func richScenarioForEvent(event Event) richScenario {
	switch event.Kind {
	case EventReady:
		return richScenarioReady
	case EventWarning:
		return richScenarioWarning
	case EventFailure:
		return richScenarioError
	default:
		return richScenarioStartup
	}
}

func richTwoColumnRow(width int, left []string, right []string) string {
	leftWidth := width*58/100 - 2
	rightWidth := width - leftWidth - 7
	if rightWidth < 34 {
		rightWidth = 34
		leftWidth = width - rightWidth - 7
	}
	height := maxInt(len(left), len(right))
	var b strings.Builder
	for i := 0; i < height; i++ {
		l, rr := "", ""
		if i < len(left) {
			l = left[i]
		}
		if i < len(right) {
			rr = right[i]
		}
		b.WriteString("│ ")
		b.WriteString(richPadVisible(l, leftWidth))
		b.WriteString(" │ ")
		b.WriteString(richPadVisible(rr, rightWidth))
		b.WriteString(" │\n")
	}
	return b.String()
}

func richPlainRows(width int, lines []string) string {
	var b strings.Builder
	for _, line := range lines {
		b.WriteString("│ ")
		b.WriteString(richPadVisible(line, width-4))
		b.WriteString(" │\n")
	}
	return b.String()
}

func richJoinTitle(left string, right string, width int) string {
	width = maxInt(width, 1)
	if richVisibleLen(left)+richVisibleLen(right)+1 > width {
		right = richTruncateVisible(right, maxInt(width-richVisibleLen(left)-1, 1))
	}
	spacer := maxInt(width-richVisibleLen(left)-richVisibleLen(right), 1)
	return left + strings.Repeat(" ", spacer) + right
}

func richLine(width int, left string, right string, fillChar string) string {
	width = maxInt(width, 2)
	return left + strings.Repeat(fillChar, width-2) + right + "\n"
}

func richFitLines(lines []string, width int) []string {
	out := make([]string, len(lines))
	for i, line := range lines {
		out[i] = richTruncateVisible(line, width)
	}
	return out
}

func richTruncateVisible(text string, width int) string {
	if richVisibleLen(text) <= width {
		return text
	}
	plain := richStripANSI(text)
	if width <= 1 {
		return "…"
	}
	runes := []rune(plain)
	if len(runes) <= width {
		return plain
	}
	return string(runes[:width-1]) + "…"
}

func richWrapVisible(text string, width int) []string {
	width = maxInt(width, 1)
	if richVisibleLen(text) <= width {
		return []string{text}
	}
	plain := richStripANSI(text)
	words := strings.Fields(plain)
	if len(words) == 0 {
		return []string{""}
	}
	out := make([]string, 0, 2)
	line := words[0]
	if len([]rune(line)) > width {
		chunks := richWrapTokenAware(line, width)
		out = append(out, chunks[:len(chunks)-1]...)
		line = chunks[len(chunks)-1]
	}
	for _, word := range words[1:] {
		if len([]rune(word)) > width {
			if strings.TrimSpace(line) != "" {
				out = append(out, line)
			}
			chunks := richWrapTokenAware(word, width)
			out = append(out, chunks[:len(chunks)-1]...)
			line = chunks[len(chunks)-1]
			continue
		}
		if len([]rune(line))+1+len([]rune(word)) > width {
			out = append(out, line)
			line = word
			continue
		}
		line += " " + word
	}
	out = append(out, line)
	return out
}

func richWrapTokenAware(text string, width int) []string {
	if width <= 8 {
		return []string{richTruncateVisible(text, maxInt(width, 1))}
	}
	if richVisibleLen(text) <= width {
		return []string{text}
	}
	out := make([]string, 0, 2)
	remaining := []rune(richStripANSI(text))
	for len(remaining) > width {
		breakAt := width
		for i := width; i > width-18 && i > 0; i-- {
			if remaining[i-1] == '/' || remaining[i-1] == '-' || remaining[i-1] == '_' || remaining[i-1] == '.' {
				breakAt = i
				break
			}
		}
		out = append(out, string(remaining[:breakAt]))
		remaining = remaining[breakAt:]
	}
	if len(remaining) > 0 {
		out = append(out, string(remaining))
	}
	return out
}

func richPadVisible(text string, width int) string {
	length := richVisibleLen(text)
	if length >= width {
		return richTruncateVisible(text, width)
	}
	return text + strings.Repeat(" ", width-length)
}

func richPadPlain(text string, width int) string {
	length := len([]rune(text))
	if length >= width {
		return text
	}
	return text + strings.Repeat(" ", width-length)
}

func richVisibleLen(text string) int {
	return len([]rune(richStripANSI(text)))
}

func richVisibleLineCount(text string) int {
	if text == "" {
		return 0
	}
	return strings.Count(text, "\n")
}

func richStripANSI(text string) string {
	var b strings.Builder
	inEscape := false
	for i := 0; i < len(text); i++ {
		ch := text[i]
		if inEscape {
			if (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') {
				inEscape = false
			}
			continue
		}
		if ch == 0x1b {
			inEscape = true
			continue
		}
		b.WriteByte(ch)
	}
	return b.String()
}

func maxVisibleWidth(lines []string) int {
	width := 0
	for _, line := range lines {
		width = maxInt(width, richVisibleLen(line))
	}
	return width
}

func richReset(enabled bool) string {
	if !enabled {
		return ""
	}
	return ansiReset
}

func clampInt(value int, low int, high int) int {
	if value < low {
		return low
	}
	if value > high {
		return high
	}
	return value
}

func maxInt(a int, b int) int {
	if a > b {
		return a
	}
	return b
}

func minInt(a int, b int) int {
	if a < b {
		return a
	}
	return b
}
