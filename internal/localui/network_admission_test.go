package localui

import (
	"crypto/tls"
	"crypto/x509"
	"net/http"
	"testing"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
)

func TestHTTPSWebSocketRejectsUnknownHostBeforeUpgrade(t *testing.T) {
	s := newDesktopBridgeTestServer(t, nil)
	roots := x509.NewCertPool()
	roots.AddCert(s.deviceCA.certificate)
	client := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{
		MinVersion: tls.VersionTLS13, RootCAs: roots,
	}}, Timeout: 5 * time.Second}
	defer client.CloseIdleConnections()
	base := "https://" + s.listeners[0].Addr().String()
	for _, path := range []string{flowersec.WebSocketDirectPath, flowersec.WebSocketTunnelPath} {
		assertWebSocketAdmission(t, client, base, "attacker.example:23998", base, path, http.StatusForbidden)
	}
}
