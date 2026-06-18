package agentprotocol

import (
	"context"
	"strings"
	"testing"
)

func TestTargetExecCommandBuildsSSHCommandWithoutShellingLocally(t *testing.T) {
	t.Parallel()

	port := 2222
	cmd, err := targetExecCommand(context.Background(), TargetExecInvocation{
		ExecutionLocation:        TargetExecutionLocationSSH,
		Command:                  "date -u && uname -a",
		CWD:                      "/srv/app path",
		SSHDestination:           "root@gzcom",
		SSHPort:                  &port,
		SSHAuthMode:              "key_agent",
		SSHConnectTimeoutSeconds: 7,
	})
	if err != nil {
		t.Fatalf("targetExecCommand() error = %v", err)
	}
	if len(cmd.Args) == 0 || cmd.Args[0] != "ssh" {
		t.Fatalf("cmd.Args=%#v, want ssh argv", cmd.Args)
	}
	joined := strings.Join(cmd.Args, "\x00")
	for _, want := range []string{
		"ssh",
		"-T",
		"-x",
		"ConnectTimeout=7",
		"BatchMode=yes",
		"-p",
		"2222",
		"root@gzcom",
		"cd '/srv/app path' && date -u && uname -a",
	} {
		if !strings.Contains(joined, want) {
			t.Fatalf("ssh args missing %q: %#v", want, cmd.Args)
		}
	}
}
