package remotedesktop

import (
	"context"
	nativeapps "github.com/floegence/floe-native-apps"
)

// ForgetAuthorization clears only SDK-owned credentials. The native start lock
// serializes this operation with all other processes using the same state root.
func (m *Manager) ForgetAuthorization(ctx context.Context) error {
	m.mu.Lock()
	if m.closed || m.factory == nil {
		m.mu.Unlock()
		return ErrUnavailable
	}
	factory := m.factory
	m.mu.Unlock()
	connection, err := factory(ctx)
	if err != nil {
		return err
	}
	defer connection.Close()
	if err = connection.Send(nativeapps.HostDesktopCommand{Version: 1, ID: 1, Method: "forget_authorization"}, false); err != nil {
		return err
	}
	select {
	case message := <-connection.Control():
		if message.Type == "result" && message.ID == 1 {
			return nil
		}
		if message.Code == "AUTHORIZATION_PENDING" {
			return ErrAuthorizationBusy
		}
		return ErrUnavailable
	case <-connection.Done():
		return ErrUnavailable
	case <-ctx.Done():
		return ctx.Err()
	}
}
