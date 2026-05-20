package runtimepresentation

import (
	"fmt"
	"io"
	"os"
	"strings"

	"golang.org/x/term"
)

type Mode string

const (
	ModeAuto    Mode = "auto"
	ModeRich    Mode = "rich"
	ModePlain   Mode = "plain"
	ModeMachine Mode = "machine"
)

type ResolveInput struct {
	Stdin             io.Reader
	Stdout            io.Writer
	Stderr            io.Writer
	Env               map[string]string
	DesktopManaged    bool
	StartupReportFile string
}

type Config struct {
	Requested   Mode
	Effective   Mode
	Color       bool
	Dynamic     bool
	Interactive bool
}

func ParseMode(raw string) (Mode, error) {
	switch Mode(strings.ToLower(strings.TrimSpace(raw))) {
	case "", ModeAuto:
		return ModeAuto, nil
	case ModeRich:
		return ModeRich, nil
	case ModePlain:
		return ModePlain, nil
	case ModeMachine:
		return ModeMachine, nil
	default:
		return "", fmt.Errorf("unknown presentation mode: %s", strings.TrimSpace(raw))
	}
}

func ResolveConfig(requested Mode, in ResolveInput) Config {
	env := in.Env
	if env == nil {
		env = environMap()
	}
	stdinTTY := isTerminalReader(in.Stdin)
	stderrTTY := isTerminalWriter(in.Stderr)
	noColor := envTruthy(env["NO_COLOR"]) || strings.EqualFold(strings.TrimSpace(env["TERM"]), "dumb")
	ci := envTruthy(env["CI"])
	effective := requested
	if effective == "" || effective == ModeAuto {
		switch {
		case in.DesktopManaged || strings.TrimSpace(in.StartupReportFile) != "":
			effective = ModeMachine
		case stderrTTY && !noColor && !ci:
			effective = ModeRich
		default:
			effective = ModePlain
		}
	}
	return Config{
		Requested:   requested,
		Effective:   effective,
		Color:       effective == ModeRich && !noColor,
		Dynamic:     effective == ModeRich && stderrTTY && !noColor,
		Interactive: effective == ModeRich && stdinTTY && stderrTTY && !noColor && !ci,
	}
}

func environMap() map[string]string {
	out := make(map[string]string)
	for _, item := range os.Environ() {
		key, value, ok := strings.Cut(item, "=")
		if ok {
			out[key] = value
		}
	}
	return out
}

func envTruthy(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func isTerminalWriter(w io.Writer) bool {
	f, ok := w.(*os.File)
	if !ok {
		return false
	}
	return term.IsTerminal(int(f.Fd()))
}

func isTerminalReader(r io.Reader) bool {
	f, ok := r.(*os.File)
	if !ok {
		return false
	}
	return term.IsTerminal(int(f.Fd()))
}
