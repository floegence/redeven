package hostapps

import (
	"context"
	"encoding/json"
	nativeapps "github.com/floegence/floe-native-apps"
	"github.com/floegence/redeven/internal/remotedesktop"
)

// OpenDesktop shares the existing Runtime capture process while assigning a
// separate opaque desktop channel. Application admission remains unchanged.
func (m *Manager) OpenDesktop(ctx context.Context) (remotedesktop.Transport, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	client, err := m.openMacClient()
	if err != nil {
		return nil, err
	}
	t := &desktopTransport{client: client, control: make(chan nativeapps.HostDesktopMessage, 32)}
	go func() {
		scanner := macScanner(client)
		for scanner.Scan() {
			var message nativeapps.HostDesktopMessage
			if json.Unmarshal(scanner.Bytes(), &message) != nil || message.Version != 1 {
				break
			}
			select {
			case t.control <- message:
			case <-client.done:
				return
			}
		}
		_ = client.Close()
	}()
	return t, nil
}

type desktopTransport struct {
	client  *macHostClient
	control chan nativeapps.HostDesktopMessage
}

func (t *desktopTransport) Send(command nativeapps.HostDesktopCommand, takeover bool) error {
	if !command.Valid() {
		return nativeapps.ErrInvalid
	}
	return t.client.host.send(t.client.id, map[string]any{"action": "desktop", "command": command, "takeover": takeover})
}
func (t *desktopTransport) Control() <-chan nativeapps.HostDesktopMessage { return t.control }
func (t *desktopTransport) Media() <-chan nativeapps.HostDesktopMessage   { return t.client.media }
func (t *desktopTransport) Done() <-chan struct{}                         { return t.client.done }
func (t *desktopTransport) Close() error                                  { return t.client.Close() }
