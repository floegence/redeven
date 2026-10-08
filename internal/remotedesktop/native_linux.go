package remotedesktop

import (
	"context"
	nativeapps "github.com/floegence/floe-native-apps"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"
)

type linuxTransport struct {
	input          io.WriteCloser
	command        *exec.Cmd
	control, media chan nativeapps.HostDesktopMessage
	done           chan struct{}
	closeOnce      sync.Once
	writeMu        sync.Mutex
}

func (m *Manager) openLinux(ctx context.Context) (Transport, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	status, err := m.serviceStatus(ctx)
	if status.State == nativeapps.ServiceActive && err == nil {
		return nativeapps.OpenLoginScreenSession(ctx, nativeapps.LoginServiceSocket)
	}
	if status.State != nativeapps.ServiceNotInstalled {
		return nil, ErrServiceUnavailable
	}
	return m.openLinuxUserDesktop(ctx)
}

// Current-user sharing is optional. An installed system service never falls
// back to a Portal grant when its policy, service or hardware is unavailable.
func (m *Manager) openLinuxUserDesktop(ctx context.Context) (Transport, error) {
	setup, err := m.setupManager()
	if err != nil {
		return nil, err
	}
	tools, err := setup.HostDesktopTools()
	if err != nil {
		return nil, err
	}
	state := filepath.Join(m.state, "remote-desktop", "authorization")
	if err = os.MkdirAll(state, 0700); err != nil {
		return nil, err
	}
	read, write, err := os.Pipe()
	if err != nil {
		return nil, err
	}
	command := exec.Command(tools.Python, tools.Helper, "--state", state, "--media-fd", "3")
	command.ExtraFiles = []*os.File{write}
	input, err := command.StdinPipe()
	if err != nil {
		_ = read.Close()
		_ = write.Close()
		return nil, err
	}
	output, err := command.StdoutPipe()
	if err != nil {
		_ = input.Close()
		_ = read.Close()
		_ = write.Close()
		return nil, err
	}
	if err = command.Start(); err != nil {
		_ = input.Close()
		_ = output.Close()
		_ = read.Close()
		_ = write.Close()
		return nil, err
	}
	_ = write.Close()
	t := &linuxTransport{input: input, command: command, control: make(chan nativeapps.HostDesktopMessage, 32), media: make(chan nativeapps.HostDesktopMessage, 16), done: make(chan struct{})}
	go t.read(output, t.control)
	go t.read(read, t.media)
	go func() { _ = command.Wait(); close(t.done); _ = input.Close(); _ = output.Close(); _ = read.Close() }()
	return t, nil
}
func (t *linuxTransport) read(reader io.ReadCloser, destination chan nativeapps.HostDesktopMessage) {
	defer reader.Close()
	defer t.Close()
	for {
		message, err := nativeapps.ReadHostDesktopMessage(reader)
		if err != nil {
			return
		}
		select {
		case destination <- message:
		case <-t.done:
			return
		}
	}
}
func (t *linuxTransport) Send(command nativeapps.HostDesktopCommand, _ bool) error {
	t.writeMu.Lock()
	defer t.writeMu.Unlock()
	if pipe, ok := t.input.(interface{ SetWriteDeadline(time.Time) error }); ok {
		_ = pipe.SetWriteDeadline(time.Now().Add(5 * time.Second))
	}
	return nativeapps.WriteHostDesktopCommand(t.input, command)
}
func (t *linuxTransport) Control() <-chan nativeapps.HostDesktopMessage { return t.control }
func (t *linuxTransport) Media() <-chan nativeapps.HostDesktopMessage   { return t.media }
func (t *linuxTransport) Done() <-chan struct{}                         { return t.done }
func (t *linuxTransport) Close() error {
	t.closeOnce.Do(func() {
		_ = t.input.Close()
		go func() {
			select {
			case <-t.done:
			case <-time.After(2 * time.Second):
				_ = t.command.Process.Kill()
			}
		}()
	})
	return nil
}
