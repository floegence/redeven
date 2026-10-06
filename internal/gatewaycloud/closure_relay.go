package gatewaycloud

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
)

// ClosureRoute retains only the destination of a retired association. It can
// neither authenticate a Gateway nor authorize member egress or recovery.
type ClosureRoute struct {
	CloudOrigin       string `json:"cloud_origin"`
	NamespacePublicID string `json:"namespace_public_id"`
	GatewayPublicID   string `json:"gateway_public_id"`
}

func retireClosureRoute(config GatewayConfig) ([]ClosureRoute, error) {
	routes := append([]ClosureRoute(nil), config.ClosureRoutes...)
	if config.CloudOrigin == "" || config.NamespacePublicID == "" || config.GatewayPublicID == "" {
		return routes, nil
	}
	route := ClosureRoute{config.CloudOrigin, config.NamespacePublicID, config.GatewayPublicID}
	for _, existing := range routes {
		if existing == route {
			return routes, nil
		}
	}
	if len(routes) >= 1024 {
		return nil, errors.New("historical Cloud receipt route capacity reached")
	}
	return append(routes, route), nil
}

func (config GatewayConfig) permitsClosure(request gc.RuntimeClosureExchangeRequest) bool {
	route := ClosureRoute{request.CloudOrigin, request.Binding.NamespacePublicID, request.Binding.GatewayPublicID}
	if !gc.ValidOrigin(route.CloudOrigin) || route.NamespacePublicID == "" || route.GatewayPublicID == "" {
		return false
	}
	if route == (ClosureRoute{config.CloudOrigin, config.NamespacePublicID, config.GatewayPublicID}) {
		return true
	}
	for _, retired := range config.ClosureRoutes {
		if retired == route {
			return true
		}
	}
	return false
}

// relayClosure forwards one fixed, independently signed receipt contract. It
// never forwards arbitrary paths, headers, CONNECT requests, or credentials.
func (g *Gateway) relayClosure(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodPost || r.Header.Get("Origin") != "" {
		http.Error(w, "RECEIPT_REJECTED", http.StatusForbidden)
		return
	}
	select {
	case g.receiptSlots <- struct{}{}:
		defer func() { <-g.receiptSlots }()
	default:
		http.Error(w, "RECEIPT_BUSY", http.StatusTooManyRequests)
		return
	}
	var request gc.RuntimeClosureExchangeRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&request) != nil || decoder.Decode(new(any)) != io.EOF || !request.Binding.Valid() || len(request.Signature) > 128 || request.Signature == "" {
		http.Error(w, "INVALID_RECEIPT", http.StatusBadRequest)
		return
	}
	g.mu.Lock()
	allowed := g.config.permitsClosure(request)
	g.mu.Unlock()
	if !allowed {
		http.Error(w, "RECEIPT_ORIGIN_UNAVAILABLE", http.StatusForbidden)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	client, err := directCloudClient(request.CloudOrigin)
	if err != nil {
		http.Error(w, "RECEIPT_UNAVAILABLE", http.StatusServiceUnavailable)
		return
	}
	defer client.Close()
	result, err := cloudCall[gc.RuntimeClosureExchangeRequest, gc.RuntimeClosureExchangeResponse](client, ctx, "runtime-closure", request)
	if err != nil {
		http.Error(w, "RECEIPT_PENDING", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(result)
}
