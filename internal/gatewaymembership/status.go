package gatewaymembership

import (
	"errors"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

// AttachmentStatus separates durable consent from the Runtime's observed transport.
// Phase is a presentation projection, never an authorization input.
type AttachmentStatus struct {
	GatewayID       string               `json:"gateway_id"`
	GatewayName     string               `json:"gateway_name"`
	AttachmentID    string               `json:"attachment_id"`
	AttachmentState string               `json:"attachment_state"`
	ConnectionState string               `json:"connection_state"`
	Phase           string               `json:"phase"`
	RouteSelected   bool                 `json:"route_selected"`
	Endpoints       []gp.GatewayEndpoint `json:"endpoints"`
	LastEndpointID  string               `json:"last_endpoint_id,omitempty"`
}

type AttachmentCounts struct {
	Total     int `json:"total"`
	Joined    int `json:"joined"`
	Connected int `json:"connected"`
	Joining   int `json:"joining"`
	Removing  int `json:"removing"`
}

// AttachmentSnapshot always contains a collection, including zero or one item.
// RuntimeRunning identifies the observer, not Gateway service availability.
type AttachmentSnapshot struct {
	Attachments      []AttachmentStatus `json:"attachments"`
	Counts           AttachmentCounts   `json:"counts"`
	RuntimeRunning   bool               `json:"runtime_running"`
	ObservedAtUnixMS int64              `json:"observed_at_unix_ms"`
}

func ObserveAttachments(members []*RuntimeConfig, selectedAttachmentID string, running bool, connections map[string]flowersec.ConnectionSnapshot, now time.Time) AttachmentSnapshot {
	out := AttachmentSnapshot{Attachments: []AttachmentStatus{}, RuntimeRunning: running, ObservedAtUnixMS: now.UnixMilli()}
	for _, member := range members {
		item := AttachmentStatus{GatewayID: member.GatewayID, GatewayName: member.GatewayName, AttachmentID: member.AttachmentID, AttachmentState: "joined", ConnectionState: "unknown", Phase: "unknown", RouteSelected: member.AttachmentID == selectedAttachmentID, Endpoints: member.ConnectionEndpoints(), LastEndpointID: member.LastEndpointID}
		if !running {
			item.ConnectionState, item.Phase = "stopped", "runtime_stopped"
		} else if connection, ok := connections[member.GatewayID]; ok {
			switch connection.State {
			case flowersec.ConnectionConnected:
				item.ConnectionState, item.Phase = "connected", "joined"
			case flowersec.ConnectionConnecting:
				item.ConnectionState, item.Phase = "connecting", "connecting"
			case flowersec.ConnectionIdle, flowersec.ConnectionWaiting, flowersec.ConnectionClosed:
				item.ConnectionState, item.Phase = "disconnected", "disconnected"
			case flowersec.ConnectionFailed:
				item.ConnectionState, item.Phase = "failed", "connection_failed"
				if connection.Failure != nil && (errors.Is(connection.Failure.Error, ErrDenied) || errors.Is(connection.Failure.Error, ErrInvalidProof)) {
					item.Phase = "reauthorization_required"
				}
			}
		}
		if member.PendingJoin != nil {
			item.AttachmentState = "joining"
			item.Phase = "joining"
		}
		if member.Leaving {
			item.AttachmentState = "removal_pending"
			item.Phase = "removal_pending"
		}
		out.Counts.Total++
		switch item.AttachmentState {
		case "joined":
			out.Counts.Joined++
		case "joining":
			out.Counts.Joining++
		case "removal_pending":
			out.Counts.Removing++
		}
		if item.ConnectionState == "connected" && item.AttachmentState == "joined" {
			out.Counts.Connected++
		}
		out.Attachments = append(out.Attachments, item)
	}
	return out
}
