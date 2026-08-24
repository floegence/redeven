package agent

import (
	"github.com/floegence/redeven/internal/runtimeservice"
)

func (a *Agent) admitRuntimeWorkload(workload runtimeservice.ManagedWorkload) (*runtimeservice.WorkloadLease, error) {
	if a == nil || a.runtimeWorkloads == nil {
		return &runtimeservice.WorkloadLease{}, nil
	}
	return a.runtimeWorkloads.Admit(workload)
}
