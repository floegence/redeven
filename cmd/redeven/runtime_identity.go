package main

import (
	"crypto/rand"
	"encoding/base32"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/runtimeidentity"
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

func currentExecutablePathForCLI() (string, error) {
	return runtimeidentity.CurrentExecutablePath()
}
