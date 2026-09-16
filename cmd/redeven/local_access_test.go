package main

import (
	"bytes"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/accessgate"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/lockfile"
)

func TestLocalAuthorityAccessPersistsOnlyServerPasswordHash(t *testing.T) {
	root := t.TempDir()
	var stdout, stderr bytes.Buffer
	c := &cli{stdin: strings.NewReader(`{"local_ui_bind":"0.0.0.0:23998","local_ui_protocol":"http","local_ui_password_mode":"replace","local_ui_password":"shared-secret"}`), stdout: &stdout, stderr: &stderr}
	if code := c.localAuthorityCmd([]string{"access", "set", "--state-root", root}); code != 0 {
		t.Fatalf("set: %d %s", code, &stderr)
	}
	if strings.Contains(stdout.String(), "shared-secret") {
		t.Fatal("password leaked")
	}
	layout, err := config.LocalEnvironmentStateLayout(root)
	if err != nil {
		t.Fatal(err)
	}
	hash, err := accessgate.ReadPasswordHash(layout.StateDir)
	if err != nil {
		t.Fatal(err)
	}
	gate, err := accessgate.NewWithPasswordHash(hash)
	if err != nil || !gate.VerifyPassword("shared-secret") {
		t.Fatal("independent restart credential unavailable")
	}
	lock, err := lockfile.Acquire(layout.LockPath)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = lock.Release() }()
	c.stdin = strings.NewReader(`{"local_ui_bind":"localhost:23998","local_ui_protocol":"http","local_ui_password_mode":"clear","local_ui_password":""}`)
	if code := c.localAuthorityCmd([]string{"access", "set", "--state-root", root}); code != 1 {
		t.Fatalf("running Runtime settings replaced: %d", code)
	}
	stored, err := config.ReadEnvironmentCatalogAccess(layout)
	if err != nil || !stored.LocalUIPasswordConfigured || stored.LocalUIBind != "0.0.0.0:23998" {
		t.Fatalf("blocked write changed config: %+v %v", stored, err)
	}
}

func TestLocalAuthorityAccessReportsRejectedSettings(t *testing.T) {
	root := t.TempDir()
	var stdout, stderr bytes.Buffer
	c := &cli{stdin: strings.NewReader(`{"local_ui_bind":"0.0.0.0:23998","local_ui_protocol":"http","local_ui_password_mode":"keep"}`), stdout: &stdout, stderr: &stderr}
	if code := c.localAuthorityCmd([]string{"access", "set", "--state-root", root}); code != 1 {
		t.Fatalf("rejected settings returned exit code %d; stdout=%q stderr=%q", code, &stdout, &stderr)
	}
	if stdout.Len() != 0 || !strings.Contains(stderr.String(), "network access requires an environment password") {
		t.Fatalf("expected actionable save failure; stdout=%q stderr=%q", &stdout, &stderr)
	}
	layout, err := config.LocalEnvironmentStateLayout(root)
	if err != nil {
		t.Fatal(err)
	}
	stored, err := config.ReadEnvironmentCatalogAccess(layout)
	if err != nil || stored != nil {
		t.Fatalf("rejected settings persisted: %+v %v", stored, err)
	}
}
