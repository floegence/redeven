// This opt-in fixture owns its process, editor state, workspace, and loopback ports.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/floegence/redeven/internal/codeapp/appserver"
	"github.com/floegence/redeven/internal/codeapp/codeserver"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func run() error {
	root := os.Getenv("REDEVEN_NATIVE_EDITOR_SMOKE_STATE")
	if root == "" {
		return fmt.Errorf("isolated smoke state is required")
	}
	workspace := filepath.Join(root, "workspace")
	if err := os.MkdirAll(workspace, 0700); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(workspace, "native-smoke.txt"), []byte("native editor smoke\n"), 0600); err != nil {
		return err
	}
	if err := os.Remove(filepath.Join(workspace, "native-terminal.txt")); err != nil && !os.IsNotExist(err) {
		return err
	}
	runner := codeserver.NewRunner(codeserver.RunnerOptions{StateDir: filepath.Join(root, "runtime"), StateRoot: filepath.Join(root, "runtime"), PortMin: 43000, PortMax: 49000})
	instance, err := runner.EnsureRunning("native-smoke", workspace, 0)
	if err != nil {
		return err
	}
	defer runner.StopAll()
	handler, closeHandler, err := appserver.NewNativeCodeSpaceHandler(appserver.NativeCodeSpaceBinding{CodeSpaceID: "native-smoke", InstanceID: instance.InstanceID, Port: instance.Port, WorkspacePath: workspace, Context: instance.Lifetime(), AdmitConnection: instance.AdmitNativeConnection})
	if err != nil {
		return err
	}
	defer closeHandler()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	server := &http.Server{Handler: handler}
	defer server.Close()
	go server.Serve(listener)
	ready, _ := json.Marshal(map[string]any{"port": listener.Addr().(*net.TCPAddr).Port, "editor_port": instance.Port, "editor_pid": instance.PID, "workspace": workspace, "state": root})
	fmt.Println("NATIVE_EDITOR_READY " + string(ready))
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	<-ctx.Done()
	return nil
}
