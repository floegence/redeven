package codeserver

import (
	"context"
	"net"
	"os"
	"os/exec"
	"testing"
)

func TestNativeInstanceConnectionAdmission(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	instance := &Instance{lifetime: ctx, nativeConnections: make(chan struct{}, 64)}
	releases := make([]func(), 0, 64)
	for range 64 {
		release, ok := instance.AdmitNativeConnection()
		if !ok {
			t.Fatal("connection rejected below the shared instance limit")
		}
		releases = append(releases, release)
	}
	if _, ok := instance.AdmitNativeConnection(); ok {
		t.Fatal("instance admitted more than 64 connections")
	}
	releases[0]()
	releases[0]()
	replacement, ok := instance.AdmitNativeConnection()
	if !ok {
		t.Fatal("closed connection did not release capacity")
	}
	cancel()
	if _, ok := instance.AdmitNativeConnection(); ok {
		t.Fatal("closed instance admitted a connection")
	}
	replacement()
	for _, release := range releases {
		release()
	}
	if len(instance.nativeConnections) != 0 {
		t.Fatal("instance retained released connections")
	}
}

func TestRunnerDoesNotResolveExitedInstanceAtReusedPort(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	process, err := os.FindProcess(os.Getpid())
	if err != nil {
		t.Fatal(err)
	}
	runner := NewRunner(RunnerOptions{})
	runner.instances["demo"] = &Instance{CodeSpaceID: "demo", Port: listener.Addr().(*net.TCPAddr).Port, lifetime: ctx, cmd: &exec.Cmd{Process: process}}
	if _, found := runner.Get("demo"); found {
		t.Fatal("a listening port resurrected an exited editor generation")
	}
}
