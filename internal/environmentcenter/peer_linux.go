package environmentcenter

import (
	"golang.org/x/sys/unix"
	"net"
	"os"
)

func authorizedPeer(conn net.Conn) bool {
	return connectorPeer(conn, os.Geteuid()) || connectorPeer(conn, 0)
}
func connectorPeer(conn net.Conn, uid int) bool {
	socket, ok := conn.(*net.UnixConn)
	if !ok {
		return false
	}
	raw, err := socket.SyscallConn()
	if err != nil {
		return false
	}
	allowed := false
	err = raw.Control(func(fd uintptr) {
		cred, e := unix.GetsockoptUcred(int(fd), unix.SOL_SOCKET, unix.SO_PEERCRED)
		allowed = e == nil && cred.Uid == uint32(uid)
	})
	return err == nil && allowed
}
