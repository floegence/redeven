package agent

import (
	"fmt"
	"os"
	"testing"

	"github.com/floegence/redeven/internal/testutil/redevpluginruntime"
)

func TestMain(m *testing.M) {
	cleanup, err := redevpluginruntime.InstallSiblingOfCurrentExecutable()
	if err != nil {
		_, _ = fmt.Fprintf(os.Stderr, "install ReDevPlugin runtime fixture: %v\n", err)
		os.Exit(1)
	}
	code := m.Run()
	if err := cleanup(); err != nil {
		_, _ = fmt.Fprintln(os.Stderr, err)
		code = 1
	}
	os.Exit(code)
}
