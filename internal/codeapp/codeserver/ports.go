package codeserver

import (
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"net"
	"strconv"
	"time"
)

func pickFreePortInRange(min int, max int) (int, error) {
	if min <= 0 || max <= 0 || min > max || max > 65535 {
		return 0, errors.New("invalid port range")
	}
	n := max - min + 1
	start := 0
	if r, err := rand.Int(rand.Reader, big.NewInt(int64(n))); err == nil {
		start = int(r.Int64())
	}
	for i := 0; i < n; i++ {
		p := min + ((start + i) % n)
		if isPortFree(p) {
			return p, nil
		}
	}
	return 0, fmt.Errorf("no free port in range %s-%s", strconv.Itoa(min), strconv.Itoa(max))
}

func isPortFree(port int) bool {
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return false
	}
	_ = ln.Close()
	return true
}

func isPortListening(port int) bool {
	c, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 500*time.Millisecond)
	if err != nil {
		return false
	}
	_ = c.Close()
	return true
}
