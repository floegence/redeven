package managedwebservice

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

func TestOperationReporterPersistsOrderedBoundedRedactedOutput(t *testing.T) {
	t.Parallel()
	registry, err := pfregistry.Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer registry.Close()
	operation := pfregistry.ManagedOperation{
		OperationID: "mop_reporter", ServiceID: "mws_reporter", RequestID: "req_reporter", RequestFingerprint: "fingerprint",
		Action: "install", State: "running", Stage: "installing", ProgressTotal: operationProgressTotal,
	}
	if err := registry.CreateManagedOperation(context.Background(), operation); err != nil {
		t.Fatal(err)
	}
	manager := &Manager{registry: registry, listeners: map[string]map[uint64]chan pfregistry.ManagedOperation{}}
	reporter := newOperationReporter(manager, &operation, nil)
	reporter.secretValues = []string{"exact-private-value"}
	reporter.privatePaths = []string{"/private/managed/root"}
	redacted := reporter.Redact("\x1b[31msecret=exact-private-value /private/managed/root http://127.0.0.1/app?token=url-private\x1b[0m")
	for _, forbidden := range []string{"\x1b", "url-private", "exact-private-value", "/private/managed/root"} {
		if strings.Contains(redacted, forbidden) {
			t.Fatalf("redaction leaked %q: %q", forbidden, redacted)
		}
	}

	firstID := reporter.StartCommand("npm-install", "<managed-node> install")
	secondID := reporter.StartCommand("npm-install", "<managed-node> rebuild")
	if firstID != "npm-install" || secondID != "npm-install-2" {
		t.Fatalf("command IDs = %q, %q", firstID, secondID)
	}
	reporter.Output(firstID, "stdout", "\x1b[31mfetching\x1b[0m http://127.0.0.1/app?token=url-private")
	reporter.Output(firstID, "stderr", "secret=exact-private-value path=/private/managed/root")
	reporter.Output(firstID, "stdout", strings.Repeat("x", operationOutputLineMax+100))
	for index := 0; index < operationOutputMaxLines+5; index++ {
		reporter.Output(secondID, "stdout", "line")
	}
	reporter.FinishCommand(firstID, "succeeded")
	reporter.FinishCommand(secondID, "failed")
	reporter.Close()
	reporter.Output(secondID, "stdout", "must-not-be-added-after-close")

	persisted, err := registry.GetManagedOperation(context.Background(), operation.OperationID)
	if err != nil {
		t.Fatal(err)
	}
	if persisted == nil || persisted.ProgressDetail == nil {
		t.Fatal("operation progress was not persisted")
	}
	detail := persisted.ProgressDetail
	if len(detail.Commands) != 2 || detail.Commands[0].State != "succeeded" || detail.Commands[1].State != "failed" {
		t.Fatalf("commands = %#v", detail.Commands)
	}
	if len(detail.Output) != operationOutputMaxLines || !detail.OutputTruncated {
		t.Fatalf("output count=%d truncated=%v", len(detail.Output), detail.OutputTruncated)
	}
	previous := int64(0)
	for _, line := range detail.Output {
		if line.Sequence <= previous {
			t.Fatalf("output sequence is not increasing: %#v", detail.Output)
		}
		previous = line.Sequence
		for _, forbidden := range []string{"\x1b", "url-private", "exact-private-value", "/private/managed/root", "must-not-be-added-after-close"} {
			if strings.Contains(line.Text, forbidden) {
				t.Fatalf("output leaked %q: %q", forbidden, line.Text)
			}
		}
	}
}

func TestReadOperationOutputLinesBoundsLongPhysicalLines(t *testing.T) {
	t.Parallel()
	input := strings.Repeat("a", operationOutputLineMax*4) + "\nnext\n"
	lines := []string{}
	if err := readOperationOutputLines(strings.NewReader(input), func(line string) { lines = append(lines, line) }); err != nil {
		t.Fatal(err)
	}
	if len(lines) != 2 || len(lines[0]) != operationOutputLineMax+1 || lines[1] != "next" {
		t.Fatalf("bounded lines = %#v", lines)
	}
}

func TestOperationReporterFlushesQuietOutputBurstWithinInterval(t *testing.T) {
	t.Parallel()
	registry, err := pfregistry.Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer registry.Close()
	operation := pfregistry.ManagedOperation{
		OperationID: "mop_quiet_burst", ServiceID: "mws_quiet_burst", RequestID: "req_quiet_burst", RequestFingerprint: "fingerprint",
		Action: "install", State: "running", Stage: "installing", ProgressTotal: operationProgressTotal,
	}
	if err := registry.CreateManagedOperation(context.Background(), operation); err != nil {
		t.Fatal(err)
	}
	manager := &Manager{registry: registry, listeners: map[string]map[uint64]chan pfregistry.ManagedOperation{}}
	reporter := newOperationReporter(manager, &operation, nil)
	operationID := operation.OperationID
	commandID := reporter.StartCommand("npm-install", "<managed-node> install")
	reporter.lastPersisted = time.Now()
	reporter.Output(commandID, "stdout", "quiet burst")
	defer reporter.Close()

	deadline := time.Now().Add(2 * operationOutputInterval)
	for {
		persisted, err := registry.GetManagedOperation(context.Background(), operationID)
		if err != nil {
			t.Fatal(err)
		}
		if persisted != nil && persisted.ProgressDetail != nil && len(persisted.ProgressDetail.Output) == 1 {
			if persisted.ProgressDetail.Output[0].Text != "quiet burst" {
				t.Fatalf("persisted output = %#v", persisted.ProgressDetail.Output)
			}
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("quiet output burst was not persisted within the throttle interval")
		}
		time.Sleep(10 * time.Millisecond)
	}
}
