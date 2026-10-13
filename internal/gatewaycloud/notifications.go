package gatewaycloud

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
)

// Notifications consumes one machine-authenticated stream. Reconnection is
// owned by Gateway.Run; each replacement begins with an authoritative snapshot.
func (c *Client) Notifications(ctx context.Context, identity Identity, apply func(*gc.GatewayStatus) error) error {
	signed, err := c.Sign(ctx, identity, gc.PurposeGatewayNotify, gc.EmptyRequest{})
	if err != nil {
		return err
	}
	body, err := json.Marshal(signed)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.origin+"/api/console/v1/gateway-cloud/v3/notifications", bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	client := *c.http
	client.Timeout = 0
	deadline := time.AfterFunc(45*time.Second, cancel)
	defer deadline.Stop()
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		var envelope gc.Response[gc.EmptyRequest]
		decoder := json.NewDecoder(io.LimitReader(response.Body, 8193))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&envelope) == nil && decoder.Decode(new(any)) == io.EOF && !envelope.Success && envelope.Error != nil && validErrorCode(envelope.Error.Code) {
			return &CloudError{Code: envelope.Error.Code, Status: response.StatusCode}
		}
		return ErrCloudRequest
	}
	if response.Header.Get("Content-Type") != "application/x-ndjson" {
		return ErrCloudRequest
	}
	scanner := bufio.NewScanner(response.Body)
	scanner.Buffer(make([]byte, 4096), 2<<20)
	var streamID string
	var sequence uint64
	for scanner.Scan() {
		deadline.Reset(45 * time.Second)
		var frame gc.Notification
		decoder := json.NewDecoder(bytes.NewReader(scanner.Bytes()))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&frame) != nil || decoder.Decode(new(any)) != io.EOF || frame.ProtocolVersion != gc.ProtocolVersion || len(frame.StreamID) != 43 || frame.Sequence != sequence+1 || streamID != "" && frame.StreamID != streamID {
			return ErrState
		}
		if sequence == 0 && (frame.Kind != "snapshot" || frame.Snapshot == nil) {
			return ErrState
		}
		streamID, sequence = frame.StreamID, frame.Sequence
		switch frame.Kind {
		case "snapshot":
			if frame.Snapshot == nil || frame.Snapshot.Gateway.PublicID != identity.GatewayPublicID {
				return ErrState
			}
			if err := apply(frame.Snapshot); err != nil {
				return err
			}
		case "keepalive":
			if frame.Snapshot != nil {
				return ErrState
			}
		default:
			return ErrState
		}
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	return errors.New("Gateway notification stream ended; obtain a fresh snapshot")
}
