package main

import (
	"fmt"
	"io"
	"net/url"
	"strings"
)

const defaultLocalUIPort = 23998

type welcomeBannerOptions struct {
	Version             string
	ControlplaneBaseURL string
	EnvironmentID       string
	LocalUIEnabled      bool
}

func printWelcomeBanner(w io.Writer, opts welcomeBannerOptions) {
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
		fmt.Fprintln(w, line)
	}
	fmt.Fprintln(w)

	if version := strings.TrimSpace(opts.Version); version != "" {
		fmt.Fprintf(w, "Version: %s\n", version)
	}

	if envURL := buildEnvAccessURL(opts.ControlplaneBaseURL, opts.EnvironmentID); envURL != "" {
		fmt.Fprintf(w, "URL: %s\n", envURL)
	}
	if opts.LocalUIEnabled {
		fmt.Fprintf(w, "Local URL: http://localhost:%d/\n", defaultLocalUIPort)
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

	// The Region Portal is served at the controlplane origin; /env/:envPublicID opens the environment page.
	return (&url.URL{
		Scheme: u.Scheme,
		Host:   u.Host,
		Path:   "/env/" + envPublicID,
	}).String()
}
