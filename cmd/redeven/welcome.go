package main

import (
	"fmt"
	"io"
	"net/url"
	"os"
	"strings"

	"github.com/floegence/redeven/internal/localui"
	"golang.org/x/term"
)

// ANSI color codes for terminal styling.
const (
	ansiReset     = "\033[0m"
	ansiBold      = "\033[1m"
	ansiCyan      = "\033[96m" // bright cyan (light blue)
	ansiUnderline = "\033[4m"
)

type welcomeBannerOptions struct {
	Version             string
	ControlplaneBaseURL string
	EnvironmentID       string
	LocalUIEnabled      bool
	LocalUIBind         string
	LocalUIURLs         []string
}

func printWelcomeBanner(w io.Writer, opts welcomeBannerOptions) {
	width := terminalWidth(w)
	useANSI := isTerminalWriter(w)

	logo := []string{
		"    ██████         ██████    ",
		"    ██████         ██████    ",
		"   ██             ██   ",
		"████████████████████████████  ",
		"████████████████████████████  ",
		"████                    ████  ",
		"████  ████████          ████  ",
		"████                    ████  ",
		"████  ██████████████    ████  ",
		"████                    ████  ",
		"████████████████████████████  ",
		"████████████████████████████  ",
	}

	fmt.Fprintln(w)
	for _, line := range logo {
		fmt.Fprintln(w, center(line, width))
	}
	fmt.Fprintln(w)

	if version := strings.TrimSpace(opts.Version); version != "" {
		fmt.Fprintln(w, center(fmt.Sprintf("Version: %s", version), width))
	}

	if envURL := buildEnvAccessURL(opts.ControlplaneBaseURL, opts.EnvironmentID); envURL != "" {
		line := fmt.Sprintf("URL: %s", styleURL(envURL, useANSI))
		fmt.Fprintln(w, centerWithAnsi(line, width))
	}
	if opts.LocalUIEnabled {
		bind := strings.TrimSpace(opts.LocalUIBind)
		if bind == "" {
			bind = localui.DefaultBind
		}
		fmt.Fprintln(w, center(fmt.Sprintf("Local Bind: %s", bind), width))
		for _, localURL := range opts.LocalUIURLs {
			line := fmt.Sprintf("Local URL: %s", styleURL(localURL, useANSI))
			fmt.Fprintln(w, centerWithAnsi(line, width))
		}
	}
	fmt.Fprintln(w)
}

func buildEnvAccessURL(controlplaneBaseURL string, envPublicID string) string {
	controlplaneBaseURL = strings.TrimSpace(controlplaneBaseURL)
	envPublicID = strings.TrimSpace(envPublicID)
	if controlplaneBaseURL == "" || envPublicID == "" {
		return ""
	}

	u, err := url.Parse(controlplaneBaseURL)
	if err != nil || strings.TrimSpace(u.Scheme) == "" || strings.TrimSpace(u.Host) == "" {
		return ""
	}

	// The environment page is served from the control plane origin at /env/:envPublicID.
	return (&url.URL{
		Scheme: u.Scheme,
		Host:   u.Host,
		Path:   "/env/" + envPublicID,
	}).String()
}

func isTerminalWriter(w io.Writer) bool {
	f, ok := w.(*os.File)
	if !ok {
		return false
	}
	return term.IsTerminal(int(f.Fd()))
}

func terminalWidth(w io.Writer) int {
	f, ok := w.(*os.File)
	if !ok {
		return 0
	}
	width, _, err := term.GetSize(int(f.Fd()))
	if err != nil || width <= 0 {
		return 0
	}
	return width
}

func styleURL(url string, enabled bool) string {
	if !enabled {
		return url
	}
	return fmt.Sprintf("%s%s%s%s", ansiCyan, ansiUnderline, url, ansiReset)
}

func center(text string, width int) string {
	if width <= 0 {
		// Fallback for non-interactive outputs.
		return "                    " + text
	}

	textLen := len([]rune(text))
	if textLen >= width {
		return text
	}

	padding := (width - textLen) / 2
	return strings.Repeat(" ", padding) + text
}

func stripAnsi(s string) string {
	result := s
	result = strings.ReplaceAll(result, ansiReset, "")
	result = strings.ReplaceAll(result, ansiBold, "")
	result = strings.ReplaceAll(result, ansiCyan, "")
	result = strings.ReplaceAll(result, ansiUnderline, "")
	return result
}

func centerWithAnsi(text string, width int) string {
	if width <= 0 {
		return "                    " + text
	}

	visibleText := stripAnsi(text)
	textLen := len([]rune(visibleText))
	if textLen >= width {
		return text
	}

	padding := (width - textLen) / 2
	return strings.Repeat(" ", padding) + text
}
