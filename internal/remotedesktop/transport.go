package remotedesktop

import (
	"context"
	nativeapps "github.com/floegence/floe-native-apps"
)

// Transport is a private native attachment. Control and media have independent
// readers; Close releases held input and capture without closing host programs.
type Transport interface {
	Send(nativeapps.HostDesktopCommand, bool) error
	Control() <-chan nativeapps.HostDesktopMessage
	Media() <-chan nativeapps.HostDesktopMessage
	Done() <-chan struct{}
	Close() error
}

type Factory func(context.Context) (Transport, error)
