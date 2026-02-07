package codeapp

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

const codeServerPWASWSuffix = "/out/browser/serviceWorker.js"

type localEntryProxyManager struct {
	log *slog.Logger

	mu      sync.Mutex
	entries map[string]*localEntryProxyEntry
}

type localEntryProxyEntry struct {
	codeSpaceID string
	backendPort int
	entryPort   int

	ln  net.Listener
	srv *http.Server
}

func newLocalEntryProxyManager(logger *slog.Logger) *localEntryProxyManager {
	if logger == nil {
		logger = slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	}
	return &localEntryProxyManager{
		log:     logger,
		entries: make(map[string]*localEntryProxyEntry),
	}
}

func (m *localEntryProxyManager) Ensure(ctx context.Context, codeSpaceID string, backendPort int) (int, error) {
	if m == nil {
		return 0, errors.New("entry proxy manager not ready")
	}
	id := strings.TrimSpace(codeSpaceID)
	if !IsValidCodeSpaceID(id) {
		return 0, errors.New("invalid code_space_id")
	}
	if backendPort <= 0 || backendPort > 65535 {
		return 0, errors.New("invalid backend port")
	}
	if ctx == nil {
		ctx = context.Background()
	}

	var toClose *localEntryProxyEntry

	m.mu.Lock()
	if cur := m.entries[id]; cur != nil {
		if cur.backendPort == backendPort {
			port := cur.entryPort
			m.mu.Unlock()
			return port, nil
		}
		toClose = cur
		delete(m.entries, id)
	}
	m.mu.Unlock()

	if toClose != nil {
		_ = closeLocalEntryProxyEntry(ctx, toClose)
	}

	entry, err := m.newEntry(id, backendPort)
	if err != nil {
		return 0, err
	}

	m.mu.Lock()
	if cur := m.entries[id]; cur != nil {
		m.mu.Unlock()
		_ = closeLocalEntryProxyEntry(ctx, entry)
		return cur.entryPort, nil
	}
	m.entries[id] = entry
	m.mu.Unlock()

	go m.serveEntry(entry)

	return entry.entryPort, nil
}

func (m *localEntryProxyManager) Port(codeSpaceID string) (int, bool) {
	if m == nil {
		return 0, false
	}
	id := strings.TrimSpace(codeSpaceID)
	if id == "" {
		return 0, false
	}
	m.mu.Lock()
	entry := m.entries[id]
	m.mu.Unlock()
	if entry == nil {
		return 0, false
	}
	return entry.entryPort, true
}

func (m *localEntryProxyManager) Stop(codeSpaceID string) error {
	if m == nil {
		return nil
	}
	id := strings.TrimSpace(codeSpaceID)
	if id == "" {
		return nil
	}

	m.mu.Lock()
	entry := m.entries[id]
	delete(m.entries, id)
	m.mu.Unlock()

	return closeLocalEntryProxyEntry(context.Background(), entry)
}

func (m *localEntryProxyManager) StopAll() error {
	if m == nil {
		return nil
	}

	m.mu.Lock()
	entries := make([]*localEntryProxyEntry, 0, len(m.entries))
	for id, entry := range m.entries {
		if entry != nil {
			entries = append(entries, entry)
		}
		delete(m.entries, id)
	}
	m.mu.Unlock()

	var firstErr error
	for _, entry := range entries {
		if err := closeLocalEntryProxyEntry(context.Background(), entry); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

func (m *localEntryProxyManager) newEntry(codeSpaceID string, backendPort int) (*localEntryProxyEntry, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	tcpAddr, ok := ln.Addr().(*net.TCPAddr)
	if !ok || tcpAddr == nil || tcpAddr.Port <= 0 {
		_ = ln.Close()
		return nil, errors.New("invalid entry listener address")
	}
	entryPort := tcpAddr.Port

	target := &url.URL{Scheme: "http", Host: fmt.Sprintf("127.0.0.1:%d", backendPort)}

	proxy := &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(target)

			originHost := strings.TrimSpace(pr.In.Host)
			if originHost == "" {
				originHost = fmt.Sprintf("127.0.0.1:%d", entryPort)
			}
			origin := "http://" + originHost

			pr.Out.Host = originHost
			pr.Out.Header.Set("Origin", origin)

			pr.Out.Header.Del("Forwarded")
			pr.Out.Header.Del("X-Forwarded-Host")
			pr.Out.Header.Del("X-Forwarded-Proto")
			pr.Out.Header.Del("X-Forwarded-For")
			pr.Out.Header.Del("X-Forwarded-Port")
		},
		ModifyResponse: func(resp *http.Response) error {
			if resp == nil || resp.Request == nil || resp.Request.URL == nil {
				return nil
			}
			if isCodeServerPWAScriptPath(resp.Request.URL.Path) {
				resp.Header.Del("Service-Worker-Allowed")
			}
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			http.Error(w, "upstream unavailable", http.StatusBadGateway)
		},
	}

	srv := &http.Server{
		Handler:           proxy,
		ReadHeaderTimeout: 10 * time.Second,
	}

	return &localEntryProxyEntry{
		codeSpaceID: codeSpaceID,
		backendPort: backendPort,
		entryPort:   entryPort,
		ln:          ln,
		srv:         srv,
	}, nil
}

func (m *localEntryProxyManager) serveEntry(entry *localEntryProxyEntry) {
	if m == nil || entry == nil || entry.srv == nil || entry.ln == nil {
		return
	}

	err := entry.srv.Serve(entry.ln)
	if err != nil && !errors.Is(err, http.ErrServerClosed) {
		m.log.Warn("local entry proxy stopped unexpectedly", "code_space_id", entry.codeSpaceID, "entry_port", entry.entryPort, "error", err)
	}

	m.mu.Lock()
	if cur := m.entries[entry.codeSpaceID]; cur == entry {
		delete(m.entries, entry.codeSpaceID)
	}
	m.mu.Unlock()
}

func closeLocalEntryProxyEntry(ctx context.Context, entry *localEntryProxyEntry) error {
	if entry == nil {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}

	shutdownCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()

	var shutdownErr error
	if entry.srv != nil {
		shutdownErr = entry.srv.Shutdown(shutdownCtx)
		if errors.Is(shutdownErr, http.ErrServerClosed) {
			shutdownErr = nil
		}
	}
	if entry.ln != nil {
		_ = entry.ln.Close()
	}
	return shutdownErr
}

func isCodeServerPWAScriptPath(path string) bool {
	p := strings.TrimSpace(path)
	if p == "" {
		return false
	}
	return strings.HasSuffix(p, codeServerPWASWSuffix)
}
