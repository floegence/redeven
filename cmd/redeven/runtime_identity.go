package main

import (
	"crypto/rand"
	"encoding/base32"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func newRuntimeInstanceID() (string, error) {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	return "rt_" + strings.ToLower(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(raw[:])), nil
}

func timeNowUnixMS() int64 {
	return time.Now().UnixMilli()
}

func currentExecutablePathForCLI() string {
	exePath, err := os.Executable()
	if err != nil {
		return ""
	}
	exePath = strings.TrimSpace(exePath)
	if exePath == "" {
		return ""
	}
	if abs, absErr := filepath.Abs(exePath); absErr == nil && strings.TrimSpace(abs) != "" {
		exePath = abs
	}
	return filepath.Clean(exePath)
}
