package containerengine

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestNetworkInventoryIncludesStoppedContainerReferencesAndHidesLabels(t *testing.T) {
	client := &CLIClient{Runner: &fakeCommandRunner{outputs: map[string]string{
		"docker network ls --quiet --no-trunc": "network-one",
		"docker network inspect network-one":   `[{"Id":"network-one","Name":"instance-default","Labels":{"private-token":"never-expose"},"Containers":{"running":{"Name":"running-instance"}}}]`,
		"docker ps --all --quiet --no-trunc":   "running\nstopped",
		"docker inspect running stopped":       `[{"Id":"running","Name":"/running-instance","State":{"Status":"running"},"NetworkSettings":{"Networks":{"instance-default":{"NetworkID":"network-one"}}}},{"Id":"stopped","Name":"/stopped-instance","State":{"Status":"exited"},"Config":{"Labels":{"com.floegence.redeven.managed-web-service":"service-two"}},"NetworkSettings":{"Networks":{"instance-default":{"NetworkID":"network-one"}}}}]`,
	}}}
	networks, err := client.ListNetworks(context.Background(), EngineDocker)
	if err != nil || len(networks) != 1 || len(networks[0].UsedBy) != 2 {
		t.Fatalf("inventory=%+v %v", networks, err)
	}
	if networks[0].UsedBy[1].State != ContainerStateExited || networks[0].UsedBy[1].ManagedServiceID != "service-two" {
		t.Fatalf("stopped reference=%+v", networks[0].UsedBy)
	}
	encoded, err := json.Marshal(networks)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "never-expose") {
		t.Fatal("network inventory exposed an unreviewed label")
	}
}
