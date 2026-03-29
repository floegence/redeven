package codeserver

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

// ResolveBinary resolves the selected code-server binary path for the current
// machine and validates that it matches the supported version.
func ResolveBinary(stateDir string) (string, error) {
	detection := detectRuntime(context.Background(), stateDir, SupportedVersion)
	switch detection.state {
	case RuntimeDetectionReady:
		return detection.binaryPath, nil
	case RuntimeDetectionIncompatible:
		if detection.installedVersion != "" {
			return "", fmt.Errorf("unsupported code-server version %s (supported: %s)", detection.installedVersion, SupportedVersion)
		}
		if msg := strings.TrimSpace(detection.errorMessage); msg != "" {
			return "", errors.New(msg)
		}
		return "", errors.New("code-server binary is present but unusable")
	default:
		return "", errors.New("code-server binary not found; install it from Codespaces or set REDEVEN_CODE_SERVER_BIN")
	}
}
