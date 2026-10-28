//go:build !linux && !darwin

package environmentcenter

import "net"

func authorizedPeer(net.Conn) bool     { return false }
func connectorPeer(net.Conn, int) bool { return false }
