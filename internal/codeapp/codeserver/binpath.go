package codeserver

import (
	"context"
	"errors"
)

// ResolveBinary resolves the selected code-server binary path for the current
// machine and validates that it is usable.
func ResolveBinary(stateDir string) (string, error) {
	detection := detectRuntime(context.Background(), stateDir)
	switch detection.state {
	case RuntimeDetectionReady:
		return detection.binaryPath, nil
	case RuntimeDetectionUnusable:
		if msg := runtimeDetectionError(detection); msg != "" {
			return "", errors.New(msg)
		}
		return "", errors.New("code-server binary is present but unusable")
	default:
		return "", errors.New("code-server binary not found; install it from Codespaces or set REDEVEN_CODE_SERVER_BIN")
	}
}
