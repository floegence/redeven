package containerengine

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestStopCommandBudgetIncludesEngineGraceAndCompletion(t *testing.T) {
	client := &CLIClient{Timeout: 10 * time.Second, Runner: CommandRunnerFunc(func(ctx context.Context, _ string, args ...string) ([]byte, error) {
		deadline, ok := ctx.Deadline()
		if !ok || time.Until(deadline) < 14*time.Second {
			t.Fatalf("stop deadline consumes the engine grace period: %v", deadline)
		}
		return []byte("container-test"), nil
	})}
	if _, err := client.Action(context.Background(), EngineActionRequest{Engine: EngineDocker, Method: MethodStop, ContainerID: "container-test"}); err != nil {
		t.Fatal(err)
	}
}

func TestNetworkReferencesDistinguishDisappearedContainersFromFailedInspection(t *testing.T) {
	for _, permissionFailure := range []bool{false, true} {
		t.Run(map[bool]string{false: "missing", true: "permission"}[permissionFailure], func(t *testing.T) {
			client := &CLIClient{Runner: CommandRunnerFunc(func(_ context.Context, _ string, args ...string) ([]byte, error) {
				switch strings.Join(args, " ") {
				case "network ls --quiet --no-trunc":
					return []byte("network"), nil
				case "network inspect network":
					return []byte(`[{"Id":"network","Name":"private"}]`), nil
				case "ps --all --quiet --no-trunc":
					return []byte("present missing"), nil
				case "inspect present missing":
					return nil, ErrContainerNotFound
				case "inspect present":
					return []byte(`[{"Id":"present","Name":"/stopped","State":{"Status":"exited"},"NetworkSettings":{"Networks":{"private":{"NetworkID":"network"}}}}]`), nil
				case "inspect missing":
					if permissionFailure {
						return nil, ErrPermissionDenied
					}
					return nil, ErrContainerNotFound
				default:
					t.Fatalf("unexpected command: %v", args)
					return nil, nil
				}
			})}
			records, err := client.ListNetworks(context.Background(), EngineDocker)
			if permissionFailure {
				if !errors.Is(err, ErrPermissionDenied) {
					t.Fatalf("inspection failure became absence: %v", err)
				}
				return
			}
			if err != nil || len(records) != 1 || len(records[0].UsedBy) != 1 || records[0].UsedBy[0].State != ContainerStateExited {
				t.Fatalf("lost stopped reference: %+v %v", records, err)
			}
		})
	}
}
