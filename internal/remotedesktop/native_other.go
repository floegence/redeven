//go:build !linux

package remotedesktop

import "context"

func (m *Manager) openLinux(context.Context) (Transport, error) { return nil, ErrUnavailable }
