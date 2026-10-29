package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"os/user"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	"github.com/floegence/redeven/internal/environmentcenter"
)

// Build identity is injected by scripts/build_center.sh.
var (
	Version   = "dev"
	Commit    = "unknown"
	BuildTime = "unknown"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func run(args []string) error {
	return runWithOutput(args, os.Stdout)
}

func runWithOutput(args []string, output io.Writer) error {
	if len(args) > 0 && (args[0] == "version" || args[0] == "--version") {
		if len(args) != 1 {
			return errors.New("version accepts no arguments")
		}
		return json.NewEncoder(output).Encode(struct {
			Version   string `json:"version"`
			Commit    string `json:"commit"`
			BuildTime string `json:"build_time"`
		}{Version, Commit, BuildTime})
	}
	command := "serve"
	if len(args) > 0 && len(args[0]) > 0 && args[0][0] != '-' {
		command = args[0]
		args = args[1:]
	}
	flags := flag.NewFlagSet("redeven-center "+command, flag.ContinueOnError)
	state := flags.String("state-root", "", "Private Center state directory (required)")
	origin := flags.String("origin", "", "Exact HTTPS portal origin")
	listen := flags.String("listen", "127.0.0.1:8443", "TLS listening address")
	cert := flags.String("tls-cert", "", "TLS certificate PEM covering portal and environment origins")
	key := flags.String("tls-key", "", "TLS private key PEM")
	offline := flags.Bool("offline", false, "Recover a stopped Center while holding its exclusive state lock")
	assets := flags.String("assets", "", "Built Center UI directory")
	connector := flags.String("connector-socket", "", "Required isolated Connector Unix socket")
	connectorUser := flags.String("connector-user", "", "Expected Connector OS user")
	centerUser := flags.String("center-user", "", "Exact Center OS user for Connector peer authentication")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if command == "connector" {
		if *connector == "" || *centerUser == "" {
			return errors.New("connector requires --connector-socket and --center-user")
		}
		identity, err := user.Lookup(*centerUser)
		if err != nil {
			identity, err = user.LookupId(*centerUser)
		}
		if err != nil {
			return err
		}
		uid, err := strconv.Atoi(identity.Uid)
		if err != nil {
			return err
		}
		ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer cancel()
		return environmentcenter.ServeConnector(ctx, *connector, uid)
	}
	if *state == "" {
		return errors.New("--state-root is required")
	}
	if command == "setup" || command == "recover" {
		if *offline {
			if command != "recover" || *origin == "" {
				return fmt.Errorf("offline recovery requires recover --offline --origin")
			}
			c, err := environmentcenter.Open(*state, *origin)
			if err != nil {
				return err
			}
			defer c.Close()
			token, err := c.OwnerBootstrap(true)
			if err != nil {
				return err
			}
			fmt.Fprintln(os.Stdout, token)
			return nil
		}
		return owner(*state, command)
	}
	if command != "serve" {
		return errors.New("use serve, connector, setup, recover, or version")
	}
	if *origin == "" || *cert == "" || *key == "" || *assets == "" || !filepath.IsAbs(*connector) || *connectorUser == "" {
		return errors.New("serve requires --origin, --tls-cert, --tls-key, --assets, --connector-user and an absolute --connector-socket")
	}
	workerIdentity, err := user.Lookup(*connectorUser)
	if err != nil {
		workerIdentity, err = user.LookupId(*connectorUser)
	}
	if err != nil {
		return err
	}
	workerUID, err := strconv.Atoi(workerIdentity.Uid)
	if err != nil {
		return err
	}
	if _, err := os.Stat(filepath.Join(*assets, "index.html")); err != nil {
		return errors.New("build Center UI assets before starting")
	}
	certificate, err := tls.LoadX509KeyPair(*cert, *key)
	if err != nil {
		return fmt.Errorf("load Center TLS identity: %w", err)
	}
	leaf, err := x509.ParseCertificate(certificate.Certificate[0])
	if err != nil {
		return err
	}
	portal, err := url.Parse(*origin)
	if err != nil || portal.Hostname() == "" {
		return fmt.Errorf("invalid Center origin")
	}
	if err = leaf.VerifyHostname(portal.Hostname()); err != nil {
		return fmt.Errorf("TLS certificate does not cover Center origin: %w", err)
	}
	if time.Now().Before(leaf.NotBefore) || !time.Now().Before(leaf.NotAfter) {
		return fmt.Errorf("Center TLS certificate is not currently valid")
	}
	c, err := environmentcenter.Open(*state, *origin)
	if err != nil {
		return err
	}
	defer c.Close()
	server := environmentcenter.NewServer(c, http.FileServer(http.Dir(*assets)))
	server.UseConnector(*connector, workerUID)
	defer server.Close()
	server.ValidateOriginCertificate = func(origin string) error {
		parsed, err := url.Parse(origin)
		if err != nil || leaf.VerifyHostname(parsed.Hostname()) != nil {
			return fmt.Errorf("CENTER_ORIGIN_CERTIFICATE_REQUIRED")
		}
		return nil
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	httpServer := &http.Server{Addr: *listen, Handler: server, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 64 << 10, TLSConfig: &tls.Config{Certificates: []tls.Certificate{certificate}, MinVersion: tls.VersionTLS13, NextProtos: []string{"http/1.1"}}}
	errors := make(chan error, 2)
	go func() { errors <- c.ServeOwner(ctx, *state) }()
	go func() { errors <- httpServer.ListenAndServeTLS("", "") }()
	fmt.Fprintf(os.Stderr, "Redeven Env Center listening on %s; initialize from this host with redeven-center setup --state-root %s\n", *origin, *state)
	select {
	case <-ctx.Done():
	case err = <-errors:
		cancel()
	}
	closeCtx, closeCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer closeCancel()
	_ = httpServer.Shutdown(closeCtx)
	if err == http.ErrServerClosed {
		return nil
	}
	return err
}
func owner(state, action string) error {
	transport := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", filepath.Join(state, "owner.sock"))
	}}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 10 * time.Second}
	raw, _ := json.Marshal(map[string]string{"action": action})
	response, err := client.Post("http://center-owner/owner/setup", "application/json", bytes.NewReader(raw))
	if err != nil {
		return fmt.Errorf("start Center before requesting %s: %w", action, err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 8192))
	if err != nil {
		return err
	}
	var result struct {
		OK   bool `json:"ok"`
		Data struct {
			Token string `json:"setup_token"`
		} `json:"data"`
	}
	if json.Unmarshal(body, &result) != nil || !result.OK || result.Data.Token == "" {
		return errors.New("owner action denied; check the service owner and current setup state")
	}
	// Only this explicitly invoked owner command prints the one-time secret.
	fmt.Fprintln(os.Stdout, result.Data.Token)
	return nil
}
