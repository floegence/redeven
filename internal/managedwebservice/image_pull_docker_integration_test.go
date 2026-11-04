package managedwebservice

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/containerengine"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

// Explicit acceptance uses a new daemon and a local OCI registry with unique
// layers. No user image, container, context or daemon configuration is changed.
func TestManagedImagePullRealDockerTelemetry(t *testing.T) {
	if os.Getenv("REDEVEN_IMAGE_PULL_DOCKER_TEST") != "1" {
		t.Skip("explicit isolated Docker pull acceptance only")
	}
	registryURL, digest, totalBytes := startPullFixtureRegistry(t)
	outerEnv := os.Environ()
	outer := func(args ...string) ([]byte, error) {
		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, "docker", args...)
		cmd.Env = outerEnv
		return cmd.CombinedOutput()
	}
	name := fmt.Sprintf("redeven-pull-telemetry-%d", time.Now().UnixNano())
	raw, err := outer("run", "--pull=never", "--privileged", "--detach", "--name", name, "-p", "127.0.0.1::2375", "-e", "DOCKER_TLS_CERTDIR=", "docker:29-dind", "--insecure-registry", registryURL)
	if err != nil {
		t.Fatalf("start task daemon: %v %s", err, raw)
	}
	t.Cleanup(func() {
		if output, err := outer("rm", "--force", "--volumes", name); err != nil {
			t.Errorf("remove task daemon: %v %s", err, output)
		}
	})
	raw, err = outer("port", name, "2375/tcp")
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("DOCKER_HOST", "tcp://"+strings.TrimSpace(string(raw)))
	t.Setenv("DOCKER_CONTEXT", "")
	t.Setenv("DOCKER_TLS_VERIFY", "")
	client := containerengine.NewCLIClient()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	for {
		if _, err := client.Status(ctx, containerengine.EngineDocker); err == nil {
			break
		}
		if ctx.Err() != nil {
			t.Fatal("task daemon never became ready")
		}
		time.Sleep(200 * time.Millisecond)
	}
	adapter, err := containerengine.NewAdapter(client)
	if err != nil {
		t.Fatal(err)
	}
	ref := registryURL + "/pull-fixture@" + digest
	reporter, db := newImagePullTestReporter(t)
	var strongest *pfregistry.ManagedOperation
	var maximumBytes, maximumRate int64
	_, err = pullManagedImage(withOperationReporter(ctx, reporter), adapter, ref, 1, 1, func(stage string, current int64, transfer ...pfregistry.ManagedOperationTransferProgress) {
		reporter.Progress(stage, current, transfer...)
		if len(transfer) == 0 {
			return
		}
		item := transfer[0]
		maximumBytes, maximumRate = max(maximumBytes, item.DownloadedBytes), max(maximumRate, item.BytesPerSecond)
		if item.DownloadedBytes > 0 && item.BytesPerSecond > 0 && item.CompletedLayers < item.TotalLayers {
			strongest, _ = db.GetManagedOperation(context.Background(), "pull")
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	op, err := db.GetManagedOperation(ctx, "pull")
	if err != nil {
		t.Fatal(err)
	}
	if strongest == nil || maximumRate == 0 || maximumBytes < totalBytes*99/100 || maximumBytes > totalBytes*101/100 {
		t.Fatalf("missing measured transfer: bytes=%d expected=%d rate=%d snapshot=%+v", maximumBytes, totalBytes, maximumRate, strongest)
	}
	if len(op.ProgressDetail.Commands) != 1 || op.ProgressDetail.Commands[0].State != "succeeded" || len(op.ProgressDetail.Output) < 4 {
		t.Fatalf("missing command/output: %+v", op.ProgressDetail)
	}
	if path := os.Getenv("REDEVEN_IMAGE_PULL_EVIDENCE"); path != "" {
		raw, err := json.MarshalIndent(strongest, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, raw, 0600); err != nil {
			t.Fatal(err)
		}
	}
	t.Logf("real Docker pull: observed=%d compressed=%d peak_rate=%dB/s output_lines=%d", maximumBytes, totalBytes, maximumRate, len(op.ProgressDetail.Output))

	var cached bool
	_, err = pullManagedImage(withOperationReporter(ctx, reporter), adapter, ref, 1, 1, func(_ string, _ int64, transfer ...pfregistry.ManagedOperationTransferProgress) {
		if len(transfer) > 0 && transfer[0].Phase == "cached" && transfer[0].CompletedLayers == 2 && transfer[0].DownloadedBytes == 0 {
			cached = true
		}
	})
	if err != nil || !cached {
		t.Fatalf("cached pull: cached=%v error=%v", cached, err)
	}
	_, err = pullManagedImage(withOperationReporter(ctx, reporter), adapter, registryURL+"/missing:latest", 1, 1, reporter.Progress)
	code, _, _, _ := ErrorDetails(err)
	if code != "IMAGE_UNAVAILABLE" {
		failed, _ := db.GetManagedOperation(ctx, "pull")
		t.Fatalf("missing image error=%v code=%s output=%+v", err, code, failed.ProgressDetail.Output)
	}
}

func startPullFixtureRegistry(t *testing.T) (string, string, int64) {
	t.Helper()
	type descriptor struct {
		MediaType string `json:"mediaType"`
		Size      int    `json:"size"`
		Digest    string `json:"digest"`
	}
	blobs := map[string][]byte{}
	layers := []descriptor{}
	diffIDs := []string{}
	var totalBytes int64
	for index, size := range []int{2 << 20, 4 << 20} {
		payload := make([]byte, size)
		if _, err := rand.Read(payload); err != nil {
			t.Fatal(err)
		}
		var unpacked, compressed bytes.Buffer
		tw := tar.NewWriter(&unpacked)
		if err := tw.WriteHeader(&tar.Header{Name: fmt.Sprintf("layer-%d.bin", index), Mode: 0644, Size: int64(size)}); err != nil {
			t.Fatal(err)
		}
		if _, err := tw.Write(payload); err != nil {
			t.Fatal(err)
		}
		if err := tw.Close(); err != nil {
			t.Fatal(err)
		}
		diffIDs = append(diffIDs, fmt.Sprintf("sha256:%x", sha256.Sum256(unpacked.Bytes())))
		zw := gzip.NewWriter(&compressed)
		if _, err := zw.Write(unpacked.Bytes()); err != nil {
			t.Fatal(err)
		}
		if err := zw.Close(); err != nil {
			t.Fatal(err)
		}
		digest := fmt.Sprintf("sha256:%x", sha256.Sum256(compressed.Bytes()))
		blobs[digest] = compressed.Bytes()
		totalBytes += int64(compressed.Len())
		layers = append(layers, descriptor{"application/vnd.docker.image.rootfs.diff.tar.gzip", compressed.Len(), digest})
	}
	config, err := json.Marshal(map[string]any{"architecture": runtime.GOARCH, "os": "linux", "rootfs": map[string]any{"type": "layers", "diff_ids": diffIDs}})
	if err != nil {
		t.Fatal(err)
	}
	configDigest := fmt.Sprintf("sha256:%x", sha256.Sum256(config))
	blobs[configDigest] = config
	manifestType := "application/vnd.docker.distribution.manifest.v2+json"
	manifest, err := json.Marshal(map[string]any{"schemaVersion": 2, "mediaType": manifestType, "config": descriptor{"application/vnd.docker.container.image.v1+json", len(config), configDigest}, "layers": layers})
	if err != nil {
		t.Fatal(err)
	}
	manifestDigest := fmt.Sprintf("sha256:%x", sha256.Sum256(manifest))
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Docker-Distribution-Api-Version", "registry/2.0")
		if r.URL.Path == "/v2/" {
			w.WriteHeader(200)
			return
		}
		var body []byte
		var digest string
		contentType := "application/octet-stream"
		if strings.HasPrefix(r.URL.Path, "/v2/pull-fixture/manifests/") {
			body, digest, contentType = manifest, manifestDigest, manifestType
		} else if strings.HasPrefix(r.URL.Path, "/v2/pull-fixture/blobs/") {
			digest = strings.TrimPrefix(r.URL.Path, "/v2/pull-fixture/blobs/")
			body = blobs[digest]
		}
		if body == nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			_ = json.NewEncoder(w).Encode(map[string]any{"errors": []map[string]string{{"code": "MANIFEST_UNKNOWN", "message": "manifest unknown"}}})
			return
		}
		w.Header().Set("Content-Type", contentType)
		w.Header().Set("Docker-Content-Digest", digest)
		w.Header().Set("Content-Length", fmt.Sprint(len(body)))
		if r.Method == http.MethodHead {
			return
		}
		for len(body) > 0 {
			n := min(len(body), 64*1024)
			if _, err := w.Write(body[:n]); err != nil {
				return
			}
			body = body[n:]
			w.(http.Flusher).Flush()
			select {
			case <-r.Context().Done():
				return
			case <-time.After(40 * time.Millisecond):
			}
		}
	}))
	listener, err := net.Listen("tcp", "0.0.0.0:0")
	if err != nil {
		t.Fatal(err)
	}
	_ = server.Listener.Close()
	server.Listener = listener
	server.Start()
	t.Cleanup(server.Close)
	return fmt.Sprintf("host.docker.internal:%d", listener.Addr().(*net.TCPAddr).Port), manifestDigest, totalBytes
}
