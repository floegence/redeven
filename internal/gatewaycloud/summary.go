package gatewaycloud

import (
	"context"
	"errors"
	"os"
)

// Summary is safe for local management UI and never includes machine credentials.
type Summary struct {
	Configured        bool   `json:"configured"`
	CloudOrigin       string `json:"cloud_origin,omitempty"`
	GatewayPublicID   string `json:"gateway_public_id,omitempty"`
	NamespacePublicID string `json:"namespace_public_id,omitempty"`
	Region            string `json:"region,omitempty"`
	State             string `json:"state"`
	ManagementURL     string `json:"management_url,omitempty"`
}

func InspectGateway(ctx context.Context, stateRoot string) (*Summary, error) {
	var config GatewayConfig
	if err := ReadState(GatewayConfigPath(stateRoot), &config); errors.Is(err, os.ErrNotExist) {
		return &Summary{State: "unconfigured"}, nil
	} else if err != nil {
		return nil, err
	}
	identity, err := gatewayIdentity(config)
	if err != nil {
		return nil, err
	}
	client, err := directCloudClient(config.CloudOrigin)
	if err != nil {
		return nil, err
	}
	defer client.Close()
	status, err := client.GatewayStatus(ctx, identity)
	if err != nil {
		return nil, err
	}
	return &Summary{Configured: true, CloudOrigin: config.CloudOrigin, GatewayPublicID: status.Gateway.PublicID, NamespacePublicID: status.Gateway.NamespacePublicID, Region: status.Gateway.Region, State: status.Gateway.State, ManagementURL: GatewayManagementURL(config.CloudOrigin, status.Gateway.NamespacePublicID, status.Gateway.PublicID, status.Gateway.PublicKeySHA256)}, nil
}
