package runtimepresentation

import (
	"net/url"
	"strings"
)

func BuildEnvironmentURL(controlplaneBaseURL string, envPublicID string) string {
	return buildEnvironmentURL(controlplaneBaseURL, envPublicID)
}

func buildEnvironmentURL(controlplaneBaseURL string, envPublicID string) string {
	controlplaneBaseURL = strings.TrimSpace(controlplaneBaseURL)
	envPublicID = strings.TrimSpace(envPublicID)
	if controlplaneBaseURL == "" || envPublicID == "" {
		return ""
	}
	u, err := url.Parse(controlplaneBaseURL)
	if err != nil || strings.TrimSpace(u.Scheme) == "" || strings.TrimSpace(u.Host) == "" {
		return ""
	}
	return (&url.URL{
		Scheme: u.Scheme,
		Host:   u.Host,
		Path:   "/env/" + envPublicID,
	}).String()
}
