package containerengine

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
)

type NetworkRecord struct {
	NetworkID string              `json:"network_id"`
	Name      string              `json:"name"`
	Labels    map[string]string   `json:"-"`
	UsedBy    []ResourceReference `json:"used_by,omitempty"`
}
type NetworkResourceClient interface {
	ListNetworks(context.Context, Engine) ([]NetworkRecord, error)
	RemoveNetwork(context.Context, Engine, string) error
}

func (a *Adapter) ListNetworks(ctx context.Context, engine Engine) ([]NetworkRecord, error) {
	if err := validateEngine(engine); err != nil {
		return nil, err
	}
	client, ok := a.client.(NetworkResourceClient)
	if !ok {
		return nil, ErrResourceCapabilityUnsupported
	}
	return client.ListNetworks(ctx, engine)
}
func (a *Adapter) RemoveNetwork(ctx context.Context, engine Engine, id string) error {
	if err := validateEngine(engine); err != nil {
		return err
	}
	if err := validateContainerIdentifier(id); err != nil {
		return err
	}
	client, ok := a.client.(NetworkResourceClient)
	if !ok {
		return ErrResourceCapabilityUnsupported
	}
	return client.RemoveNetwork(ctx, engine, id)
}
func (c *CLIClient) ListNetworks(ctx context.Context, engine Engine) ([]NetworkRecord, error) {
	raw, err := c.run(ctx, engine, "network", "ls", "--quiet", "--no-trunc")
	if err != nil {
		return nil, err
	}
	ids := strings.Fields(string(raw))
	if len(ids) == 0 {
		return []NetworkRecord{}, nil
	}
	data, err := c.run(ctx, engine, append([]string{"network", "inspect"}, ids...)...)
	if err != nil {
		return nil, err
	}
	var records []struct {
		ID         string `json:"Id"`
		Name       string
		Labels     map[string]string
		Containers map[string]struct{ Name string }
	}
	if err := json.Unmarshal(data, &records); err != nil {
		return nil, err
	}
	containerIDs, err := c.run(ctx, engine, "ps", "--all", "--quiet", "--no-trunc")
	if err != nil {
		return nil, err
	}
	type networkContainer struct {
		ID              string `json:"Id"`
		Name            string
		State           struct{ Status string }
		Config          struct{ Labels map[string]string }
		NetworkSettings struct {
			Networks map[string]struct{ NetworkID string }
		}
	}
	var containers []networkContainer
	if ids := strings.Fields(string(containerIDs)); len(ids) > 0 {
		raw, err := c.run(ctx, engine, append([]string{"inspect"}, ids...)...)
		if errors.Is(err, ErrContainerNotFound) {
			// Docker may list a container that has disappeared or whose stale
			// metadata cannot be inspected. Only an exact not-found result is
			// absence; permission and transport failures keep inspection blocked.
			for _, id := range ids {
				item, inspectErr := c.run(ctx, engine, "inspect", id)
				if errors.Is(inspectErr, ErrContainerNotFound) {
					continue
				}
				if inspectErr != nil {
					return nil, inspectErr
				}
				var decoded []networkContainer
				if err := json.Unmarshal(item, &decoded); err != nil {
					return nil, err
				}
				if len(decoded) != 1 || decoded[0].ID != id {
					return nil, errors.New("container reference identity changed during network inspection")
				}
				containers = append(containers, decoded[0])
			}
		} else {
			if err != nil {
				return nil, err
			}
			if err := json.Unmarshal(raw, &containers); err != nil {
				return nil, err
			}
		}

	}
	result := make([]NetworkRecord, 0, len(records))
	for _, record := range records {
		if record.ID == "" || record.Name == "" {
			return nil, errors.New("network inspection returned an incomplete identity")
		}
		item := NetworkRecord{NetworkID: record.ID, Name: record.Name, Labels: record.Labels}
		for id, container := range record.Containers {
			item.UsedBy = append(item.UsedBy, ResourceReference{ContainerID: id, Name: container.Name})
		}
		for _, container := range containers {
			for name, attachment := range container.NetworkSettings.Networks {
				if attachment.NetworkID != record.ID && (attachment.NetworkID != "" || name != record.Name) {
					continue
				}
				ref := ResourceReference{ContainerID: container.ID, Name: strings.TrimPrefix(container.Name, "/"), State: ContainerState(container.State.Status), ManagedServiceID: container.Config.Labels["com.floegence.redeven.managed-web-service"]}
				found := false
				for i, existing := range item.UsedBy {
					if existing.ContainerID == container.ID {
						item.UsedBy[i] = ref
						found = true
						break
					}
				}
				if !found {
					item.UsedBy = append(item.UsedBy, ref)
				}
			}
		}
		result = append(result, item)
	}
	return result, nil
}
func (c *CLIClient) RemoveNetwork(ctx context.Context, engine Engine, id string) error {
	_, err := c.run(ctx, engine, "network", "rm", id)
	return err
}
