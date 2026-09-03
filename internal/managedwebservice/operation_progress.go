package managedwebservice

import (
	"bufio"
	"context"
	"errors"
	"io"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

const (
	operationOutputMaxLines = 400
	operationOutputMaxBytes = 128 * 1024
	operationOutputLineMax  = 4 * 1024
	operationOutputInterval = 500 * time.Millisecond
)

var (
	operationANSISequencePattern = regexp.MustCompile(`\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))`)
	operationURLPattern          = regexp.MustCompile(`https?://[^\s<>"']+`)
)

type operationReporterContextKey struct{}

type operationReporter struct {
	manager       *Manager
	operation     *pfregistry.ManagedOperation
	mu            sync.Mutex
	secretValues  []string
	privatePaths  []string
	nextSequence  int64
	lastPersisted time.Time
	flushTimer    *time.Timer
	dirty         bool
	closed        bool
}

func newOperationReporter(manager *Manager, operation *pfregistry.ManagedOperation, service *pfregistry.ManagedService) *operationReporter {
	reporter := &operationReporter{manager: manager, operation: operation}
	if service != nil {
		reporter.privatePaths = append(reporter.privatePaths, manager.stateDir, service.WorkspacePath)
		if secrets, err := manager.serviceSecretDocument(service.ServiceID); err == nil {
			for _, values := range []map[string]string{secrets.Parameters, secrets.Environment} {
				for _, value := range values {
					if strings.TrimSpace(value) != "" {
						reporter.secretValues = append(reporter.secretValues, value)
					}
				}
			}
		}
	}
	if operation != nil && operation.ProgressDetail != nil && len(operation.ProgressDetail.Output) > 0 {
		reporter.nextSequence = operation.ProgressDetail.Output[len(operation.ProgressDetail.Output)-1].Sequence
	}
	return reporter
}

func withOperationReporter(ctx context.Context, reporter *operationReporter) context.Context {
	return context.WithValue(ctx, operationReporterContextKey{}, reporter)
}

func reporterFromContext(ctx context.Context) *operationReporter {
	if ctx == nil {
		return nil
	}
	reporter, _ := ctx.Value(operationReporterContextKey{}).(*operationReporter)
	return reporter
}

func (r *operationReporter) Progress(stage string, current int64, transfer ...pfregistry.ManagedOperationTransferProgress) {
	if r == nil || r.operation == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return
	}
	now := time.Now().UnixMilli()
	detail := ensureOperationProgressDetail(r.operation)
	if r.operation.Stage != stage || detail.StageStartedAtUnixMs == 0 {
		detail.StageStartedAtUnixMs = now
	}
	r.operation.Stage = stage
	r.operation.ProgressCurrent = current
	detail.UpdatedAtUnixMs = now
	if len(transfer) > 0 {
		value := transfer[len(transfer)-1]
		detail.Transfer = &value
	} else if stage != "pulling" {
		detail.Transfer = nil
	}
	r.persistLocked(true)
}

func (r *operationReporter) StartCommand(commandID, display string) string {
	if r == nil || r.operation == nil {
		return commandID
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return commandID
	}
	detail := ensureOperationProgressDetail(r.operation)
	baseID := commandID
	for suffix := 2; commandIDInUse(detail.Commands, commandID); suffix++ {
		commandID = baseID + "-" + strconv.Itoa(suffix)
	}
	now := time.Now().UnixMilli()
	detail.Commands = append(detail.Commands, pfregistry.ManagedOperationCommand{
		CommandID: commandID, Display: r.Redact(display), State: "running", StartedAtUnixMs: now,
	})
	detail.UpdatedAtUnixMs = now
	r.persistLocked(true)
	return commandID
}

func (r *operationReporter) FinishCommand(commandID, state string) {
	if r == nil || r.operation == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return
	}
	detail := ensureOperationProgressDetail(r.operation)
	for index := len(detail.Commands) - 1; index >= 0; index-- {
		if detail.Commands[index].CommandID == commandID {
			detail.Commands[index].State = state
			detail.Commands[index].FinishedAtUnixMs = time.Now().UnixMilli()
			break
		}
	}
	detail.UpdatedAtUnixMs = time.Now().UnixMilli()
	r.persistLocked(true)
}

func (r *operationReporter) Output(commandID, stream, value string) {
	if r == nil || r.operation == nil {
		return
	}
	value = strings.TrimSpace(r.Redact(value))
	if value == "" {
		return
	}
	value, lineTruncated := truncateOperationOutput(value, operationOutputLineMax)
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return
	}
	detail := ensureOperationProgressDetail(r.operation)
	r.nextSequence++
	detail.Output = append(detail.Output, pfregistry.ManagedOperationOutputLine{Sequence: r.nextSequence, CommandID: commandID, Stream: stream, Text: value})
	if lineTruncated {
		detail.OutputTruncated = true
	}
	for len(detail.Output) > operationOutputMaxLines || operationOutputBytes(detail.Output) > operationOutputMaxBytes {
		detail.Output = detail.Output[1:]
		detail.OutputTruncated = true
	}
	detail.UpdatedAtUnixMs = time.Now().UnixMilli()
	r.dirty = true
	r.persistLocked(time.Since(r.lastPersisted) >= operationOutputInterval)
}

func (r *operationReporter) Flush() {
	if r == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.persistLocked(true)
}

func (r *operationReporter) Close() {
	if r == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return
	}
	r.persistLocked(true)
	r.closed = true
}

func (r *operationReporter) Redact(value string) string {
	value = operationANSISequencePattern.ReplaceAllString(value, "")
	value = strings.Map(func(character rune) rune {
		if character == '\t' || character >= 0x20 && character != 0x7f {
			return character
		}
		return -1
	}, value)
	value = redactLogLine(value)
	for _, secret := range r.secretValues {
		value = strings.ReplaceAll(value, secret, "[REDACTED]")
	}
	for _, privatePath := range r.privatePaths {
		if strings.TrimSpace(privatePath) != "" {
			value = strings.ReplaceAll(value, privatePath, "<managed-path>")
		}
	}
	return value
}

func (r *operationReporter) persistLocked(force bool) {
	if !force && !r.dirty {
		return
	}
	if !force && time.Since(r.lastPersisted) < operationOutputInterval {
		r.scheduleFlushLocked(operationOutputInterval - time.Since(r.lastPersisted))
		return
	}
	if r.flushTimer != nil {
		r.flushTimer.Stop()
		r.flushTimer = nil
	}
	r.dirty = false
	r.lastPersisted = time.Now()
	r.manager.saveAndPublish(r.operation)
}

func (r *operationReporter) scheduleFlushLocked(delay time.Duration) {
	if r.flushTimer != nil || r.closed {
		return
	}
	if delay < 0 {
		delay = 0
	}
	r.flushTimer = time.AfterFunc(delay, func() {
		r.mu.Lock()
		defer r.mu.Unlock()
		r.flushTimer = nil
		if r.closed || !r.dirty {
			return
		}
		r.persistLocked(true)
	})
}

func ensureOperationProgressDetail(operation *pfregistry.ManagedOperation) *pfregistry.ManagedOperationProgressDetail {
	if operation.ProgressDetail == nil {
		operation.ProgressDetail = &pfregistry.ManagedOperationProgressDetail{SchemaVersion: pfregistry.ManagedOperationProgressDetailSchemaVersion}
	}
	operation.ProgressDetail.SchemaVersion = pfregistry.ManagedOperationProgressDetailSchemaVersion
	return operation.ProgressDetail
}

func operationOutputBytes(lines []pfregistry.ManagedOperationOutputLine) int {
	total := 0
	for _, line := range lines {
		total += len(line.Text)
	}
	return total
}

func truncateOperationOutput(value string, maxBytes int) (string, bool) {
	if len(value) <= maxBytes {
		return value, false
	}
	value = value[:maxBytes]
	for !utf8.ValidString(value) {
		value = value[:len(value)-1]
	}
	return value, true
}

func redactOperationURL(value string) string {
	parsed, err := url.Parse(value)
	if err != nil || parsed.RawQuery == "" {
		return value
	}
	query := parsed.Query()
	for key := range query {
		query.Set(key, "[REDACTED]")
	}
	parsed.RawQuery = query.Encode()
	return parsed.String()
}

func commandIDInUse(commands []pfregistry.ManagedOperationCommand, commandID string) bool {
	for _, command := range commands {
		if command.CommandID == commandID {
			return true
		}
	}
	return false
}

func readOperationOutputLines(source io.Reader, consume func(string)) error {
	reader := bufio.NewReaderSize(source, 16*1024)
	line := make([]byte, 0, operationOutputLineMax+1)
	for {
		fragment, more, err := reader.ReadLine()
		remaining := operationOutputLineMax + 1 - len(line)
		if remaining > 0 {
			if len(fragment) > remaining {
				fragment = fragment[:remaining]
			}
			line = append(line, fragment...)
		}
		if !more && len(line) > 0 {
			consume(string(line))
			line = line[:0]
		}
		if err != nil {
			if errors.Is(err, io.EOF) {
				if len(line) > 0 {
					consume(string(line))
				}
				return nil
			}
			return err
		}
	}
}
