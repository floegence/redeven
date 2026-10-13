package agent

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/gatewaycloud"
	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
	"github.com/floegence/redeven/internal/periodic"
)

// This opt-in harness runs on an independent load host. All credentials come
// from real enrolled fixtures; it never seeds or substitutes an authority DB.
type capacityManifest struct {
	Scenario        string            `json:"scenario,omitempty"`
	DurationSeconds int               `json:"duration_seconds"`
	StartupRate     int               `json:"startup_rate"`
	RuntimeConfigs  []string          `json:"runtime_configs"`
	CAFile          string            `json:"ca_file,omitempty"`
	Gateways        []capacityGateway `json:"gateways,omitempty"`
	HTTP            []capacityHTTP    `json:"http,omitempty"`
	Environment     json.RawMessage   `json:"environment"`
}
type capacityGateway struct {
	Origin      string `json:"cloud_origin"`
	NamespaceID string `json:"namespace_public_id"`
	GatewayID   string `json:"gateway_public_id"`
	PrivateKey  string `json:"private_key_b64u"`
}
type capacityHTTP struct {
	Name       string            `json:"name"`
	URL        string            `json:"url"`
	Method     string            `json:"method"`
	Headers    map[string]string `json:"headers"`
	CookieFile string            `json:"cookie_file,omitempty"`
	Body       json.RawMessage   `json:"body,omitempty"`
	RPS        int               `json:"rps"`
}
type capacityHistogram struct {
	Count      atomic.Uint64
	Errors     atomic.Uint64
	OverBudget atomic.Uint64
	Buckets    [2002]atomic.Uint64
}

func (h *capacityHistogram) observeElapsed(elapsed time.Duration, err error) {
	index := min(int(elapsed/time.Millisecond), 2001)
	h.Count.Add(1)
	if err != nil {
		h.Errors.Add(1)
	}
	if elapsed > 2*time.Second {
		h.OverBudget.Add(1)
	}
	h.Buckets[index].Add(1)
}
func (h *capacityHistogram) snapshot() map[string]uint64 {
	var counts [2002]uint64
	var total uint64
	for index := range counts {
		counts[index] = h.Buckets[index].Load()
		total += counts[index]
	}
	quantile := func(percent uint64) uint64 {
		target := (total*percent + 99) / 100
		if target == 0 {
			return 0
		}
		var n uint64
		for index, count := range counts {
			n += count
			if n >= target {
				return uint64(index + 1)
			}
		}
		return 2002
	}
	return map[string]uint64{"count": h.Count.Load(), "errors": h.Errors.Load(), "over_2s": h.OverBudget.Load(), "p95_ms": quantile(95), "p99_ms": quantile(99)}
}

type capacityMetrics struct {
	Operations     sync.Map
	Steady         atomic.Bool
	Online         atomic.Int64
	EverRegistered atomic.Int64
	PeakOnline     atomic.Int64
	Disconnects    atomic.Int64
	Failures       atomic.Int64
}

func (m *capacityMetrics) histogram(name string) *capacityHistogram {
	value, _ := m.Operations.LoadOrStore(name, new(capacityHistogram))
	return value.(*capacityHistogram)
}
func (m *capacityMetrics) observe(name string, elapsed time.Duration, err error) {
	m.histogram(name).observeElapsed(elapsed, err)
	if m.Steady.Load() {
		m.histogram("steady/"+name).observeElapsed(elapsed, err)
	}
}
func (m *capacityMetrics) report() map[string]any {
	operations := map[string]any{}
	m.Operations.Range(func(key, value any) bool {
		operations[key.(string)] = value.(*capacityHistogram).snapshot()
		return true
	})
	return map[string]any{"online": m.Online.Load(), "unique_registered_clients": m.EverRegistered.Load(), "peak_online": m.PeakOnline.Load(), "observed_disconnects": m.Disconnects.Load(), "client_failures": m.Failures.Load(), "operations": operations}
}

func TestControlplaneCapacityQualification(t *testing.T) {
	manifestPath := os.Getenv("REDEVEN_CAPACITY_MANIFEST")
	if manifestPath == "" {
		t.Skip("independent capacity qualification requires enrolled fixtures")
	}
	raw, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	var manifest capacityManifest
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatal("invalid capacity manifest")
	}
	if manifest.Scenario == "" {
		manifest.Scenario = "steady"
	}
	if manifest.Scenario != "steady" && manifest.Scenario != "recovery" {
		t.Fatal("invalid qualification scenario")
	}
	if manifest.DurationSeconds < 1 || manifest.StartupRate < 1 || manifest.StartupRate > 200 || len(manifest.RuntimeConfigs) == 0 {
		t.Fatal("invalid capacity dimensions")
	}
	output := os.Getenv("REDEVEN_CAPACITY_OUTPUT")
	if output == "" {
		t.Fatal("REDEVEN_CAPACITY_OUTPUT is required")
	}
	if err := os.MkdirAll(output, 0700); err != nil {
		t.Fatal(err)
	}
	roots, err := capacityRoots(manifest.CAFile)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	metrics := &capacityMetrics{}
	var wg sync.WaitGroup
	agents := make([]*Agent, 0, len(manifest.RuntimeConfigs))
	defer func() {
		cancel()
		for _, a := range agents {
			a.stopControlChannel()
		}
		wg.Wait()
	}()
	snapshots, err := os.OpenFile(filepath.Join(output, "samples.jsonl"), os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer snapshots.Close()
	startupAt := time.Now()
	seen := map[string]bool{}
	// Startup is bounded by the same global admission rate as the real edge.
	ramp := time.NewTicker(time.Second / time.Duration(manifest.StartupRate))
	defer ramp.Stop()
	for index, path := range manifest.RuntimeConfigs {
		if !filepath.IsAbs(path) {
			path = filepath.Join(filepath.Dir(manifestPath), path)
		}
		cfg, err := config.Load(path)
		if err != nil || cfg.ValidateRemoteStrict() != nil || cfg.CloudAssociation == nil {
			t.Fatalf("invalid runtime fixture %d", index)
		}
		if seen[cfg.LocalEnvironmentPublicID] {
			t.Fatalf("duplicate runtime identity at fixture %d", index)
		}
		seen[cfg.LocalEnvironmentPublicID] = true
		home := filepath.Join(output, "clients", cfg.LocalEnvironmentPublicID)
		if err := os.MkdirAll(home, 0700); err != nil {
			t.Fatal(err)
		}
		configPath := filepath.Join(home, "config.json")
		if err := config.Save(configPath, cfg); err != nil {
			t.Fatal(err)
		}
		a := &Agent{cfg: cfg, configPath: configPath, runCtx: ctx, version: "capacity-qualification", effectiveRunMode: "remote", remoteEnabled: true, log: slog.New(slog.NewTextHandler(io.Discard, nil))}
		a.controlTrustRoots = roots
		a.controlGrantObserver = func(context.Context, json.RawMessage) { metrics.observe("session_grant", 0, nil) }
		a.controlRPCObserver = func(typeID uint32, elapsed time.Duration, err error) {
			name := "control_other"
			switch typeID {
			case controlRPCTypeRegister:
				name = "register"
			case controlRPCTypeHeartbeat:
				name = "heartbeat"
			case controlRPCTypeControlPoolTopUp:
				name = "pool_top_up"
			case controlRPCTypeControlPoolAck:
				name = "pool_ack"
			}
			metrics.observe(name, elapsed, err)
		}
		agents = append(agents, a)
		a.startControlChannel(ctx)
		select {
		case <-ramp.C:
		case <-ctx.Done():
			t.Fatal("qualification ended before all clients started")
		}
	}
	for _, entry := range manifest.Gateways {
		wg.Add(1)
		go func() { defer wg.Done(); capacityGatewayObservation(ctx, entry, roots, metrics) }()
	}
	for _, entry := range manifest.HTTP {
		if entry.RPS < 1 || entry.Name == "" {
			t.Fatal("invalid HTTP workload")
		}
		if entry.CookieFile != "" && !filepath.IsAbs(entry.CookieFile) {
			entry.CookieFile = filepath.Join(filepath.Dir(manifestPath), entry.CookieFile)
		}
		wg.Add(1)
		go func() { defer wg.Done(); capacityHTTPWorkload(ctx, entry, roots, metrics) }()
	}
	// Start the full steady-state duration only after all fixtures are online.
	// Recovery uses the production Gateway observer and control lifecycle, including
	// generation renewal after artifact-pool exhaustion; Flowersec owns network retries.
	registered := make([]bool, len(agents))
	previous := make([]bool, len(agents))
	measureOnline := func() {
		var online int64
		for index, a := range agents {
			a.mu.Lock()
			ready := a.controlRegistered && a.controlRPC != nil
			a.mu.Unlock()
			if ready {
				online++
			}
			if ready && !registered[index] {
				registered[index] = true
				metrics.EverRegistered.Add(1)
			}
			if !ready && previous[index] {
				metrics.Disconnects.Add(1)
			}
			previous[index] = ready
		}
		metrics.Online.Store(online)
		for peak := metrics.PeakOnline.Load(); online > peak; peak = metrics.PeakOnline.Load() {
			if metrics.PeakOnline.CompareAndSwap(peak, online) {
				break
			}
		}
	}
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	startupDeadline := time.NewTimer(300 * time.Second)
	defer startupDeadline.Stop()
	for metrics.Online.Load() != int64(len(agents)) {
		select {
		case <-ctx.Done():
			t.Fatal("qualification cancelled during startup")
		case <-startupDeadline.C:
			t.Fatal("clients did not all register within the startup budget")
		case now := <-ticker.C:
			measureOnline()
			sample := metrics.report()
			sample["observed_at"], sample["phase"] = now.UTC(), "startup"
			if err := json.NewEncoder(snapshots).Encode(sample); err != nil {
				t.Fatal(err)
			}
		}
	}
	steadyAt := time.Now()
	steadyBaseline := metrics.report()
	metrics.Steady.Store(true)
	minimumOnline := int64(len(agents))
	deadline := time.NewTimer(time.Duration(manifest.DurationSeconds) * time.Second)
	defer deadline.Stop()
qualification:
	for {
		select {
		case <-ctx.Done():
			t.Fatal("qualification cancelled before the steady-state duration elapsed")
		case <-deadline.C:
			break qualification
		case now := <-ticker.C:
			measureOnline()
			minimumOnline = min(minimumOnline, metrics.Online.Load())
			sample := metrics.report()
			sample["observed_at"], sample["phase"] = now.UTC(), "steady"
			if err := json.NewEncoder(snapshots).Encode(sample); err != nil {
				t.Fatal(err)
			}
		}
	}
	measureOnline()
	minimumOnline = min(minimumOnline, metrics.Online.Load())
	metrics.Steady.Store(false)
	report := metrics.report()
	issues := []string{}
	if manifest.Scenario == "steady" {
		if minimumOnline != int64(len(agents)) {
			issues = append(issues, "steady-state clients disconnected")
		}
		metrics.Operations.Range(func(key, value any) bool {
			name := key.(string)
			if !strings.HasPrefix(name, "steady/") {
				return true
			}
			stats := value.(*capacityHistogram).snapshot()
			if stats["errors"] > 0 && stats["errors"]*1000 >= stats["count"] {
				issues = append(issues, name+" error rate exceeded 0.1 percent")
			}
			p95Limit := uint64(0)
			switch name {
			case "steady/heartbeat":
				p95Limit = 500
			case "steady/environment_query", "steady/session_init":
				p95Limit = 1000
			}
			if p95Limit > 0 && stats["p95_ms"] > p95Limit {
				issues = append(issues, name+" p95 exceeded its latency budget")
			}
			if name == "steady/heartbeat" && stats["p99_ms"] > 2000 {
				issues = append(issues, "heartbeat p99 exceeded two seconds")
			}
			return true
		})
		for _, name := range []string{"heartbeat", "runtime_signed_status", "environment_query", "session_init"} {
			if metrics.histogram("steady/"+name).Count.Load() == 0 {
				issues = append(issues, "no steady-state "+name+" measurements")
			}
		}
	}
	report["scenario"] = manifest.Scenario
	report["minimum_steady_online"] = minimumOnline
	report["client_slo_issues"] = issues
	report["qualification_status"] = "pending independent server and incident evidence"
	report["environment"] = manifest.Environment
	report["duration_seconds"] = manifest.DurationSeconds
	report["startup_started_at"] = startupAt.UTC()
	report["steady_started_at"] = steadyAt.UTC()
	report["steady_baseline"] = steadyBaseline
	report["completed_at"] = time.Now().UTC()
	report["requested_clients"] = len(manifest.RuntimeConfigs)
	report["server_resource_qualification"] = "requires independent Region and Control Cell CPU/RSS/DB samples"
	data, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(output, "report.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	if metrics.Failures.Load() > 0 || len(issues) > 0 {
		t.Fatal("qualification recorded terminal client failures; inspect report.json")
	}
}
func capacityRoots(path string) (*x509.CertPool, error) {
	if path == "" {
		return nil, nil
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	roots, err := x509.SystemCertPool()
	if err != nil {
		return nil, err
	}
	if !roots.AppendCertsFromPEM(raw) {
		return nil, errors.New("invalid qualification CA")
	}
	return roots, nil
}
func capacityGatewayObservation(ctx context.Context, entry capacityGateway, roots *x509.CertPool, metrics *capacityMetrics) {
	key, err := gc.DecodeKey(entry.PrivateKey)
	if err != nil || len(key) != ed25519.PrivateKeySize {
		metrics.Failures.Add(1)
		return
	}
	client, err := gatewaycloud.NewClient(entry.Origin, capacityHTTPTransport(roots))
	if err != nil {
		metrics.Failures.Add(1)
		return
	}
	defer client.Close()
	identity := gatewaycloud.Identity{PrivateKey: ed25519.PrivateKey(key), NamespacePublicID: entry.NamespaceID, GatewayPublicID: entry.GatewayID}
	timer := time.NewTimer(time.Nanosecond)
	defer timer.Stop()
	first := true
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		start := time.Now()
		_, err := client.GatewayStatus(ctx, identity)
		if ctx.Err() != context.Canceled {
			metrics.observe("gateway_signed_status", time.Since(start), err)
		}
		delay := 5 * time.Second
		if first {
			delay = periodic.InitialDelay(delay)
			first = false
		}
		timer.Reset(delay)
	}
}
func capacityHTTPTransport(roots *x509.CertPool) *http.Transport {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.TLSClientConfig = &tls.Config{MinVersion: tls.VersionTLS13, RootCAs: roots}
	transport.MaxConnsPerHost = 128
	transport.MaxIdleConnsPerHost = 32
	transport.MaxIdleConns = 256
	return transport
}
func capacityHTTPWorkload(ctx context.Context, entry capacityHTTP, roots *x509.CertPool, metrics *capacityMetrics) {
	client := &http.Client{Transport: capacityHTTPTransport(roots), Timeout: 3 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	defer client.CloseIdleConnections()
	tick := time.NewTicker(time.Second / time.Duration(entry.RPS))
	defer tick.Stop()
	slots := make(chan struct{}, 128)
	var wg sync.WaitGroup
	defer wg.Wait()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			select {
			case slots <- struct{}{}:
			default:
				metrics.observe(entry.Name, 0, errors.New("load host saturated"))
				continue
			}
			wg.Add(1)
			go func() {
				defer wg.Done()
				defer func() { <-slots }()
				start := time.Now()
				request, err := http.NewRequestWithContext(ctx, entry.Method, entry.URL, nil)
				if err == nil && len(entry.Body) > 0 {
					request.Body = io.NopCloser(bytes.NewReader(entry.Body))
					request.ContentLength = int64(len(entry.Body))
				}
				if err == nil {
					for key, value := range entry.Headers {
						request.Header.Set(key, value)
					}
					// The fixture owner refreshes credentials through the real Auth
					// endpoint and atomically replaces this private Cookie header file.
					if entry.CookieFile != "" {
						var cookie []byte
						cookie, err = os.ReadFile(entry.CookieFile)
						if err == nil && (len(cookie) == 0 || len(cookie) > 32768) {
							err = errors.New("invalid workload cookie file")
						}
						if err == nil {
							request.Header.Set("Cookie", strings.TrimSpace(string(cookie)))
						}
					}
				}
				if err == nil {
					var response *http.Response
					response, err = client.Do(request)
					if err == nil {
						_, readErr := io.Copy(io.Discard, io.LimitReader(response.Body, 2<<20))
						_ = response.Body.Close()
						if readErr != nil || response.StatusCode < 200 || response.StatusCode >= 300 {
							err = errors.New("HTTP workload rejected")
						}
					}
				}
				if ctx.Err() != context.Canceled {
					metrics.observe(entry.Name, time.Since(start), err)
				}
			}()
		}
	}
}
