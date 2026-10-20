package ai

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"regexp"
	"time"

	wire "github.com/coder/websocket"
	flprovider "github.com/floegence/floret/v7/provider"
)

// One collector owns transport facts for one physical generation attempt. It
// contains no body, endpoint, credentials, peer prose, or retry scheduler.
type providerAttemptDiagnostic struct {
	Transport        flprovider.TransportKind  `json:"transport,omitempty"`
	Phase            flprovider.TransportPhase `json:"phase,omitempty"`
	SwitchReason     string                    `json:"switch_reason,omitempty"`
	HTTPStatus       int                       `json:"http_status,omitempty"`
	RequestID        string                    `json:"request_id,omitempty"`
	WSCloseCode      int                       `json:"ws_close_code,omitempty"`
	ConnectMS        *int64                    `json:"connect_ms,omitempty"`
	FirstEventMS     *int64                    `json:"first_event_ms,omitempty"`
	Terminal         bool                      `json:"terminal_received"`
	RequestBytes     int                       `json:"request_bytes"`
	ThreadID         string                    `json:"thread_id,omitempty"`
	TurnID           string                    `json:"turn_id,omitempty"`
	RunID            string                    `json:"run_id,omitempty"`
	TraceID          string                    `json:"trace_id,omitempty"`
	LogicalRequestID string                    `json:"logical_request_id,omitempty"`
	AttemptID        string                    `json:"attempt_id,omitempty"`
	AttemptEpoch     int                       `json:"attempt_epoch,omitempty"`
	PayloadHash      string                    `json:"payload_hash"`
	started          time.Time
	phase            flprovider.TransportPhase
	pool             *openAIResponsesPool
	route            openAIThreadRoute
	selection        *openAITransportSelection
	onEvent          func(StreamEvent)
}

var errOpenAIStaleResponse = errors.New("previous response is unavailable")
var diagnosticIdentityPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_:./-]{0,255}$`)
var diagnosticHashPattern = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)

func newProviderAttemptDiagnostic(ctx context.Context, req ModelGatewayRequest, payload []byte, p *openAIProvider, onEvent func(StreamEvent)) *providerAttemptDiagnostic {
	d := &providerAttemptDiagnostic{ThreadID: req.ThreadID.String(), TurnID: req.TurnID.String(), RunID: req.RunID.String(), TraceID: req.TraceID.String(), LogicalRequestID: req.LogicalRequestID.String(), AttemptID: req.AttemptID, AttemptEpoch: req.AttemptEpoch, RequestBytes: len(payload), PayloadHash: fmt.Sprintf("sha256:%x", sha256.Sum256(payload)), started: time.Now(), pool: p.responsesPool, route: openAIRequestRoute(p.transportIdentity, req), onEvent: onEvent}
	if p.chatGPT && p.officialOpenAI {
		d.selection = p.responsesPool.routeSelection(ctx, d.route)
	}
	return d
}
func (d *providerAttemptDiagnostic) sanitized() *providerAttemptDiagnostic {
	if d == nil {
		return nil
	}
	copy := *d
	copy.pool = nil
	copy.selection = nil
	copy.onEvent = nil
	copy.route = openAIThreadRoute{}
	copy.started = time.Time{}
	copy.phase = ""
	if !copy.Transport.Valid() {
		copy.Transport = ""
	}
	if !copy.Phase.Valid() {
		copy.Phase = ""
	}
	if !diagnosticCodePattern.MatchString(copy.SwitchReason) {
		copy.SwitchReason = ""
	}
	if copy.HTTPStatus < 100 || copy.HTTPStatus > 599 {
		copy.HTTPStatus = 0
	}
	if !diagnosticRequestIDPattern.MatchString(copy.RequestID) || diagnosticSecretPattern.MatchString(copy.RequestID) {
		copy.RequestID = ""
	}
	if copy.WSCloseCode < 1000 || copy.WSCloseCode > 4999 {
		copy.WSCloseCode = 0
	}
	for _, id := range []*string{&copy.ThreadID, &copy.TurnID, &copy.RunID, &copy.TraceID, &copy.LogicalRequestID, &copy.AttemptID} {
		if !diagnosticIdentityPattern.MatchString(*id) {
			*id = ""
		}
	}
	if !diagnosticHashPattern.MatchString(copy.PayloadHash) {
		copy.PayloadHash = ""
	}
	if copy.ConnectMS != nil {
		v := *copy.ConnectMS
		if v < 0 {
			copy.ConnectMS = nil
		} else {
			copy.ConnectMS = &v
		}
	}
	if copy.RequestBytes < 0 {
		copy.RequestBytes = 0
	}
	if copy.AttemptEpoch < 0 {
		copy.AttemptEpoch = 0
	}
	if copy.FirstEventMS != nil {
		v := *copy.FirstEventMS
		if v < 0 {
			copy.FirstEventMS = nil
		} else {
			copy.FirstEventMS = &v
		}
	}
	return &copy
}
func (d *providerAttemptDiagnostic) observe(transport flprovider.TransportKind, phase flprovider.TransportPhase, next flprovider.TransportKind, reason string) {
	d.Transport = transport
	d.phase = phase
	emitProviderEvent(d.onEvent, StreamEvent{Type: StreamEventTransport, Transport: &flprovider.TransportObservation{Transport: transport, Phase: phase, NextTransport: next, Reason: reason}})
}
func (d *providerAttemptDiagnostic) switchToSSE(reason string) {
	d.SwitchReason = d.pool.selectSSE(d.route, d.selection, reason)
}
func (d *providerAttemptDiagnostic) firstEvent(terminal bool) {
	if d.FirstEventMS == nil {
		elapsed := time.Since(d.started).Milliseconds()
		d.FirstEventMS = &elapsed
		d.observe(d.Transport, flprovider.TransportReceiving, "", "")
	}
	d.Terminal = d.Terminal || terminal
}
func recoverableWebSocketTransport(err error) bool {
	if err == nil || errors.Is(err, context.Canceled) {
		return false
	}
	advice := flprovider.RetryAdviceForError(err)
	if advice.Forbidden || advice.Category == flprovider.RetryPermanent {
		return false
	}
	var failure *providerFailure
	if errors.As(err, &failure) && failure.diagnostic.Shape != "transport_error" {
		return false
	}
	if errors.Is(err, errOpenAIStaleResponse) || errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) || errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	var network net.Error
	if errors.As(err, &network) {
		return true
	}
	switch wire.CloseStatus(err) {
	case wire.StatusNormalClosure, wire.StatusGoingAway, wire.StatusAbnormalClosure, wire.StatusNoStatusRcvd, wire.StatusInternalError, wire.StatusServiceRestart, wire.StatusTryAgainLater:
		return true
	}
	return false
}
func (d *providerAttemptDiagnostic) finish(ctx context.Context, response *http.Response, result *ModelGatewayResult, err error, providerType string) error {
	if response != nil {
		d.HTTPStatus = response.StatusCode
		d.RequestID = response.Header.Get("x-request-id")
	}
	if err != nil {
		d.Phase = d.phase
		d.WSCloseCode = int(wire.CloseStatus(err))
		var timeout *flprovider.RequestTimeoutError
		timedOut := errors.As(context.Cause(ctx), &timeout)
		advice := flprovider.RetryAdviceForError(err)
		if d.Transport == flprovider.TransportWebSocket && !advice.Forbidden && advice.Category != flprovider.RetryPermanent && (ctx.Err() == nil || timedOut) && (recoverableWebSocketTransport(err) || timedOut) {
			reason := "connection_lost"
			if errors.Is(err, errOpenAIStaleResponse) {
				reason = "continuation_unavailable"
			}
			if timedOut {
				reason = "request_timeout"
			}
			if d.phase == flprovider.TransportConnecting {
				reason = "connect_failed"
			}
			if d.SwitchReason == "" {
				d.switchToSSE(reason)
			}
		}
		if d.Transport.Valid() {
			next := flprovider.TransportKind("")
			if d.SwitchReason != "" {
				next = flprovider.TransportHTTPSSE
			}
			d.observe(d.Transport, flprovider.TransportFailed, next, d.SwitchReason)
		}
		if recoverableWebSocketTransport(err) {
			err = providerTransportFailure(err, providerType)
		}
		var failure *providerFailure
		if errors.As(err, &failure) {
			diagnostic := failure.diagnostic
			diagnostic.Attempt = d.sanitized()
			err = newProviderFailure(diagnostic, err, flprovider.RetryAdviceForError(err))
		}
	} else {
		d.Phase = flprovider.TransportCompleted
		if d.Transport.Valid() {
			d.observe(d.Transport, flprovider.TransportCompleted, "", "")
		}
	}
	safe := d.sanitized()
	if result.RawProviderDiag == nil {
		result.RawProviderDiag = map[string]any{}
	}
	result.RawProviderDiag["attempt"] = safe
	result.RawProviderDiag["transport"] = string(safe.Transport)
	slog.InfoContext(context.WithoutCancel(ctx), "provider attempt completed", "diagnostic", safe, "failed", err != nil)
	return err
}
